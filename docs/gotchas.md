# Gotchas

Hard-won lessons. Read before making changes to coordinate mapping, 3D preview, or Docker.

## Y-axis inversion

SVG/layout/bin-space is Y-down (0 = top edge). Manifold3d is Y-up. Always negate Y when mapping: `-(y + offset_y)`.

- Flipping Y reverses polygon winding -- remove any `reversed()` calls if adding a Y-flip
- Text labels use a flipped Plane (z_dir down) so they negate Y separately
- BinPreview3D.tsx: rotation `[-PI/2, 0, 0]` converts Z-up to Y-up. Do NOT add `scale [1, -1, 1]` -- that was a compensating hack for un-flipped Y
- All three must match: layout editor, 3D preview, downloaded STL in slicer

## Cutout pipeline order

Smoothing/simplification runs BEFORE clearance (`prepare_for_generation`), never after -- vertex reduction erodes the outline by up to its tolerance and must not eat the clearance. The printed pocket is the previewed shape grown by exactly the clearance. The smoothing epsilon is absolute mm (`smooth_epsilon`), duplicated in `lib/svg.ts smoothEpsilon`. After simplification, both pipelines add support points 2mm from each corner before Chaikin subdivision so corner influence cannot bow long edges. Keep the epsilon and Chaikin corner span in lockstep between backend and frontend or preview and print diverge.

## Auto-size and the stacking lip

Pocket clipping reserves the larger of the configured wall and the stacking
lip's 2.6 mm inset. Bin creation, browser auto-size, and adding tools must use
that same inset plus clearance and the outer shell's 0.5 mm total tolerance.
Using wall thickness alone can select a grid that cuts off the tool ends.
`test_bin_autosize_accuracy.py` measures actual exported cavities at this
boundary, and the browser accuracy suite covers reducing clearance with
auto-size enabled. Manually selected undersized grids can still clip pockets.

## EXIF orientation

cv2 ignores EXIF orientation, browsers apply it. `ingest_image` bakes orientation into the pixels at upload -- without it, corner coordinates from the UI land in a different frame than the backend warps. All image ingest (upload, corrected downscale, mask upload) must go through it.

## Three.js memory leaks

Every `BufferGeometry` and `EdgesGeometry` must be `.dispose()`d on React unmount. STL regeneration creates new geometries each time -- if the old ones aren't disposed, the browser will OOM. Same applies to `Image` objects created in useEffect (use a `cancelled` flag in cleanup).

## Docker

Single container runs both frontend and backend via supervisor. Key details:

- CORS origins in `backend/.env` override the Python defaults -- if you change the frontend port, update `.env` too
- `NEXT_TELEMETRY_DISABLED=1` is set in the Dockerfile build stage
- `.dockerignore` excludes `docs/`, `node_modules/`, `venv/`, `storage/`, `.claude/`
- Container runs as non-root user `tracefinity` (UID 1000) by default. Supports `--user "$(id -u):$(id -g)"` for arbitrary UIDs. Runtime-writable dirs (`/app/storage`, `/app/.u2net`, `/app/.next`, `/tmp/nginx`, `/tmp/supervisor`, `/var/lib/nginx`) are world-writable. `U2NET_HOME` and `HOME` are set to `/app` paths so model downloads and nginx/supervisor state work without root.

## Manifold3d boolean performance

The generator batches polygon cutters before subtracting them from the bin. Keep
that batching: performing a separate mesh boolean for every cutout is much
slower. Manifold3d replaced the original build123d/OCCT generator because its
mesh booleans were measured at 10-100x faster for this workload. See
[stl-generation.md](stl-generation.md) for the current pipeline.

## Frontend patterns

- Shared constants (`DISPLAY_SCALE`, `SNAP_GRID`, `GRID_UNIT`, etc.) live in `lib/constants.ts`
- `DISPLAY_SCALE = 8` converts mm to SVG units in the bin editor
- Config is spread into the API request body: `{ ...config, polygons }` in `generateStl`
- Text labels live on BinConfig (not Polygon) since they're free-placed
- PolygonEditor uses refs (`polygonsRef`, `onPolygonsChangeRef`) to avoid stale closures during drag -- do not add `polygons` or `onPolygonsChange` to the `handleMouseMove` dependency array
- Auto-save uses the `useDebouncedSave` hook (debounce + `beforeunload` flush). Saves are serialized, with newer queued edits coalesced. Its explicit `flush()` waits for pending writes, rejects failed saves, and does nothing when idle. Bin generation uses `flush({ force: true })` to persist current settings even before the initial debounce is armed. Independent save/generation timers can otherwise leave a stale STL available after the save succeeds. `skipInitial: true` skips scheduling during the first 100 ms; a later data load can still schedule a save.
- Bin and session generation also serialize per output entity, from reading saved geometry through publishing all export files. Aborting a frontend request does not cancel its backend worker: overlapping workers can otherwise overwrite newer geometry with an older result. The lock is process-local, matching the JSON stores and single Uvicorn worker; multiple processes sharing storage need shared coordination.
- Undo/redo uses the `useHistory` hook (deep-clone, Cmd+Z handling). The `set()` method pushes to history; `undo()`/`redo()` call the `onChange` callback.
- The tool editor's Detail slider derives from the latest edited outline. Keep
  its full-detail base and slider level in undo history with the points. Manual
  vertex edits establish a new base; rotation and reflection transform the base
  with the displayed outline; changing Detail alone preserves it. Retaining the
  mount-time base can silently undo a saved size correction. An edit after undo
  must create a new history entry and replace the redo branch.
- ToolEditor and BinEditor are split into orchestrator + toolbar + canvas sub-components. `CutoutOverlay` renders finger holes in both.

## AVX / ONNX requirement

U2-Net paper detection and all local tracers (`isnet`, `birefnet-lite`, `inspyrenet`) require ONNX Runtime, which needs AVX CPU instructions. On non-AVX CPUs (some older VMs, Atoms), ONNX is disabled at startup and paper detection falls back to OpenCV-only edge and brightness detection -- less accurate, may need manual corner adjustment. Local tracers won't load; use a remote tracer (`gemini`, `replicate`, `fal`).

Detection is two-tier: CPU flag check (`/proc/cpuinfo` on Linux, `sysctl` on macOS), then a subprocess probe that catches SIGILL without killing the main process. Result is cached for the process lifetime.

## Paper corner detection

Uses a two-stage approach: U2-Net Portable generates a rough tool mask (~0.17s), tool pixels are blacked out, then OpenCV finds the paper in the cleaned image. This prevents tools (especially dark ones on white paper) from fragmenting the paper region during detection.

Closed quadrilateral contours from Canny edges take priority when at least 35% of their interior is bright. They preserve the sheet's perspective without treating an unevenly lit patch or adjacent bright tabletop as paper. The brightness check prevents a strong dark-tool outline from replacing a faint paper boundary.

Brightness detection remains a fallback. It tries multiple thresholds (200, 190, 180), picks the largest valid candidate, and validates against bounding-rectangle aspect ratio (0.55-0.85, covering A-series, Letter, and Tabloid) and bright fill ratio (at least 35%). A convex hull merge step handles cases where the paper is split into fragments. Its bounding rectangle approximates the sheet and may need manual corner adjustment. A quadrilateral fitted to a brightness region can also cut across shadows; do not assume its vertices are the physical paper corners.

`test_paper_corners_photos.py` checks the visible sheet corners in four
maintainer photos. The synthetic API and browser tests measure the resulting
STL cavity against a known flat object. They cover calibration and export
scaling, but substitute hosted segmentation and do not test raised-object
perspective. See [the accuracy test instructions](../CONTRIBUTING.md#pull-requests).

Accurate-mode tests compare the cavity boundary with a sharp rectangle. Smooth
mode intentionally rounds corners, so its test checks dimensions and whether
the whole physical tool fits. `test_measure_pocket.py` checks that matching the
bounding dimensions alone cannot pass the fit test.

Difficult cases: hands in the frame, sticks/rods crossing the paper, very heavy tool overflow with minimal visible paper. These may need manual corner adjustment.

On a bright sheet against a dark background U2-Net returns the sheet, not the tool. A mask over `TOOL_MASK_MAX_FRACTION` of the frame is ignored, and a masked miss retries unmasked; before that the upload came back with no corners at all (#213).

## Saliency crop

Local and remote saliency tracers run on the paper rect from `_detect_paper_rect`, not the full corrected image, because on the full image the bright sheet is the salient object. Two traps follow. A tool crossing the sheet splits the bright region, so fragments that line up with the sheet across a tool-sized gap are merged before cropping. A tool overhanging the sheet is outside the crop, so the crop grows on any side the mask touches and runs again; without that the mask is cut flat at the paper edge (#212). Gemini does not crop.

## Gemini mask quirks

- Masks come back at different dimensions AND aspect ratio than requested. `_trace_mask()` resizes with `INTER_NEAREST`, then `_align_mask()` uses template matching to correct the positional offset.
- `_align_mask()` extracts the tool region from the resized mask, searches for it in the inverted corrected image via `cv2.matchTemplate(TM_CCOEFF_NORMED)`, and applies a translation. Runs at 0.25x resolution (~20ms). Skipped if score < 0.15 or shift > 10% of image dimension.
- `_trace_mask()` handles both alpha-channel PNGs (tool=opaque, bg=transparent) and RGB PNGs (tool=black, bg=white).
- The prompt asks for a "stencil" -- flat black shapes on flat white. This works better than asking for a "mask" with `gemini-2.5-flash-image`.
