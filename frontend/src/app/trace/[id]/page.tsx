'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, Copy, Upload, Download, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { PaperCornerEditor } from '@/components/PaperCornerEditor'
import { PolygonEditor } from '@/components/PolygonEditor'
import { SessionInfo } from '@/components/SessionInfo'
import { Alert } from '@/components/Alert'
import { getSession, setCorners, traceTools, updatePolygons, updateSession, getImageUrl, getAvailableKeys, traceFromMask } from '@/lib/api'
import type { Point, Polygon, Session } from '@/types'

type Step = 'corners' | 'trace' | 'edit'

const MASK_PROMPT = `Generate a pure black and white silhouette mask of ONLY the tools/objects in this image.
- Tools should be solid BLACK (#000000)
- Background should be solid WHITE (#FFFFFF)
- No shadows, gradients, or gray tones
- Sharp, clean edges
- Output ONLY the mask image, no text or explanation`

const LABEL_PROMPT = `Identify each tool in the image and return a JSON object with labels.`

const TRACE_STEPS = [
  'Uploading image to Gemini...',
  'Generating silhouette mask...',
  'Processing mask...',
  'Tracing contours...',
  'Identifying tools...',
]

export default function TracePage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [step, setStep] = useState<Step>('corners')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [corners, setLocalCorners] = useState<Point[]>([])
  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [correctedImageUrl, setCorrectedImageUrl] = useState<string>('')
  const [polygons, setPolygons] = useState<Polygon[]>([])

  const [provider, setProvider] = useState<'google' | 'manual'>('google')
  const [apiKey, setApiKey] = useState('')
  const [hasEnvKey, setHasEnvKey] = useState(false)
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [maskVersion, setMaskVersion] = useState(0)
  const [imageVersion, setImageVersion] = useState(Date.now())
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [traceStatus, setTraceStatus] = useState<string | null>(null)
  const maskInputRef = useRef<HTMLInputElement>(null)
  const statusInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [s, keys] = await Promise.all([
          getSession(sessionId),
          getAvailableKeys(),
        ])
        setSession(s)
        setHasEnvKey(keys.google)

        if (!keys.google) {
          setProvider('manual')
        }

        if (s.corners) {
          setLocalCorners(s.corners)
        }
        if (s.corrected_image_path) {
          const pathParts = s.corrected_image_path.split('/')
          const filename = pathParts[pathParts.length - 1]
          setCorrectedImageUrl(`/storage/processed/${filename}`)
        }
        if (s.mask_image_path) {
          const pathParts = s.mask_image_path.split('/')
          const filename = pathParts[pathParts.length - 1]
          setMaskUrl(`/storage/processed/${filename}`)
        }
        if (s.polygons && s.polygons.length > 0) {
          setPolygons(s.polygons)
          setStep('edit')
        } else if (s.corrected_image_path) {
          setStep('trace')
        }
      } catch {
        setError('session not found')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  useEffect(() => {
    if (session) {
      const path = step === 'corners' || !correctedImageUrl
        ? `/storage/uploads/${sessionId}${getExtension(session.original_image_path)}`
        : correctedImageUrl
      setImageUrl(getImageUrl(path))
    }
  }, [session, step, correctedImageUrl, sessionId])

  function getExtension(path: string | null): string {
    if (!path) return '.jpg'
    const match = path.match(/\.[^.]+$/)
    return match ? match[0] : '.jpg'
  }

  async function handleCornersSubmit() {
    if (corners.length !== 4) return

    setProcessing(true)
    setError(null)

    try {
      const result = await setCorners(sessionId, corners, paperSize)
      setCorrectedImageUrl(result.corrected_image_url)
      setImageVersion(Date.now())
      setStep('trace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to process corners')
    } finally {
      setProcessing(false)
    }
  }

  async function handleTrace() {
    if (!hasEnvKey && !apiKey.trim()) {
      setError('please enter your API key')
      return
    }

    setProcessing(true)
    setError(null)
    setTraceStatus(TRACE_STEPS[0])

    // cycle through status messages while waiting
    let stepIndex = 0
    statusInterval.current = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, TRACE_STEPS.length - 1)
      setTraceStatus(TRACE_STEPS[stepIndex])
    }, 3000)

    try {
      const result = await traceTools(
        sessionId,
        'google',
        hasEnvKey ? undefined : apiKey
      )
      setPolygons(result.polygons)
      if (result.mask_url) {
        setMaskUrl(result.mask_url)
        setMaskVersion((v) => v + 1)
      }
      setStep('edit')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'tracing failed')
    } finally {
      if (statusInterval.current) {
        clearInterval(statusInterval.current)
        statusInterval.current = null
      }
      setTraceStatus(null)
      setProcessing(false)
    }
  }

  async function handleMaskUpload(file: File) {
    setProcessing(true)
    setError(null)

    try {
      const result = await traceFromMask(sessionId, file)
      setPolygons(result.polygons)
      if (result.mask_url) {
        setMaskUrl(result.mask_url)
        setMaskVersion((v) => v + 1)
      }
      setStep('edit')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to process mask')
    } finally {
      setProcessing(false)
    }
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(MASK_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleDownloadImage() {
    if (!correctedImageUrl) return
    try {
      const response = await fetch(getImageUrl(correctedImageUrl))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tracefinity-${sessionId.slice(0, 8)}.jpg`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // fallback: open in new tab
      window.open(getImageUrl(correctedImageUrl), '_blank')
    }
  }

  async function handlePolygonsChange(updated: Polygon[]) {
    setPolygons(updated)
    try {
      await updatePolygons(sessionId, updated)
    } catch {
      // ignore save errors
    }
  }

  function handleContinue() {
    router.push(`/configure/${sessionId}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-gray-600 dark:text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading session...</span>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Alert variant="error">{error}</Alert>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2">
        {step === 'corners' && (
          <PaperCornerEditor
            imageUrl={imageUrl}
            corners={corners}
            onCornersChange={setLocalCorners}
          />
        )}

        {(step === 'trace' || step === 'edit') && correctedImageUrl && (
          <PolygonEditor
            key={`${correctedImageUrl}-${imageVersion}`}
            imageUrl={`${getImageUrl(correctedImageUrl)}?v=${imageVersion}`}
            polygons={polygons}
            onPolygonsChange={handlePolygonsChange}
            editable={step === 'edit'}
          />
        )}
      </div>

      <div className="space-y-6">
        {session && (
          <SessionInfo
            session={session}
            onUpdate={(updates) => {
              updateSession(sessionId, updates)
              setSession({ ...session, ...updates })
            }}
          />
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-4">
            {step === 'corners' && 'Step 1: Adjust Paper Corners'}
            {step === 'trace' && 'Step 2: Trace Tools'}
            {step === 'edit' && 'Step 3: Edit Outlines'}
          </h3>

          {step === 'corners' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Drag the corner handles to match the paper edges. This ensures accurate scaling.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Paper Size
                </label>
                <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
                  <button
                    onClick={() => setPaperSize('a4')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      paperSize === 'a4'
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    A4
                  </button>
                  <button
                    onClick={() => setPaperSize('letter')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      paperSize === 'letter'
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    Letter
                  </button>
                </div>
              </div>

              <button
                onClick={handleCornersSubmit}
                disabled={corners.length !== 4 || processing}
                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                {processing ? 'Processing...' : 'Continue'}
              </button>
            </div>
          )}

          {step === 'trace' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Method
                </label>
                <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
                  <button
                    onClick={() => setProvider('google')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      provider === 'google'
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    Gemini API{hasEnvKey && ' (configured)'}
                  </button>
                  <button
                    onClick={() => setProvider('manual')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      provider === 'manual'
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    Manual
                  </button>
                </div>
              </div>

              {provider === 'google' && (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {hasEnvKey
                      ? 'Using Gemini API key from environment.'
                      : 'Enter your Google AI API key to trace tools automatically.'}
                  </p>

                  {!hasEnvKey && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Your key is sent directly to the API and not stored.
                      </p>
                    </div>
                  )}

                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowPrompt(!showPrompt)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <span>What we send to Gemini</span>
                      {showPrompt ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {showPrompt && (
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600 space-y-3">
                        <div>
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Mask generation prompt:</p>
                          <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{MASK_PROMPT}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Label identification prompt:</p>
                          <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{LABEL_PROMPT}</pre>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Your corrected image is sent with these prompts. Model: gemini-3-pro-image-preview
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleTrace}
                    disabled={(provider === 'google' && !hasEnvKey && !apiKey.trim()) || processing}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                    {processing ? 'Tracing...' : 'Trace Tools'}
                  </button>

                  {traceStatus && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      <span>{traceStatus}</span>
                    </div>
                  )}
                </>
              )}

              {provider === 'manual' && (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Use Gemini (or another AI) to generate a mask, then upload it here.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        1. Download the corrected image:
                      </p>
                      <button
                        onClick={handleDownloadImage}
                        className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300 transition-colors flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Download Image
                      </button>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        2. Copy this prompt:
                      </p>
                      <div className="relative">
                        <pre className="text-xs bg-gray-50 dark:bg-gray-700/50 p-3 rounded border border-gray-200 dark:border-gray-600 whitespace-pre-wrap">
                          {MASK_PROMPT}
                        </pre>
                        <button
                          onClick={handleCopyPrompt}
                          className="absolute top-2 right-2 p-1.5 bg-white dark:bg-gray-600 rounded border border-gray-200 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors"
                        >
                          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        3. Upload the image and prompt to <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">gemini.google.com</a>, then upload the resulting mask:
                      </p>
                      <input
                        ref={maskInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleMaskUpload(file)
                        }}
                        className="hidden"
                      />
                      <button
                        onClick={() => maskInputRef.current?.click()}
                        disabled={processing}
                        className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                      >
                        {processing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            Upload Mask
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'edit' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Click on a polygon to select it. Drag vertices to adjust the outline.
                {polygons.length === 0 && ' No tools were detected.'}
              </p>

              {polygons.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Detected tools ({polygons.length}):
                  </p>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    {polygons.map((p) => (
                      <li key={p.id}>{p.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              {maskUrl && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Mask:
                  </p>
                  <img
                    src={`${getImageUrl(maskUrl)}?v=${maskVersion}`}
                    alt="Generated mask"
                    className="w-full rounded border border-gray-200 dark:border-gray-700"
                  />
                </div>
              )}

              <button
                onClick={() => setStep('trace')}
                className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Re-trace
              </button>

              <button
                onClick={handleContinue}
                disabled={polygons.length === 0}
                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Configure Bin
              </button>
            </div>
          )}

          {error && (
            <Alert variant="error" className="mt-4">{error}</Alert>
          )}
        </div>
      </div>
    </div>
  )
}
