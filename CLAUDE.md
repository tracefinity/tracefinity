# Tracefinity

Tool tracing app that generates 3D-printable gridfinity bins from photos. Backend is Python/FastAPI with OpenCV and manifold3d; frontend is Next.js 16/React 19/TypeScript with react-three-fiber for 3D preview. Bin projects group tools and bins for planning larger drawer/workspace workflows.

## Docs

- [docs/architecture.md](docs/architecture.md) -- project structure, data model, component breakdown
- [docs/api.md](docs/api.md) -- all API endpoints
- [docs/stl-generation.md](docs/stl-generation.md) -- STL geometry, gridfinity constants, splitting
- [docs/gotchas.md](docs/gotchas.md) -- Y-axis inversion, memory leaks, Docker, hard-won lessons
- [docs/features.md](docs/features.md) -- complete feature inventory (what the app can do)
- [docs/usage/](docs/usage/) -- user-facing guides (getting started, tracing, editing, bins, projects, exporting)
- [DESIGN.md](DESIGN.md) -- design principles and contribution guidelines

## Running

```bash
# docker (no API key = local InSPyReNet model)
docker run -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity

# docker (with Gemini)
docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key ghcr.io/tracefinity/tracefinity

# local (first time)
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
cd frontend && pnpm install

# local (day-to-day)
make dev  # starts backend (:8000) and frontend (:4001) concurrently
```

## Principles

- Coordinate systems differ across layers (see docs/gotchas.md). SVG/layout Y is down; manifold3d Y is up. Always negate Y when crossing that boundary.
- Images are downscaled to max 2048px on upload and after perspective correction. Original uploads are deleted after correction. `scale_factor` must be adjusted by the downscale ratio.
- Paper is for scale only. Tools can overflow the paper edges. The full visible area beyond the paper is included in the corrected image.
- Masks: tools BLACK, background WHITE. `_trace_mask()` handles both alpha and RGB masks.
- Tool polygons are stored in px on the trace page, converted to mm (via `scale_factor`) when saved as Tools. Placed tools in bins are already in mm -- don't re-scale.
- Cache-bust image URLs with `?v={timestamp}`. PolygonEditor needs a `key` prop to force remount on URL change.

## Tracing

Configurable via `GEMINI_IMAGE_MODEL` env var. Defaults to `gemini-3.1-flash-image-preview` locally, `gemini-3-pro-image-preview` in Docker. Also supports `gemini-2.5-flash-image` (faster, needs alignment).

Two models run at all times: U2-Net Portable for paper detection and the configured tracer for tool tracing. Both load at startup. RAM figures are combined (tested in Linux containers).

Tracers (configurable via `TRACERS` env var):
- `isnet` (default) -- IS-Net, good quality, ~0.8s/image, min 2GB
- `birefnet-lite` -- BiRefNet Lite, best quality, ~3.6s/image, min 8GB
- `inspyrenet` -- InSPyReNet, ~2.8s/image, min 6GB

Remote providers (hosted GPU, swap only the saliency step, all OpenCV stays
local). Selected via `TRACERS` or auto-detected from a token when no `TRACERS`
and no LLM key is set:
- `replicate` -- runs `REPLICATE_MODEL` (default `men1scus/birefnet`) on
  Replicate. Needs `REPLICATE_API_TOKEN`. Resolves the model's latest version
  (community models need a version); pin one with `owner/name:hash`. API
  predictions auto-purge after ~1h.
- `fal` -- runs `FAL_MODEL` (default `fal-ai/birefnet/v2`) on fal.ai. Needs
  `FAL_KEY`. Uses `mask_only` + `sync_mode` (result not stored in history).

Tuning: `FAL_OPERATING_RESOLUTION` (default `1024x1024`), `REPLICATE_RESOLUTION`
(default model resolution). User photos transit the provider when a remote
tracer is active.
