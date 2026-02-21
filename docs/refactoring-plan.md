# Refactoring Plan

Code quality improvements — no functionality changes.

---

## Phase 1: Quick Wins

### 1.1 Extract shared constants

Create `frontend/src/lib/constants.ts`:
- `GRID_UNIT = 42`
- `DISPLAY_SCALE = 8`
- `SNAP_GRID = 5`
- `MAX_HISTORY = 50`
- `ZOOM_FACTOR = 1.15`, `ZOOM_MIN = 0.5`, `ZOOM_MAX = 20`

Update imports in: `ToolEditor.tsx`, `BinEditor.tsx`, `PolygonEditor.tsx`, `bins/[id]/page.tsx`, `page.tsx`

Backend: move `GF_GRID = 42.0` to a shared constants module (e.g. `backend/app/constants.py`), import from `routes.py` and `stl_generator_manifold.py`.

### 1.2 Extract `smoothEpsilon()` util

Add to `frontend/src/lib/svg.ts`:
```ts
export function smoothEpsilon(diag: number, level: number): number {
  const factor = 0.002 + level * 0.006
  return Math.max(0.3, diag * factor)
}
```

Replace inline calculations in `ToolEditor.tsx` and `BinEditor.tsx`.

### 1.3 Extract `fetchForm()` helper

Add to `frontend/src/lib/api.ts`:
```ts
async function fetchForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'request failed' }))
    throw new ApiError(err.detail || 'request failed', res.status)
  }
  return res.json()
}
```

Refactor `uploadImage` and `traceFromMask` to use it.

### 1.4 Top-level imports in `routes.py`

Move `import hashlib, json, math, zipfile` to the top of the file. Remove all deferred imports from function bodies.

### 1.5 Drop `Cutout` type alias

Remove the `Cutout` interface from `frontend/src/types/index.ts`. It duplicates `FingerHole` and the backend only has `FingerHole`. Update any remaining references.

### 1.6 Fix `interior_rings` optionality

Change all frontend `interior_rings?: Point[][]` to `interior_rings: Point[][]` with runtime default `[]`, matching backend.

---

## Phase 2: Shared Hooks and Utils

### 2.1 `useDebouncedSave` hook

Create `frontend/src/hooks/useDebouncedSave.ts`:
```ts
function useDebouncedSave(
  fn: () => void | Promise<void>,
  deps: unknown[],
  delay?: number,  // default 150
  options?: { skipInitial?: boolean }
): { saving: boolean; saved: boolean }
```

Encapsulates: `saveTimeoutRef`, `pendingSaveRef`, debounced setTimeout, `beforeunload` flush listener.

Refactor: `tools/[id]/page.tsx`, `bins/[id]/page.tsx`, `trace/[id]/page.tsx`.

### 2.2 `useHistory` hook

Create `frontend/src/hooks/useHistory.ts`:
```ts
function useHistory<T>(
  initial: T,
  maxEntries?: number  // default 50
): {
  state: T
  set: (value: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}
```

Encapsulates: `history[]`, `historyIndex`, `isUndoRedo` ref, push/undo/redo logic.

Refactor: `ToolEditor.tsx`, `PolygonEditor.tsx`.

### 2.3 SVG coordinate utils

Add to `frontend/src/lib/svg.ts`:

```ts
export function svgClientToViewBox(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number }

export function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid
}
```

Replace inline implementations in `ToolEditor.tsx` and `BinEditor.tsx`.

---

## Phase 3: Backend Route Cleanup

### 3.1 Extract `_run_generate()` helper

The STL cache-check + generate + split + zip + response construction logic is duplicated between `generate_stl` (session-based) and `generate_bin_stl`. Extract to:

```python
def _run_generate(
    scaled: list[ScaledPolygon],
    gen_req: GenerateRequest,
    entity_id: str,
    user_path: Path,
    user_id: str,
    input_hash: str,
) -> GenerateResponse
```

Both route handlers build their `scaled` list and `gen_req` differently, then call this shared function.

### 3.2 Extract `_translate_placed_tool()` helper

The point/hole/ring offset pattern appears 3 times in `routes.py`. Extract:

```python
def _translate_finger_holes(holes: list[FingerHole], dx: float, dy: float) -> list[FingerHole]
def _translate_points(points: list[Point], dx: float, dy: float) -> list[Point]
```

Use in `create_bin` (offset) and `get_bin` (rotation sync).

### 3.3 Extract `BinParams` base model

`BinConfig` and `GenerateRequest` share 8 fields with identical defaults. Create a base:

```python
class BinParams(BaseModel):
    grid_x: int = 2
    grid_y: int = 2
    height_units: int = 4
    magnets: bool = True
    stacking_lip: bool = True
    wall_thickness: float = 1.6
    cutout_depth: float = 20.0
    cutout_clearance: float = 1.0
    # validators here

class BinConfig(BinParams):
    text_labels: list[TextLabel] = []
    bed_size: float = 256.0

class GenerateRequest(BinParams):
    polygons: list[Polygon] | None = None
    text_labels: list[TextLabel] = []
    bed_size: float = 256.0
```

### 3.4 Move business logic out of route handlers

- `get_bin` tool-sync logic (L731-774) -> `services/bin_service.py: sync_placed_tools()`
- `save_tools_from_session` px-to-mm + centring (L632-649) -> `PolygonScaler.scale_and_centre()`
- Thumbnail generation (L664-684) -> `services/image_service.py: generate_tool_thumbnail()`

---

## Phase 4: Component Decomposition

### 4.1 `<CutoutOverlay>` shared component

Extract finger hole SVG rendering (circle/rect with rotation, selection handles) into `frontend/src/components/CutoutOverlay.tsx`. Used by both ToolEditor and BinEditor. Props:

```ts
interface CutoutOverlayProps {
  holes: FingerHole[]
  scale: number
  selectedId?: string
  onSelect?: (id: string) => void
  interactive?: boolean  // show drag handles
}
```

### 4.2 Split ToolEditor

Extract from the 1011-line monolith:
- `ToolEditorToolbar` — mode buttons, snap toggle, smooth toggle + slider, undo/redo
- `ToolEditorCanvas` — SVG rendering, vertex handles, polygon path
- Keep `ToolEditor` as the orchestrator holding state and passing props

### 4.3 Split BinEditor

Same pattern:
- `BinEditorToolbar` — tool select, text mode, snap, smooth toggle + slider, selection actions
- `BinEditorCanvas` — SVG rendering, tool shapes, label rendering
- Keep `BinEditor` as orchestrator

### 4.4 Clean up `isCutoutMode` in ToolEditor

The predicate `editMode === 'finger-hole' || editMode === 'circle' || ...` is inlined 3 times. Compute once at the top of the component and reference the boolean.

---

## Not in scope

- New features or behaviour changes
- Test coverage (separate effort)
- CSS/styling changes
- Performance optimisation
