# Automatic Tool Naming

Tracefinity can optionally name traced polygons before you save them to the tool library. This is disabled by default and uses the existing polygon label, so the trace page and saved tool names stay in sync.

## Local Ollama naming

Automatic naming supports a local Ollama vision model. It sends one cropped image per still-generic traced polygon to Ollama, validates the returned short JSON name, and keeps the generic `tool N` label when Ollama is unavailable or returns an unusable name.

```bash
ollama pull qwen3-vl:4b
TOOL_LABEL_PROVIDER=ollama
TOOL_LABEL_MODEL=qwen3-vl:4b
TOOL_LABEL_OLLAMA_URL=http://localhost:11434
TOOL_LABEL_TIMEOUT_SECONDS=30
TOOL_LABEL_MAX_CROP_PX=512
```

## OpenRouter naming

For setups without a local Ollama server (or without GPU headroom to run one), naming can go through OpenRouter's chat completions API instead. Same per-crop flow as Ollama: one cropped image per still-generic polygon, same JSON label parsing and validation, generic label kept on failure. As with the remote (`gemini`) tracer, each cropped tool image is sent to OpenRouter's API to be named.

```bash
TOOL_LABEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_LABEL_MODEL=google/gemini-2.0-flash-001
```

`OPENROUTER_LABEL_MODEL` accepts a **comma-separated list** of models, tried in order:

```bash
OPENROUTER_LABEL_MODEL=google/gemma-4-31b-it:free,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
```

This is aimed at OpenRouter's free-tier (`:free` suffix) models, which share a 20 req/min pool *per model, across all OpenRouter users* — not a per-account limit. A popular free model can return `429 Too Many Requests` under third-party load that has nothing to do with your own usage. Each model in the list gets a couple of quick retries (honoring `Retry-After` when present) before falling through to the next one, so a congested first choice doesn't fail the whole trace's naming pass. A single model (no comma) works the same as before.

## Configuration

| Variable | Default | Description |
|-|-|-|
| `TOOL_LABEL_PROVIDER` | `none` | Set to `ollama` or `openrouter` to enable automatic naming |
| `TOOL_LABEL_MODEL` | `qwen3-vl:4b` | Ollama vision model used for naming (`ollama` provider only) |
| `TOOL_LABEL_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL (`ollama` provider only) |
| `TOOL_LABEL_TIMEOUT_SECONDS` | `30` | Timeout for each naming request (both providers) |
| `TOOL_LABEL_MAX_CROP_PX` | `512` | Maximum long edge for each isolated tool crop (both providers) |
| `OPENROUTER_API_KEY` | unset | Required for the `openrouter` provider |
| `OPENROUTER_LABEL_MODEL` | `google/gemini-2.0-flash-001` | Model, or comma-separated fallback list, for the `openrouter` provider |

## Behavior

- Naming runs after contour extraction and before the trace result is saved.
- When enabled, naming runs synchronously and can add up to `TOOL_LABEL_TIMEOUT_SECONDS` for each attempted generic polygon crop.
- Only still-generic labels, such as `tool 1`, are replaced.
- Naming failures are non-fatal and keep generic labels.
- Manual label edits remain ordinary polygon edits and are saved through the existing trace workflow.
