[CmdletBinding()]
param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 4001,
    [string]$ApiUrl = "",
    [ValidateSet("auto", "cuda", "cpu")]
    [string]$OnnxProvider = "auto",
    [string]$ToolLabelProvider = $env:TOOL_LABEL_PROVIDER,
    [string]$ToolLabelModel = $env:TOOL_LABEL_MODEL,
    [string]$ToolLabelOllamaUrl = $env:TOOL_LABEL_OLLAMA_URL,
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$VenvDir = Join-Path $BackendDir "venv"
$PythonExe = Join-Path $BackendDir "venv\Scripts\python.exe"
$RequirementsFile = Join-Path $BackendDir "requirements.txt"
$NodeModulesDir = Join-Path $FrontendDir "node_modules"

function Invoke-Step {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed: $FilePath $($ArgumentList -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found on PATH. Install Node.js, then run npm install in the frontend folder."
}

function Ensure-BackendEnvironment {
    $InstallBackendRequirements = $false

    if (-not (Test-Path $PythonExe)) {
        $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $PythonCommand) {
            throw "python was not found on PATH. Install Python 3.11+ or create backend\venv manually."
        }

        Write-Host "Creating backend virtualenv..."
        Invoke-Step -FilePath $PythonCommand.Source -ArgumentList @("-m", "venv", $VenvDir) -WorkingDirectory $RootDir
        $InstallBackendRequirements = $true
    }
    else {
        & $PythonExe -c "import fastapi, uvicorn" *> $null
        if ($LASTEXITCODE -ne 0) {
            $InstallBackendRequirements = $true
        }
    }

    if ($InstallBackendRequirements) {
        Write-Host "Installing backend dependencies..."
        Invoke-Step -FilePath $PythonExe -ArgumentList @("-m", "pip", "install", "-r", $RequirementsFile) -WorkingDirectory $BackendDir
    }
}

function Ensure-FrontendEnvironment {
    if (-not (Test-Path $NodeModulesDir)) {
        Write-Host "Installing frontend dependencies..."
        Invoke-Step -FilePath "npm" -ArgumentList @("install") -WorkingDirectory $FrontendDir
    }
}

Ensure-BackendEnvironment
Ensure-FrontendEnvironment

if (-not $ApiUrl) {
    $ApiUrl = "http://localhost:$BackendPort"
}

$BackendScript = {
    param($BackendDir, $PythonExe, $BackendPort, $UseReload, $CorsOrigins, $OnnxProvider, $ToolLabelProvider, $ToolLabelModel, $ToolLabelOllamaUrl)

    Set-Location $BackendDir
    $env:CORS_ORIGINS = $CorsOrigins
    $env:TRACEFINITY_ONNX_PROVIDER = $OnnxProvider
    if ($ToolLabelProvider) {
        $env:TOOL_LABEL_PROVIDER = $ToolLabelProvider
    }
    if ($ToolLabelModel) {
        $env:TOOL_LABEL_MODEL = $ToolLabelModel
    }
    if ($ToolLabelOllamaUrl) {
        $env:TOOL_LABEL_OLLAMA_URL = $ToolLabelOllamaUrl
    }
    $Args = @("-m", "uvicorn", "app.main:app", "--port", "$BackendPort")
    if ($UseReload) {
        $Args += "--reload"
    }
    & $PythonExe @Args
}

$FrontendScript = {
    param($FrontendDir, $FrontendPort, $ApiUrl)

    Set-Location $FrontendDir
    $env:NEXT_PUBLIC_API_URL = $ApiUrl
    $env:BACKEND_URL = $ApiUrl
    & npm exec -- next dev -p $FrontendPort
}

$UseReload = -not $NoReload
$CorsOrigins = @(
    "http://localhost:$FrontendPort",
    "http://127.0.0.1:$FrontendPort",
    "http://localhost:3000",
    "http://localhost:4001"
) | Select-Object -Unique | ConvertTo-Json -Compress
$Jobs = @()

function Receive-DevJobOutput {
    param([object[]]$Jobs)

    $JobErrors = @()
    $Jobs | Receive-Job -ErrorAction SilentlyContinue -ErrorVariable JobErrors
    foreach ($JobError in $JobErrors) {
        if ($JobError.Exception.Message) {
            Write-Host $JobError.Exception.Message
        }
    }
}

Write-Host "Starting Tracefinity"
Write-Host "Backend:  $ApiUrl"
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "ONNX:     $OnnxProvider"
Write-Host "Press Ctrl+C to stop both processes."

try {
    $Jobs += Start-Job -Name "tracefinity-backend" -ScriptBlock $BackendScript -ArgumentList $BackendDir, $PythonExe, $BackendPort, $UseReload, $CorsOrigins, $OnnxProvider, $ToolLabelProvider, $ToolLabelModel, $ToolLabelOllamaUrl
    $Jobs += Start-Job -Name "tracefinity-frontend" -ScriptBlock $FrontendScript -ArgumentList $FrontendDir, $FrontendPort, $ApiUrl

    while ($true) {
        Receive-DevJobOutput -Jobs $Jobs
        $Finished = $Jobs | Where-Object { $_.State -in @("Completed", "Failed", "Stopped") }
        if ($Finished) {
            Receive-DevJobOutput -Jobs $Jobs
            $Names = ($Finished | ForEach-Object { "$($_.Name): $($_.State)" }) -join ", "
            throw "Dev process exited: $Names"
        }
        Start-Sleep -Milliseconds 500
    }
}
finally {
    $Running = $Jobs | Where-Object { $_.State -eq "Running" }
    if ($Running) {
        $Running | Stop-Job
    }
    Receive-DevJobOutput -Jobs $Jobs
    $Jobs | Remove-Job
}
