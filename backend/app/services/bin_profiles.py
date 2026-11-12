"""Grid layout and profile rules for the native bin generator."""
import math
import os

from app.constants import GF_GRID
from app.models.schemas import GenerateRequest

GF_HALF_GRID = GF_GRID / 2  # 21mm


GF_HEIGHT_UNIT = 7.0


GF_BASE_HEIGHT = 4.75


GF_CORNER_R = 3.75     # 4.0 - 0.25 inset


LIP_D0 = 1.9


LIP_D1 = 1.8


LIP_D2 = 0.7


LIP_D4 = LIP_D0 + LIP_D2  # 2.6


TEXT_DPI = 200          # pixels per inch for text rendering


def bin_interior_inset(wall_thickness: float, stacking_lip: bool) -> float:
    """Wall and lip space reserved by bin auto-sizing."""
    return max(wall_thickness, LIP_D4 if stacking_lip else 0.0)


def _base_cell_layout(grid_units: float, cell_size: float) -> list[tuple[float, float]]:
    """cell centres and widths along one axis for the baseplate.

    for integer grid sizes every cell is cell_size wide. for fractional
    sizes (e.g. 3.5) the last cell is a half-width partial cell.
    returns list of (centre_offset, cell_width) tuples.
    """
    total = grid_units * GF_GRID
    n_cells = math.ceil(total / cell_size - 1e-9)
    cells: list[tuple[float, float]] = []
    for i in range(n_cells):
        w = min(cell_size, total - i * cell_size)
        if w < 1.0:
            break
        cx = i * cell_size + w / 2.0 - total / 2.0
        cells.append((cx, w))
    return cells


def _cell_center(ix: int, iy: int, grid_x: int, grid_y: int) -> tuple[float, float]:
    return (
        (ix - (grid_x - 1) / 2.0) * GF_GRID,
        (iy - (grid_y - 1) / 2.0) * GF_GRID,
    )


def _partial_cell_index(config: GenerateRequest, ix: int, iy: int) -> int:
    """Map backend grid coords to UI row-major partial_bins_values (row 0 = top)."""
    ui_row = math.ceil(config.grid_y) - 1 - iy
    return ui_row * math.ceil(config.grid_x) + ix


def _cell_enabled(config: GenerateRequest, ix: int, iy: int) -> bool:
    if not getattr(config, "partial_bins", False):
        return True
    values = getattr(config, "partial_bins_values", None) or []
    idx = _partial_cell_index(config, ix, iy)
    if idx >= len(values):
        return True
    return bool(values[idx])


def _all_cells_enabled(config: GenerateRequest) -> bool:
    if not getattr(config, "partial_bins", False):
        return True
    values = config.partial_bins_values or []
    expected = math.ceil(config.grid_x) * math.ceil(config.grid_y)
    if len(values) != expected:
        return True
    return all(values)


def _uses_partial_shell(config: GenerateRequest) -> bool:
    return getattr(config, "partial_bins", False) and not _all_cells_enabled(config)


def _partial_bins_connect_bases(config: GenerateRequest) -> bool:
    return getattr(config, "partial_bins_connect", False) and _uses_partial_shell(config)


def _partial_bins_retain_wall(config: GenerateRequest) -> bool:
    return getattr(config, "partial_bins_retain_wall", False) and _partial_bins_connect_bases(config)


def _cell_retains_base(config: GenerateRequest, ix: int, iy: int) -> bool:
    """Whether a grid cell still has base geometry (enabled, or connect-base disabled)."""
    return _cell_enabled(config, ix, iy) or _partial_bins_connect_bases(config)


def _exports_separated_partial_parts(config: GenerateRequest) -> bool:
    return _uses_partial_shell(config) and not _partial_bins_connect_bases(config)


def _partial_bounds(config: GenerateRequest) -> tuple[int, int, int, int]:
    grid_x = math.ceil(config.grid_x)
    grid_y = math.ceil(config.grid_y)
    enabled = [
        (ix, iy)
        for iy in range(grid_y)
        for ix in range(grid_x)
        if _cell_enabled(config, ix, iy)
    ]
    if not enabled:
        return 0, grid_x - 1, 0, grid_y - 1
    ixs = [p[0] for p in enabled]
    iys = [p[1] for p in enabled]
    return min(ixs), max(ixs), min(iys), max(iys)


def _effective_grid_span(config: GenerateRequest) -> tuple[int, int]:
    if not _uses_partial_shell(config):
        return math.ceil(config.grid_x), math.ceil(config.grid_y)
    min_ix, max_ix, min_iy, max_iy = _partial_bounds(config)
    return max_ix - min_ix + 1, max_iy - min_iy + 1


def _bin_top_z(config: GenerateRequest, wall_top_z: float) -> float:
    rim_units = (getattr(config, "rim_units", 0) or 0) if config.stacking_lip else 0
    rim_height = rim_units * GF_HEIGHT_UNIT
    lip_total = (LIP_D0 + LIP_D1 + LIP_D2) if config.stacking_lip else 0
    return wall_top_z + rim_height + lip_total


PARTIAL_BIN_RETAIN_WALL_PRESERVE_MM = LIP_D0 + LIP_D2


def _grid_cell_counts(config: GenerateRequest) -> tuple[int, int]:
    return math.ceil(config.grid_x), math.ceil(config.grid_y)


def _label_layout_cell(config: GenerateRequest, x_mm: float, y_mm: float) -> tuple[int, int]:
    """Map a text label position (bin layout mm, origin top-left) to grid cell indices."""
    grid_x, grid_y = _grid_cell_counts(config)
    ix = min(max(int(x_mm // GF_GRID), 0), grid_x - 1)
    # rows pitch from the bottom; fractional remainder band is the top row
    iy = min(max(int((config.grid_y * GF_GRID - y_mm) // GF_GRID), 0), grid_y - 1)
    return ix, iy


def _label_in_enabled_cell(config: GenerateRequest, x_mm: float, y_mm: float) -> bool:
    if not _uses_partial_shell(config):
        return True
    ix, iy = _label_layout_cell(config, x_mm, y_mm)
    return _cell_enabled(config, ix, iy)


def _find_disabled_components(config: GenerateRequest) -> list[list[tuple[int, int]]]:
    components: list[list[tuple[int, int]]] = []
    visited: set[tuple[int, int]] = set()
    grid_x, grid_y = _grid_cell_counts(config)

    for iy in range(grid_y):
        for ix in range(grid_x):
            if _cell_enabled(config, ix, iy) or (ix, iy) in visited:
                continue
            cells: list[tuple[int, int]] = []
            stack = [(ix, iy)]
            while stack:
                x, y = stack.pop()
                if (x, y) in visited or _cell_enabled(config, x, y):
                    continue
                visited.add((x, y))
                cells.append((x, y))
                for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < grid_x and 0 <= ny < grid_y:
                        stack.append((nx, ny))
            components.append(cells)

    return components


def _component_world_bbox(config: GenerateRequest, cells: list[tuple[int, int]]):
    half = GF_GRID / 2.0
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for ix, iy in cells:
        cx, cy = _cell_center(ix, iy, config.grid_x, config.grid_y)
        min_x = min(min_x, cx - half)
        max_x = max(max_x, cx + half)
        min_y = min(min_y, cy - half)
        max_y = max(max_y, cy + half)
    return min_x, min_y, max_x, max_y


def _disabled_cells(config: GenerateRequest):
    grid_x, grid_y = _grid_cell_counts(config)
    for iy in range(grid_y):
        for ix in range(grid_x):
            if not _cell_enabled(config, ix, iy):
                yield ix, iy, *_cell_center(ix, iy, config.grid_x, config.grid_y)


def _connect_wall_rectangles(config: GenerateRequest):
    """Centres and dimensions of wall cuts in disabled cells."""
    retain_wall = _partial_bins_retain_wall(config)
    bin_hw = (config.grid_x * GF_GRID - 0.5) / 2.0
    bin_hh = (config.grid_y * GF_GRID - 0.5) / 2.0
    half = GF_GRID / 2.0
    preserve = PARTIAL_BIN_RETAIN_WALL_PRESERVE_MM
    grid_x, grid_y = _grid_cell_counts(config)

    for ix, iy, cx, cy in _disabled_cells(config):
        if retain_wall:
            x0, x1 = cx - half, cx + half
            y0, y1 = cy - half, cy + half
            if ix == 0:
                x0 = max(x0, -bin_hw + preserve)
            if ix == grid_x - 1:
                x1 = min(x1, bin_hw - preserve)
            if iy == 0:
                y0 = max(y0, -bin_hh + preserve)
            if iy == grid_y - 1:
                y1 = min(y1, bin_hh - preserve)
            w, h = x1 - x0, y1 - y0
            if w <= 0.1 or h <= 0.1:
                continue
            ccx, ccy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            yield ccx, ccy, w, h
        else:
            yield cx, cy, GF_GRID, GF_GRID


def _stability_plate_profiles(config: GenerateRequest):
    """Centres, dimensions and radii of floor bridges in connect mode."""
    overlap = GF_GRID / 2.0
    outer_w = config.grid_x * GF_GRID - 0.5
    outer_h = config.grid_y * GF_GRID - 0.5
    bin_hw = outer_w / 2.0
    bin_hh = outer_h / 2.0
    grid_x, grid_y = _grid_cell_counts(config)

    for cells in _find_disabled_components(config):
        min_x, min_y, max_x, max_y = _component_world_bbox(config, cells)

        for ix, iy in cells:
            for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nx, ny = ix + dx, iy + dy
                if not (0 <= nx < grid_x and 0 <= ny < grid_y):
                    continue
                if not _cell_enabled(config, nx, ny):
                    continue
                ncx, ncy = _cell_center(nx, ny, config.grid_x, config.grid_y)
                if dx == 1:
                    max_x = max(max_x, ncx + overlap)
                elif dx == -1:
                    min_x = min(min_x, ncx - overlap)
                if dy == 1:
                    max_y = max(max_y, ncy + overlap)
                elif dy == -1:
                    min_y = min(min_y, ncy - overlap)

        min_x = max(min_x, -bin_hw)
        max_x = min(max_x, bin_hw)
        min_y = max(min_y, -bin_hh)
        max_y = min(max_y, bin_hh)

        w, h = max_x - min_x, max_y - min_y
        ccx, ccy = (min_x + max_x) / 2.0, (min_y + max_y) / 2.0
        corner_r = min(GF_CORNER_R, w / 2.0, h / 2.0)
        yield ccx, ccy, w, h, corner_r


def _resolve_pocket_depth(override: float | None, config, max_depth: float) -> float:
    """Per-feature pocket depth: override → config.cutout_depth fallback,
    plus insert_height when enabled. The physical maximum takes precedence
    over the usual 5mm minimum for shallow bins."""
    base = override if override is not None else config.cutout_depth
    if getattr(config, 'insert_enabled', False):
        base += getattr(config, 'insert_height', 1.0)
    return min(max_depth, max(5, base))


def _filleted_rect_radius(width: float, pocket_depth: float) -> float:
    """Bottom fillet radius for the filleted-rectangle cutter profile."""
    return max(0.0, min(width / 3.0, pocket_depth / 2.0))


def _magnet_centres(config: GenerateRequest):
    """Magnet positions in retained full-size base cells."""
    if getattr(config, "half_grid_base", False):
        return
    corners_only = getattr(config, "magnet_corners_only", False)

    x_cells = _base_cell_layout(config.grid_x, GF_GRID)
    y_cells = _base_cell_layout(config.grid_y, GF_GRID)

    if not x_cells or not y_cells:
        return

    # skip partial cells (width < 42mm) -- magnets only on full cells
    x_full = [(cx, cw) for cx, cw in x_cells if abs(cw - GF_GRID) < 0.01]
    y_full = [(cy, ch) for cy, ch in y_cells if abs(ch - GF_GRID) < 0.01]

    if not x_full or not y_full:
        return

    # outer bin corners for corners_only mode
    outer_corners = set()
    if corners_only:
        grid_ix_max = math.ceil(config.grid_x) - 1
        grid_iy_max = math.ceil(config.grid_y) - 1
        for ix, (cx, _) in enumerate([x_full[0], x_full[-1]]):
            for iy, (cy, _) in enumerate([y_full[0], y_full[-1]]):
                if not _cell_retains_base(config, ix if ix == 0 else grid_ix_max, iy if iy == 0 else grid_iy_max):
                    continue
                for dx, dy in [(-13.0, -13.0), (13.0, -13.0), (13.0, 13.0), (-13.0, 13.0)]:
                    # only the corner nearest the bin edge
                    if cx == x_full[0][0] and dx > 0 and len(x_full) > 1:
                        continue
                    if cx == x_full[-1][0] and dx < 0 and len(x_full) > 1:
                        continue
                    if cy == y_full[0][0] and dy > 0 and len(y_full) > 1:
                        continue
                    if cy == y_full[-1][0] and dy < 0 and len(y_full) > 1:
                        continue
                    outer_corners.add((round(cx + dx, 4), round(cy + dy, 4)))

    grid_ix = math.ceil(config.grid_x)
    grid_iy = math.ceil(config.grid_y)
    for iy in range(grid_iy):
        for ix in range(grid_ix):
            if not _cell_retains_base(config, ix, iy):
                continue
            cx, cy = _cell_center(ix, iy, config.grid_x, config.grid_y)
            if not any(abs(cx - fx) < 0.01 for fx, _ in x_full):
                continue
            if not any(abs(cy - fy) < 0.01 for fy, _ in y_full):
                continue
            for dx, dy in [(-13.0, -13.0), (13.0, -13.0), (13.0, 13.0), (-13.0, 13.0)]:
                pos = (round(cx + dx, 4), round(cy + dy, 4))
                if corners_only and pos not in outer_corners:
                    continue
                yield pos


def _load_font(size_px: int):
    from PIL import ImageFont

    candidates = [
        "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size_px)
            except Exception:
                pass
    return ImageFont.load_default(size=size_px)
