# Automatic Tool Naming

Tracefinity can optionally name traced polygons before you save them to the tool library. This is disabled by default and uses the existing polygon label, so the trace page and saved tool names stay in sync.

## Local Ollama naming

Automatic naming currently supports a local Ollama vision model. It sends one cropped image per still-generic traced polygon to Ollama, validates the returned short JSON name, and keeps the generic `tool N` label when Ollama is unavailable or returns an unusable name.

```bash
ollama pull qwen3-vl:4b
TOOL_LABEL_PROVIDER=ollama
TOOL_LABEL_MODEL=qwen3-vl:4b
TOOL_LABEL_OLLAMA_URL=http://localhost:11434
TOOL_LABEL_TIMEOUT_SECONDS=30
TOOL_LABEL_MAX_CROP_PX=512
```

## Configuration

| Variable | Default | Description |
|-|-|-|
| `TOOL_LABEL_PROVIDER` | `none` | Set to `ollama` to enable local automatic naming |
| `TOOL_LABEL_MODEL` | `qwen3-vl:4b` | Ollama vision model used for naming |
| `TOOL_LABEL_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `TOOL_LABEL_TIMEOUT_SECONDS` | `30` | Timeout for each naming request |
| `TOOL_LABEL_MAX_CROP_PX` | `512` | Maximum long edge for each isolated tool crop |

## Behavior

- Naming runs after contour extraction and before the trace result is saved.
- When enabled, naming runs synchronously and can add up to `TOOL_LABEL_TIMEOUT_SECONDS` for each attempted generic polygon crop.
- Only still-generic labels, such as `tool 1`, are replaced.
- Naming failures are non-fatal and keep generic labels.
- Manual label edits remain ordinary polygon edits and are saved through the existing trace workflow.
