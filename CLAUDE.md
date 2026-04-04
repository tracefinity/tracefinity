# Tracefinity

Tool tracing app that generates 3D-printable gridfinity bins from photos. Backend is Python/FastAPI with OpenCV and manifold3d; frontend is Next.js 16/React 19/TypeScript with react-three-fiber for 3D preview.

## Docs

- [docs/architecture.md](docs/architecture.md) -- project structure, data model, component breakdown
- [docs/api.md](docs/api.md) -- all API endpoints
- [docs/stl-generation.md](docs/stl-generation.md) -- STL geometry, gridfinity constants, splitting
- [docs/gotchas.md](docs/gotchas.md) -- Y-axis inversion, memory leaks, Docker, hard-won lessons

## Running

```bash
# docker (no API key = local InSPyReNet model)
docker run -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity

# docker (with Gemini)
docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key ghcr.io/tracefinity/tracefinity

# local (first time)
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
cd frontend && npm install

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

Local models (no API key needed), configurable via `TRACERS` env var:
- `birefnet-lite` (default) -- BiRefNet Lite, best quality, ~3.6s/image, ~8GB
- `isnet` -- IS-Net, good quality, ~0.8s/image, ~2.5GB (runs on 4GB)
- `inspyrenet` -- InSPyReNet, ~2.8s/image, ~6GB

Paper detection (U2-Net Portable) also loads at startup. All models load eagerly, not on first request.
