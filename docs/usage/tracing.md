# Tracing

## How it works

After you mark the paper corners and select a paper size, the image is perspective-corrected using the corner positions, then processed by an AI model to generate silhouette masks for each tool.

When only one tracer backend is configured, tracing starts automatically after corners are set. When multiple tracers are available (via the `TRACERS` env var), a dropdown appears letting you choose which tracer to use before starting.

Paper detection uses a separate U2-Net Portable model that is always loaded alongside the configured tracer.

## Tracer backends

The tracer model is configurable via the `TRACERS` environment variable. Multiple can be specified (comma-separated); the first is used by default.

| Backend | Env value | Speed | RAM (min) | Notes |
|-|-|-|-|-|
| IS-Net | `isnet` | ~0.8s/image | 2 GB | Default. Good quality. |
| BiRefNet Lite | `birefnet-lite` | ~3.6s/image | 8 GB | Best quality. |
| InSPyReNet | `inspyrenet` | ~2.8s/image | 6 GB | Mid-range. |

RAM figures are combined (tracer + U2-Net) and tested in Linux containers.

Example:

```bash
docker run -p 3000:3000 -v ./data:/app/storage -e TRACERS=birefnet-lite ghcr.io/tracefinity/tracefinity
```

## Gemini image model

When a `GOOGLE_API_KEY` is set, a Gemini image model is used for tracing. The model is configurable via `GEMINI_IMAGE_MODEL`:

- `gemini-3.1-flash-image-preview` (default locally)
- `gemini-3-pro-image-preview` (default in Docker)
- `gemini-2.5-flash-image` (faster, needs alignment)

## Manual mask upload

If automatic tracing produces poor results, you can upload your own mask. The full workflow:

1. Download the perspective-corrected image using the Download Image button.
2. Copy the built-in prompt to your clipboard (the Copy Prompt button).
3. Upload the corrected image and prompt to an external tool (e.g. [Gemini](https://gemini.google.com)) to generate a mask.
4. Upload the resulting mask back into Tracefinity using the Upload Mask button.

Masks should be black (tools) on white (background), with sharp edges and no gradients.

## Mask preview

After tracing, mask previews are shown for each detected tool. Use these to check quality before selecting which tools to keep.

## When tracing goes wrong

The AI handles most tool shapes well, but may struggle with:

- **Very thin tools** (needles, drill bits) -- outlines may be incomplete or broken.
- **Reflective or transparent tools** -- the mask may include reflections or miss transparent sections.
- **Overlapping tools** -- tools touching or overlapping may be merged into a single outline.

If a trace is not right, you can edit the vertices manually in the tool editor, or upload a corrected mask.
