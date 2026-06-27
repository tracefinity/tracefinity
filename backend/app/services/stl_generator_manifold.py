"""manifold3d STL generator - full replacement for build123d/OCCT.

10-100x faster on boolean operations. Uses PIL+cv2 for text labels.
"""
import logging
import math
import os
import time

import numpy as np

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon

logger = logging.getLogger(__name__)

from app.constants import GF_GRID

GF_HALF_GRID = GF_GRID / 2  # 21mm
GF_HEIGHT_UNIT = 7.0
GF_BASE_HEIGHT = 4.75
GF_CORNER_R = 3.75     # 4.0 - 0.25 inset

# base layer heights (bottom to top)
BASE_H_BOT = 0.8
BASE_H_MID = 1.8
BASE_H_TOP = 2.15      # = GF_BASE_HEIGHT - BASE_H_BOT - BASE_H_MID

# stacking lip dimensions (d0..d4 from gridfinity spec)
LIP_D0 = 1.9
LIP_D1 = 1.8
LIP_D2 = 0.7
LIP_D3 = 1.2
LIP_D4 = LIP_D0 + LIP_D2  # 2.6

MAGNET_DIAMETER = 6.0
MAGNET_DEPTH = 2.4
MAGNET_INSET = 4.8     # from cell corner to magnet centre

CIRCLE_SEGS = 48        # profile corner resolution (2D)
ROUND_SEGS = 128        # sphere/cylinder resolution (3D cutters)
TEXT_DPI = 200          # pixels per inch for text rendering


# ── geometry helpers ─────────────────────────────────────────────────────────

def _rounded_rect_pts(w: float, h: float, r: float, segs: int = CIRCLE_SEGS) -> np.ndarray:
    """CCW polygon for a w×h rectangle with corner radius r, centred at origin."""
    n = max(3, segs // 4)
    cx, cy = w / 2 - r, h / 2 - r
    pts = []
    for i, (ox, oy) in enumerate([(-cx, -cy), (cx, -cy), (cx, cy), (-cx, cy)]):
        base = i * math.pi / 2 + math.pi
        for j in range(n):
            a = base + j * (math.pi / 2) / n
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return np.array(pts, dtype=np.float64)


def _cs(pts: np.ndarray):
    import manifold3d as mf
    return mf.CrossSection([np.asarray(pts, dtype=np.float64)])


def _signed_area(pts: np.ndarray) -> float:
    """Signed 2D polygon area; positive means CCW."""
    arr = np.asarray(pts, dtype=np.float64)
    if len(arr) < 3:
        return 0.0
    x = arr[:, 0]
    y = arr[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _ensure_ccw(pts: np.ndarray) -> np.ndarray:
    """Return points in CCW order for manifold3d CrossSection input."""
    arr = np.asarray(pts, dtype=np.float64)
    return arr if _signed_area(arr) >= 0 else arr[::-1].copy()


def _build_base_unit(outer_w: float, outer_h: float):
    """Solid gridfinity base unit for one grid cell, centred at (0,0), z=0..GF_BASE_HEIGHT."""
    import manifold3d as mf

    mid_w = outer_w - 2 * BASE_H_TOP
    mid_h = outer_h - 2 * BASE_H_TOP
    bot_w = mid_w - 2 * BASE_H_BOT
    bot_h = mid_h - 2 * BASE_H_BOT
    r = GF_CORNER_R

    cs_bot = _cs(_rounded_rect_pts(bot_w, bot_h, r))
    cs_mid = _cs(_rounded_rect_pts(mid_w, mid_h, r))

    # bottom taper z=0→BASE_H_BOT: bot_w→mid_w
    l0 = mf.Manifold.extrude(cs_bot, BASE_H_BOT, scale_top=(mid_w / bot_w, mid_h / bot_h))
    # straight z=BASE_H_BOT→BASE_H_BOT+BASE_H_MID
    l1 = mf.Manifold.extrude(cs_mid, BASE_H_MID).translate((0.0, 0.0, BASE_H_BOT))
    # top taper z=BASE_H_BOT+BASE_H_MID→GF_BASE_HEIGHT: mid_w→outer_w
    l2 = mf.Manifold.extrude(
        cs_mid, BASE_H_TOP, scale_top=(outer_w / mid_w, outer_h / mid_h)
    ).translate((0.0, 0.0, BASE_H_BOT + BASE_H_MID))

    return mf.Manifold.batch_boolean([l0, l1, l2], mf.OpType.Add)


def _build_stacking_lip_notch(outer_w: float, outer_h: float):
    """
    Inner notch solid to subtract from the stacking lip.
    Built in notch-local coords where z=0 is the bottom of the notch
    (= wall_top - LIP_D3 - LIP_D4 in global coords) and z=8.2 is the top of the lip.

    Width profile from bottom (z=0) to top (z=8.2):
      z=0:              outer_w  (full outer, notch base)
      z=LIP_D4:         outer_w - 2*LIP_D4  (36.3mm for 1x1)
      z=LIP_D4+LIP_D3:  same  (straight)
      z=+LIP_D2:        outer_w - 2*LIP_D0  (37.7mm, widened)
      z=+LIP_D1:        same  (straight)
      z=+LIP_D0:        outer_w  (full outer, lip top opening)
    """
    import manifold3d as mf

    r = GF_CORNER_R
    nw_inner = outer_w - 2 * (LIP_D0 + LIP_D2)   # 36.3mm
    nh_inner = outer_h - 2 * (LIP_D0 + LIP_D2)
    nw_mid = outer_w - 2 * LIP_D0                 # 37.7mm
    nh_mid = outer_h - 2 * LIP_D0

    cs_outer = _cs(_rounded_rect_pts(outer_w, outer_h, r))
    cs_inner = _cs(_rounded_rect_pts(nw_inner, nh_inner, r))
    cs_mid = _cs(_rounded_rect_pts(nw_mid, nh_mid, r))

    z = 0.0
    # l0: outer→inner (taper inward going up), height=LIP_D4
    l0 = mf.Manifold.extrude(cs_outer, LIP_D4, scale_top=(nw_inner / outer_w, nh_inner / outer_h))
    z += LIP_D4
    # l1: straight at inner, height=LIP_D3
    l1 = mf.Manifold.extrude(cs_inner, LIP_D3).translate((0.0, 0.0, z))
    z += LIP_D3
    # l2: inner→mid (taper outward), height=LIP_D2
    l2 = mf.Manifold.extrude(
        cs_inner, LIP_D2, scale_top=(nw_mid / nw_inner, nh_mid / nh_inner)
    ).translate((0.0, 0.0, z))
    z += LIP_D2
    # l3: straight at mid, height=LIP_D1
    l3 = mf.Manifold.extrude(cs_mid, LIP_D1).translate((0.0, 0.0, z))
    z += LIP_D1
    # l4: mid→outer (taper outward), height=LIP_D0
    l4 = mf.Manifold.extrude(
        cs_mid, LIP_D0, scale_top=(outer_w / nw_mid, outer_h / nh_mid)
    ).translate((0.0, 0.0, z))

    return mf.Manifold.batch_boolean([l0, l1, l2, l3, l4], mf.OpType.Add)


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


def _build_shell(config: GenerateRequest):
    """Solid bin shell: base units + wall body to wall_top_z.

    Wall body terminates at wall_top_z only. The stacking lip is built
    separately in generate_bin and added on top, matching the original
    gf.Bin + StackingLip structure so the groove is only visible above
    wall_top_z and the large top-floor face is preserved.

    When half_grid_base is enabled, uses 21mm cells for the baseplate
    instead of 42mm cells, giving finer positioning on the baseplate.
    """
    import manifold3d as mf

    grid_x, grid_y = config.grid_x, config.grid_y
    height = config.height_units * GF_HEIGHT_UNIT
    outer_w = grid_x * GF_GRID - 0.5
    outer_h = grid_y * GF_GRID - 0.5
    r = GF_CORNER_R

    half_grid = getattr(config, "half_grid_base", False)
    cell_size = GF_HALF_GRID if half_grid else GF_GRID

    x_cells = _base_cell_layout(grid_x, cell_size)
    y_cells = _base_cell_layout(grid_y, cell_size)

    base_units = []
    for cy, ch in y_cells:
        for cx, cw in x_cells:
            unit = _build_base_unit(cw - 0.5, ch - 0.5)
            base_units.append(unit.translate((cx, cy, 0.0)))

    cs_wall = _cs(_rounded_rect_pts(outer_w, outer_h, r))
    wall_body = mf.Manifold.extrude(cs_wall, height - GF_BASE_HEIGHT).translate(
        (0.0, 0.0, GF_BASE_HEIGHT)
    )

    parts = base_units + [wall_body]
    return mf.Manifold.batch_boolean(parts, mf.OpType.Add)


# ── cutter builders ───────────────────────────────────────────────────────────

def _resolve_pocket_depth(override: float | None, config, max_depth: float) -> float:
    """Per-feature pocket depth: override → config.cutout_depth fallback,
    plus insert_height when enabled, clamped to [5, max_depth]."""
    base = override if override is not None else config.cutout_depth
    if getattr(config, 'insert_enabled', False):
        base += getattr(config, 'insert_height', 1.0)
    return max(5, min(base, max_depth))


def _filleted_rect_radius(width: float, pocket_depth: float) -> float:
    """Bottom fillet radius for the filleted-rectangle cutter profile."""
    return max(0.0, min(width / 3.0, pocket_depth / 2.0))


def _rounded_bottom_rect_profile_pts(
    width: float,
    depth: float,
    fillet_r: float,
    segs: int = CIRCLE_SEGS,
) -> np.ndarray:
    """CCW x/z profile for a rectangle with only the bottom corners filleted."""
    w = max(width, 0.01)
    d = max(depth, 0.01)
    hw = w / 2.0
    r = min(max(fillet_r, 0.0), hw, d)
    if r <= 1e-6:
        return _ensure_ccw(np.array([
            (hw, 0.0),
            (hw, d),
            (-hw, d),
            (-hw, 0.0),
        ], dtype=np.float64))

    n = max(4, segs // 8)
    pts: list[tuple[float, float]] = []

    # Start at the bottom-right floor point. Closing the polygon creates the
    # flat floor segment back from the bottom-left point.
    pts.append((hw - r, 0.0))

    right_cx, right_cy = hw - r, r
    for j in range(1, n + 1):
        a = -math.pi / 2.0 + j * (math.pi / 2.0) / n
        pts.append((right_cx + r * math.cos(a), right_cy + r * math.sin(a)))

    pts.append((hw, d))
    pts.append((-hw, d))

    left_cx, left_cy = -hw + r, r
    for j in range(0, n + 1):
        a = math.pi + j * (math.pi / 2.0) / n
        pts.append((left_cx + r * math.cos(a), left_cy + r * math.sin(a)))

    return _ensure_ccw(np.array(pts, dtype=np.float64))


def _make_filleted_rectangle_cutter(
    width: float,
    height: float,
    pocket_depth: float,
    wall_top_z: float,
    rotation: float,
    x: float,
    y: float,
):
    """Full-depth rectangle cutter with large bottom fillets along its length."""
    import manifold3d as mf

    w = max(width, 0.01)
    h = max(height, 0.01)
    z_margin = 0.005
    profile_depth = pocket_depth + z_margin * 2.0
    length = h
    r = _filleted_rect_radius(w, pocket_depth)
    profile = _rounded_bottom_rect_profile_pts(w, profile_depth, r)
    cs = _cs(profile)
    return (
        mf.Manifold.extrude(cs, length)
        .rotate((90.0, 0.0, 0.0))
        .translate((0.0, length / 2.0, wall_top_z - pocket_depth - z_margin))
        .rotate((0.0, 0.0, rotation))
        .translate((x, y, 0.0))
    )


def _make_magnet_holes(config: GenerateRequest):
    """Batch union of all magnet hole cylinders (4 per cell, or corners only).

    Magnets are always placed on full 42mm grid cells regardless of
    half_grid_base -- a 21mm cell is only 10.25mm from centre to edge
    (after 0.5mm clearance), so the 13mm magnet offset would extend
    beyond the cell boundary.
    """
    import manifold3d as mf

    if getattr(config, "half_grid_base", False):
        return mf.Manifold()

    diameter = getattr(config, "magnet_diameter", MAGNET_DIAMETER)
    depth = getattr(config, "magnet_depth", MAGNET_DEPTH)
    corners_only = getattr(config, "magnet_corners_only", False)

    r = diameter / 2
    mag = mf.Manifold.cylinder(depth + 0.01, r, circular_segments=ROUND_SEGS)

    x_cells = _base_cell_layout(config.grid_x, GF_GRID)
    y_cells = _base_cell_layout(config.grid_y, GF_GRID)

    if not x_cells or not y_cells:
        return mf.Manifold()

    # skip partial cells (width < 42mm) -- magnets only on full cells
    x_full = [(cx, cw) for cx, cw in x_cells if abs(cw - GF_GRID) < 0.01]
    y_full = [(cy, ch) for cy, ch in y_cells if abs(ch - GF_GRID) < 0.01]

    if not x_full or not y_full:
        return mf.Manifold()

    # outer bin corners for corners_only mode
    outer_corners = set()
    if corners_only:
        for cx, _ in [x_full[0], x_full[-1]]:
            for cy, _ in [y_full[0], y_full[-1]]:
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

    holes = []
    for cy, _ in y_full:
        for cx, _ in x_full:
            for dx, dy in [(-13.0, -13.0), (13.0, -13.0), (13.0, 13.0), (-13.0, 13.0)]:
                pos = (round(cx + dx, 4), round(cy + dy, 4))
                if corners_only and pos not in outer_corners:
                    continue
                holes.append(mag.translate((pos[0], pos[1], 0.0)))

    if not holes:
        return mf.Manifold()
    return mf.Manifold.batch_boolean(holes, mf.OpType.Add)


def _shapely_to_cross_sections(shifted_pts: list[tuple], interior_rings: list[list[tuple]] = None) -> list[np.ndarray]:
    """
    Validate and repair a polygon via Shapely before passing to Clipper2.
    Returns a list of ring arrays (exterior + hole rings for EvenOdd fill).

    Two-stage repair:
    1. buffer(0) for polygons that are already self-intersecting (GEOS-invalid)
    2. morphological open (erode+dilate by _CLIP_EPS) to merge near-touching
       edges that Clipper2's integer rounding would otherwise bridge — these
       pass Shapely's validity check but still trigger the Clipper2 chord artifact.
    """
    from shapely.geometry import MultiPolygon as _SMPoly
    from shapely.geometry import Polygon as _SPoly

    holes = interior_rings if interior_rings else []
    sp = _SPoly(shifted_pts, holes=holes)

    if not sp.is_valid:
        sp = sp.buffer(0)

    # morphological open: collapses thin peninsulas / near-touching edges
    # 0.05mm is well below any meaningful feature size but larger than Clipper2
    # integer-snapping distance (1e-6 mm at default 1e6 scale factor)
    _CLIP_EPS = 0.05
    cleaned = sp.buffer(-_CLIP_EPS).buffer(_CLIP_EPS)
    if not cleaned.is_empty and cleaned.area > sp.area * 0.9:
        if not cleaned.is_valid:
            cleaned = cleaned.buffer(0)
        sp = cleaned

    if sp.is_empty or sp.area <= 0:
        return []

    polys = list(sp.geoms) if isinstance(sp, _SMPoly) else [sp]
    rings = []
    for p in polys:
        if p.is_empty or p.area <= 0:
            continue
        rings.append(np.array(p.exterior.coords[:-1], dtype=np.float64))
        # include interior rings (holes) for EvenOdd fill
        for interior in p.interiors:
            hole_coords = interior.coords[:-1]
            if len(hole_coords) >= 3:
                rings.append(np.array(hole_coords, dtype=np.float64))
    return rings


def _clip_to_interior(
    shifted: list[tuple],
    shifted_holes: list[list[tuple]],
    interior_rect,
) -> tuple[list[tuple], list[list[tuple]]]:
    """clip a shifted polygon (+ holes) to the bin interior boundary.

    returns (clipped_exterior, clipped_holes). if the polygon is entirely
    outside the interior, returns empty lists.
    """
    from shapely.geometry import MultiPolygon as _SMPoly
    from shapely.geometry import Polygon as _SPoly

    poly = _SPoly(shifted, holes=shifted_holes if shifted_holes else [])
    if not poly.is_valid:
        poly = poly.buffer(0)
    clipped = poly.intersection(interior_rect)
    if clipped.is_empty:
        return [], []

    # intersection can return LineString/Point/GeometryCollection when
    # a polygon only touches the clip rect at an edge or corner
    if not isinstance(clipped, (_SPoly, _SMPoly)):
        return [], []

    # intersection can produce MultiPolygon; take the largest piece
    if isinstance(clipped, _SMPoly):
        clipped = max(clipped.geoms, key=lambda g: g.area)

    ext = list(clipped.exterior.coords[:-1])
    holes = [list(ring.coords[:-1]) for ring in clipped.interiors if len(ring.coords) >= 4]
    return ext, holes


def _interior_clip_rect(config):
    """clip boundary for the bin interior in manifold coordinates (centred at origin).

    when the stacking lip is enabled its inner profile protrudes inward by
    LIP_D0+LIP_D2 (2.6mm) from the outer wall -- wider than typical wall_thickness.
    use the larger of the two so cutouts never breach the lip zone.
    """
    from shapely.geometry import Polygon as _SPoly

    outer_w = config.grid_x * GF_GRID - 0.5
    outer_h = config.grid_y * GF_GRID - 0.5
    lip_inset = (LIP_D0 + LIP_D2) if getattr(config, "stacking_lip", False) else 0.0
    inset = max(config.wall_thickness, lip_inset)
    hw = outer_w / 2 - inset
    hh = outer_h / 2 - inset
    return _SPoly([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)])


def _make_polygon_cutouts(
    polygons: list[ScaledPolygon],
    config: GenerateRequest,
    wall_top_z: float,
    max_depth: float,
    offset_x: float,
    offset_y: float,
):
    """Batch union of all polygon cutout extrusions."""
    import manifold3d as mf

    interior_rect = _interior_clip_rect(config)

    cutters = []
    for poly in polygons:
        shifted = [
            (p[0] + offset_x, -(p[1] + offset_y))
            for p in poly.points_mm
        ]
        if len(shifted) < 3:
            continue
        # shift interior rings the same way
        shifted_holes = []
        for hole in (poly.interior_rings_mm or []):
            shifted_hole = [
                (p[0] + offset_x, -(p[1] + offset_y))
                for p in hole
            ]
            if len(shifted_hole) >= 3:
                shifted_holes.append(shifted_hole)

        # clip to bin interior so oversized tools don't breach walls
        shifted, shifted_holes = _clip_to_interior(shifted, shifted_holes, interior_rect)
        if len(shifted) < 3:
            continue

        try:
            rings = _shapely_to_cross_sections(shifted, shifted_holes)
            if not rings:
                continue
            has_holes = len(rings) > 1
            if has_holes:
                # use EvenOdd to handle holes -- same pattern as text labels
                cs = mf.CrossSection(rings, mf.FillRule.EvenOdd)
            else:
                cs = mf.CrossSection(rings)
            if cs.area() <= 0:
                cs = mf.CrossSection([r[::-1] for r in rings], mf.FillRule.EvenOdd if has_holes else mf.FillRule.Positive)
            if cs.area() > 0:
                pocket_depth = _resolve_pocket_depth(poly.depth_override, config, max_depth)
                cutter = mf.Manifold.extrude(cs, pocket_depth + 0.01).translate(
                    (0.0, 0.0, wall_top_z - pocket_depth)
                )
                cutters.append(cutter)
        except Exception as e:
            logger.warning("polygon cutout failed: %s", e)

    if not cutters:
        return None
    return mf.Manifold.batch_boolean(cutters, mf.OpType.Add)


def _make_chamfer_cutouts(
    polygons: list[ScaledPolygon],
    config,
    wall_top_z: float,
    chamfer_size: float,
    max_depth: float,
    offset_x: float,
    offset_y: float,
):
    """Per-polygon frustum cutter for the top-edge chamfer.

    Uses CrossSection.offset() for uniform chamfer width regardless of shape
    or rotation, then extrudes with scale_top to taper from the offset shape
    (at the bin surface) down to approximately the original shape.

    Chamfer is clamped per-polygon to (pocket_depth - 1) so deep cutouts get
    their full chamfer and shallow ones don't punch through the floor.
    """
    import manifold3d as mf

    interior_rect = _interior_clip_rect(config)

    cutters = []
    for poly in polygons:
        shifted = [
            (p[0] + offset_x, -(p[1] + offset_y))
            for p in poly.points_mm
        ]
        if len(shifted) < 3:
            continue
        shifted_holes = []
        for hole in (poly.interior_rings_mm or []):
            sh = [(p[0] + offset_x, -(p[1] + offset_y)) for p in hole]
            if len(sh) >= 3:
                shifted_holes.append(sh)

        # clip to bin interior so oversized tools don't breach walls
        shifted, shifted_holes = _clip_to_interior(shifted, shifted_holes, interior_rect)
        if len(shifted) < 3:
            continue

        pocket_depth = _resolve_pocket_depth(poly.depth_override, config, max_depth)
        eff_chamfer = min(chamfer_size, max(0.0, pocket_depth - 1))
        if eff_chamfer <= 0:
            continue

        try:
            rings = _shapely_to_cross_sections(shifted, shifted_holes)
            if not rings:
                continue
            has_holes = len(rings) > 1
            cs = mf.CrossSection(rings, mf.FillRule.EvenOdd) if has_holes else mf.CrossSection(rings)
            if cs.area() <= 0:
                cs = mf.CrossSection(
                    [r[::-1] for r in rings],
                    mf.FillRule.EvenOdd if has_holes else mf.FillRule.Positive,
                )
            if cs.area() <= 0:
                continue

            # offset for uniform chamfer width regardless of shape/rotation.
            # use the offset bounds to compute scale_top — more accurate
            # than raw bounding-box math for rotated/irregular shapes.
            cs_outer = cs.offset(eff_chamfer, mf.JoinType.Round)
            if cs_outer.is_empty() or cs_outer.area() <= 0:
                continue

            ob = cs_outer.bounds()
            ib = cs.bounds()
            ow = max(ob[2] - ob[0], 1e-6)
            oh = max(ob[3] - ob[1], 1e-6)
            iw = max(ib[2] - ib[0], 1e-6)
            ih = max(ib[3] - ib[1], 1e-6)

            # centre at the original CS bounding-box midpoint so scale_top
            # expands uniformly from the shape centre
            icx = (ib[0] + ib[2]) / 2
            icy = (ib[1] + ib[3]) / 2
            cs_centred = cs.translate((-icx, -icy))

            # base = original shape (inside pocket), top = wider offset shape
            # (bin surface). scale_top > 1 creates the taper.
            cutter = (
                mf.Manifold.extrude(
                    cs_centred, eff_chamfer + 0.01,
                    scale_top=(ow / iw, oh / ih),
                )
                .translate((icx, icy, wall_top_z - eff_chamfer))
            )
            cutters.append(cutter)
        except Exception as e:
            logger.warning("chamfer cutout failed: %s", e)

    if not cutters:
        return None
    return mf.Manifold.batch_boolean(cutters, mf.OpType.Add)


def _make_finger_holes(
    polygons: list[ScaledPolygon],
    config: GenerateRequest,
    wall_top_z: float,
    max_depth: float,
    offset_x: float,
    offset_y: float,
):
    """Batch union of all finger hole cutters.

    Per-feature depth: each hole resolves to its own depth_override, falling
    back to the parent polygon's override, then the global cutout_depth."""
    import manifold3d as mf

    cutters = []
    for poly in polygons:
        for fh in poly.finger_holes:
            fh_x = fh.x_mm + offset_x
            fh_y = -(fh.y_mm + offset_y)
            shape = getattr(fh, 'shape', 'circle')
            rotation = getattr(fh, 'rotation', 0.0)
            override = fh.depth_override if fh.depth_override is not None else poly.depth_override
            pocket_depth = _resolve_pocket_depth(override, config, max_depth)
            try:
                if shape == 'circle':
                    r = fh.radius_mm
                    pocket_floor_z = wall_top_z - pocket_depth
                    sphere_z = max(wall_top_z, pocket_floor_z + r)
                    # approximate sphere as a cylinder with hemispheric top
                    # using a simple cylinder for speed; close enough for slicer
                    cutter = mf.Manifold.sphere(r, circular_segments=ROUND_SEGS).translate(
                        (fh_x, fh_y, sphere_z)
                    )
                elif shape == 'cylinder':
                    r = fh.radius_mm
                    cutter = (
                        mf.Manifold.cylinder(pocket_depth + 0.01, r, circular_segments=ROUND_SEGS)
                        .translate((fh_x, fh_y, wall_top_z - pocket_depth))
                    )
                elif shape == 'square':
                    size = fh.radius_mm * 2
                    cut_z = wall_top_z - pocket_depth / 2
                    cutter = (
                        mf.Manifold.cube((size, size, pocket_depth + 0.01), center=True)
                        .rotate((0.0, 0.0, rotation))
                        .translate((fh_x, fh_y, cut_z))
                    )
                elif shape == 'rectangle':
                    w = fh.width_mm if fh.width_mm else fh.radius_mm * 2
                    h = fh.height_mm if fh.height_mm else fh.radius_mm * 2
                    cut_z = wall_top_z - pocket_depth / 2
                    cutter = (
                        mf.Manifold.cube((w, h, pocket_depth + 0.01), center=True)
                        .rotate((0.0, 0.0, rotation))
                        .translate((fh_x, fh_y, cut_z))
                    )
                elif shape == 'filleted_rectangle':
                    w = fh.width_mm if fh.width_mm else fh.radius_mm * 2
                    h = fh.height_mm if fh.height_mm else fh.radius_mm * 2
                    cutter = _make_filleted_rectangle_cutter(
                        w, h, pocket_depth, wall_top_z, rotation, fh_x, fh_y
                    )
                else:
                    continue
                cutters.append(cutter)
            except Exception as e:
                logger.warning("finger hole failed: %s", e)

    if not cutters:
        return None
    return mf.Manifold.batch_boolean(cutters, mf.OpType.Add)


def _make_finger_hole_chamfers(
    polygons: list[ScaledPolygon],
    config,
    wall_top_z: float,
    chamfer_size: float,
    max_depth: float,
    offset_x: float,
    offset_y: float,
):
    """Chamfer cutters for finger holes (circles, squares, rectangles).

    Per-feature: chamfer is clamped to (pocket_depth - 1) of each finger hole's
    own depth (override → parent polygon override → global cutout_depth)."""
    import manifold3d as mf

    cutters = []
    for poly in polygons:
        for fh in poly.finger_holes:
            fh_x = fh.x_mm + offset_x
            fh_y = -(fh.y_mm + offset_y)
            shape = getattr(fh, 'shape', 'circle')
            rotation = getattr(fh, 'rotation', 0.0)
            override = fh.depth_override if fh.depth_override is not None else poly.depth_override
            pocket_depth = _resolve_pocket_depth(override, config, max_depth)
            eff_chamfer = min(chamfer_size, max(0.0, pocket_depth - 1))
            if eff_chamfer <= 0:
                continue
            try:
                if shape == 'circle' or shape == 'cylinder':
                    r = fh.radius_mm
                    cs = mf.CrossSection.circle(r, circular_segments=ROUND_SEGS)
                    cs_outer = cs.offset(eff_chamfer, mf.JoinType.Round)
                elif shape == 'square':
                    size = fh.radius_mm * 2
                    cs = mf.CrossSection.square((size, size), center=True)
                    if rotation:
                        cs = cs.rotate(rotation)
                    cs_outer = cs.offset(eff_chamfer, mf.JoinType.Round)
                elif shape == 'rectangle' or shape == 'filleted_rectangle':
                    w = fh.width_mm if fh.width_mm else fh.radius_mm * 2
                    h = fh.height_mm if fh.height_mm else fh.radius_mm * 2
                    cs = mf.CrossSection.square((w, h), center=True)
                    if rotation:
                        cs = cs.rotate(rotation)
                    cs_outer = cs.offset(eff_chamfer, mf.JoinType.Round)
                else:
                    continue

                if cs_outer.is_empty() or cs_outer.area() <= 0:
                    continue

                # shapes are centred at origin, so scale_top from origin
                # gives a perfect taper
                ib = cs.bounds()
                ob = cs_outer.bounds()
                iw = max(ib[2] - ib[0], 1e-6)
                ih = max(ib[3] - ib[1], 1e-6)
                ow = max(ob[2] - ob[0], 1e-6)
                oh = max(ob[3] - ob[1], 1e-6)

                cutter = (
                    mf.Manifold.extrude(
                        cs, eff_chamfer + 0.01,
                        scale_top=(ow / iw, oh / ih),
                    )
                    .translate((fh_x, fh_y, wall_top_z - eff_chamfer))
                )
                cutters.append(cutter)
            except Exception as e:
                logger.warning("finger hole chamfer failed: %s", e)

    if not cutters:
        return None
    return mf.Manifold.batch_boolean(cutters, mf.OpType.Add)


# ── text label helpers ────────────────────────────────────────────────────────

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


def _text_to_cross_section(text: str, font_size_mm: float):
    """Render text to a PIL bitmap and trace contours → CrossSection centred at origin."""
    import cv2
    import manifold3d as mf
    from PIL import Image, ImageDraw

    px_per_mm = TEXT_DPI / 25.4
    font_size_px = max(8, int(font_size_mm * px_per_mm))
    pad_px = 8

    font = _load_font(font_size_px)
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    img_w = tw + 2 * pad_px
    img_h = th + 2 * pad_px
    img = Image.new('L', (img_w, img_h), 255)
    draw = ImageDraw.Draw(img)
    draw.text((pad_px - bbox[0], pad_px - bbox[1]), text, fill=0, font=font)

    arr = np.array(img)
    _, binary = cv2.threshold(arr, 127, 255, cv2.THRESH_BINARY_INV)

    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or hierarchy is None:
        return None

    hierarchy = hierarchy[0]
    cx_px = img_w / 2.0
    cy_px = img_h / 2.0

    polys = []
    for i, cnt in enumerate(contours):
        pts = cnt.reshape(-1, 2).astype(np.float64)
        if len(pts) < 3:
            continue
        pts[:, 0] = (pts[:, 0] - cx_px) / px_per_mm
        pts[:, 1] = -(pts[:, 1] - cy_px) / px_per_mm  # flip y
        polys.append(pts)

    if not polys:
        return None

    # EvenOdd handles holes in letters (O, A, B, etc.) automatically
    cs = mf.CrossSection(polys, mf.FillRule.EvenOdd)
    return cs if cs.area() > 0 else None


def _point_in_polygon(px: float, py: float, pts: list) -> bool:
    """ray-casting point-in-polygon test"""
    n = len(pts)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]["x"], pts[i]["y"]
        xj, yj = pts[j]["x"], pts[j]["y"]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _make_text_labels(
    config: GenerateRequest,
    wall_top_z: float,
    emboss_only: bool,
    offset_x: float,
    offset_y: float,
    pocket_depth: float = 0,
    polygons: list = None,
):
    """Build manifold solids for text labels. Returns (recessed_cutter, embossed_body).

    Labels inside tool cutouts sit at the cutout floor. Labels on the bin
    surface sit at wall_top_z.
    """
    import manifold3d as mf

    recessed = []
    embossed = []

    cutout_floor_z = wall_top_z - pocket_depth
    polys = polygons or []

    for tl in (config.text_labels or []):
        cs = _text_to_cross_section(tl.text, tl.font_size)
        if cs is None:
            continue

        try:
            lx = tl.x + offset_x
            ly = -(tl.y + offset_y)

            # determine if label centre is inside any tool cutout
            in_cutout = any(
                _point_in_polygon(tl.x, tl.y, p.get("points", []))
                for p in polys
            )
            base_z = cutout_floor_z if in_cutout else wall_top_z

            if tl.emboss:
                solid = (
                    mf.Manifold.extrude(cs, tl.depth)
                    .rotate((0.0, 0.0, -tl.rotation))
                    .translate((lx, ly, base_z))
                )
                embossed.append(solid)
            else:
                cutter = (
                    mf.Manifold.extrude(cs, tl.depth + 0.01)
                    .rotate((0.0, 0.0, -tl.rotation))
                    .translate((lx, ly, base_z - tl.depth - 0.01))
                )
                recessed.append(cutter)
        except Exception as e:
            logger.warning("text label '%s' failed: %s", tl.text, e)

    recessed_union = (
        mf.Manifold.batch_boolean(recessed, mf.OpType.Add) if recessed else None
    )
    embossed_union = (
        mf.Manifold.batch_boolean(embossed, mf.OpType.Add) if embossed else None
    )
    return recessed_union, embossed_union


def _shrink_rings(
    pts: list[tuple], holes: list[list[tuple]], amount: float
) -> list[tuple[list[tuple], list[list[tuple]]]]:
    """inward offset of a ring set. returns one ring set per resulting piece;
    a narrow neck can split the shape and every piece must survive.
    mitre join so convex corners stay sharp and match the pocket walls."""
    from shapely.geometry import Polygon as _SPoly
    from shapely.validation import make_valid

    sp = _SPoly(pts, holes=holes)
    if not sp.is_valid:
        sp = make_valid(sp)
    shrunk = sp.buffer(-amount, join_style=2)
    if shrunk.is_empty:
        return []
    if shrunk.geom_type == "Polygon":
        pieces = [shrunk]
    else:
        pieces = [
            g for g in getattr(shrunk, "geoms", [])
            if g.geom_type == "Polygon" and not g.is_empty
        ]
    return [
        (list(p.exterior.coords[:-1]), [list(i.coords[:-1]) for i in p.interiors])
        for p in pieces
    ]


# ── export helpers ────────────────────────────────────────────────────────────

def _manifold_to_trimesh(m):
    import trimesh

    mesh = m.to_mesh()
    verts = mesh.vert_properties[:, :3].astype(np.float64)
    faces = mesh.tri_verts.astype(np.int64)
    tm = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    # merge near-duplicate vertices and drop degenerate faces that manifold
    # boolean ops can introduce at intersection seams
    tm.merge_vertices()
    # drop zero-area faces, then clean up orphaned vertices
    mask = tm.nondegenerate_faces()
    tm.update_faces(mask)
    tm.remove_unreferenced_vertices()
    return tm


def _export_stl(m, path: str) -> None:
    tm = _manifold_to_trimesh(m)
    tm.export(path)


def _export_3mf(bin_m, text_m, path: str) -> None:
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(_manifold_to_trimesh(bin_m), node_name='bin', geom_name='bin')
    scene.add_geometry(_manifold_to_trimesh(text_m), node_name='text', geom_name='text')
    data = scene.export(file_type='3mf')
    with open(path, 'wb') as f:
        f.write(data)


# ── main generator class ──────────────────────────────────────────────────────

class ManifoldSTLGenerator:
    def generate_bin(
        self,
        polygons: list[ScaledPolygon],
        config: GenerateRequest,
        output_path: str,
        threemf_path: str | None = None,
    ):
        """Generate bin STL using manifold3d. Returns (bin_manifold, text_manifold)."""
        import manifold3d as mf

        t0 = time.monotonic()

        bin_width = config.grid_x * GF_GRID
        bin_depth = config.grid_y * GF_GRID
        offset_x = -bin_width / 2
        offset_y = -bin_depth / 2
        wall_top_z = config.height_units * GF_HEIGHT_UNIT

        # build solid shell (wall body to wall_top_z, no lip yet)
        t1 = time.monotonic()
        bin_body = _build_shell(config)
        logger.info("shell: %.2fs", time.monotonic() - t1)

        outer_w = config.grid_x * GF_GRID - 0.5
        outer_h = config.grid_y * GF_GRID - 0.5

        # raised rim ("collar"): a hollow perimeter wall extending the bin wall
        # above the floor face (wall_top_z) without filling the interior.  A
        # protruding tool sits in the open volume inside the collar, and the
        # stacking lip (if enabled) rides on top so a stacked bin clears the
        # tool.  Cutouts still pocket down from wall_top_z, unaffected by the rim.
        rim_units = (getattr(config, "rim_units", 0) or 0) if config.stacking_lip else 0
        rim_height = rim_units * GF_HEIGHT_UNIT
        lip_base_z = wall_top_z + rim_height
        # inner opening matches the stacking-lip inner opening so the collar wall
        # is flush with the lip's inner face (no inward overhang/ledge).
        rim_inner_w = outer_w - 2 * (LIP_D0 + LIP_D2)
        rim_inner_h = outer_h - 2 * (LIP_D0 + LIP_D2)

        if rim_height > 0:
            outer_solid = mf.Manifold.extrude(
                _cs(_rounded_rect_pts(outer_w, outer_h, GF_CORNER_R)), rim_height
            )
            inner_solid = mf.Manifold.extrude(
                _cs(_rounded_rect_pts(rim_inner_w, rim_inner_h, GF_CORNER_R)), rim_height
            )
            collar = (outer_solid - inner_solid).translate((0.0, 0.0, wall_top_z))
            bin_body = bin_body + collar
            logger.info("raised rim (%du): %.2fs", rim_units, time.monotonic() - t1)

        # stacking lip: build groove into a separate lip solid (z=lip_base_z to
        # z=lip_base_z+lip_total) and add it to the bin body.  The notch extends
        # below lip_base_z but only cuts the lip solid (not the wall/collar), so
        # the groove is invisible below lip_base_z — matching gf.Bin behaviour
        # and preserving the large top-floor face at z=wall_top_z.
        if config.stacking_lip:
            lip_total = LIP_D0 + LIP_D1 + LIP_D2
            notch_depth_below = LIP_D3 + LIP_D4
            cs_wall_lip = _cs(_rounded_rect_pts(outer_w, outer_h, GF_CORNER_R))
            lip_solid = mf.Manifold.extrude(cs_wall_lip, lip_total).translate(
                (0.0, 0.0, lip_base_z)
            )
            notch = _build_stacking_lip_notch(outer_w, outer_h).translate(
                (0.0, 0.0, lip_base_z - notch_depth_below)
            )
            lip_with_groove = lip_solid - notch
            bin_body = bin_body + lip_with_groove
            logger.info("stacking lip: %.2fs", time.monotonic() - t1)

        # collect remaining cutters (pocket, magnets, finger holes, text) and
        # subtract them in one pass to avoid sequential z-plane imprecision
        cutters: list = []

        if config.magnets and not config.half_grid_base:
            cutters.append(_make_magnet_holes(config))

        pocket_depth = 5
        if polygons:
            floor_z = GF_BASE_HEIGHT
            lip_deduction = (LIP_D3 + LIP_D4) if config.stacking_lip else 0
            max_depth = wall_top_z - floor_z - 2 - lip_deduction
            # Default pocket_depth (used by text labels below) still tracks the
            # global cutout_depth; per-cutout overrides are resolved inside the
            # cutter functions via _resolve_pocket_depth.
            pocket_depth = _resolve_pocket_depth(None, config, max_depth)

            t1 = time.monotonic()
            cutouts = _make_polygon_cutouts(polygons, config, wall_top_z, max_depth, offset_x, offset_y)
            if cutouts:
                cutters.append(cutouts)
            logger.info("polygon cutouts (%d): %.2fs", len(polygons), time.monotonic() - t1)

            t1 = time.monotonic()
            fholes = _make_finger_holes(polygons, config, wall_top_z, max_depth, offset_x, offset_y)
            if fholes:
                cutters.append(fholes)
            logger.info("finger holes: %.2fs", time.monotonic() - t1)

            chamfer_size = getattr(config, 'cutout_chamfer', 0.0)
            if chamfer_size > 0:
                t1 = time.monotonic()
                chamfers = _make_chamfer_cutouts(polygons, config, wall_top_z, chamfer_size, max_depth, offset_x, offset_y)
                if chamfers:
                    cutters.append(chamfers)
                fh_chamfers = _make_finger_hole_chamfers(polygons, config, wall_top_z, chamfer_size, max_depth, offset_x, offset_y)
                if fh_chamfers:
                    cutters.append(fh_chamfers)
                logger.info("chamfer cutouts: %.2fs", time.monotonic() - t1)

        # text labels (recessed cutters + embossed body additions)
        text_body = None
        if config.text_labels:
            t1 = time.monotonic()
            poly_dicts = [{"points": [{"x": p[0], "y": p[1]} for p in pg.points_mm]} for pg in polygons] if polygons else []
            recessed, embossed = _make_text_labels(config, wall_top_z, False, offset_x, offset_y, pocket_depth, poly_dicts)
            if recessed:
                cutters.append(recessed)
            if embossed and not embossed.is_empty():
                text_body = embossed
            logger.info("text labels: %.2fs", time.monotonic() - t1)

        # single boolean subtraction for all cutters
        if cutters:
            t1 = time.monotonic()
            all_cutters = mf.Manifold.batch_boolean(cutters, mf.OpType.Add)
            bin_body = bin_body - all_cutters
            logger.info("subtract all cutters: %.2fs", time.monotonic() - t1)

        logger.info("total generate_bin: %.2fs", time.monotonic() - t0)

        # export STL
        t1 = time.monotonic()
        if text_body:
            combined = bin_body + text_body
            _export_stl(combined, output_path)
        else:
            _export_stl(bin_body, output_path)
        logger.info("export_stl: %.2fs", time.monotonic() - t1)

        # 3MF export (multi-colour)
        if text_body and threemf_path:
            try:
                _export_3mf(bin_body, text_body, threemf_path)
            except Exception:
                logger.warning("3MF export failed, skipping", exc_info=True)

        return bin_body, text_body

    def generate_insert(
        self,
        polygons: list[ScaledPolygon],
        config,
        output_path: str,
        offset_x: float,
        offset_y: float,
    ) -> bool:
        import manifold3d as mf

        insert_height = getattr(config, 'insert_height', 1.0)
        # the insert must drop into the pocket cut from the same outline; FDM
        # bias makes pockets undersized and positives oversized, so shrink
        fit_clearance = getattr(config, 'insert_clearance', 0.2)
        shapes = []
        failed = 0
        for poly in polygons:
            shifted = [
                (p[0] + offset_x, -(p[1] + offset_y))
                for p in poly.points_mm
            ]
            if len(shifted) < 3:
                logger.warning("insert: skipping polygon %s (%d points)", poly.id, len(shifted))
                failed += 1
                continue
            shifted_holes = []
            for hole in (poly.interior_rings_mm or []):
                shifted_hole = [
                    (p[0] + offset_x, -(p[1] + offset_y))
                    for p in hole
                ]
                if len(shifted_hole) >= 3:
                    shifted_holes.append(shifted_hole)
            ring_sets = [(shifted, shifted_holes)]
            if fit_clearance > 0:
                ring_sets = _shrink_rings(shifted, shifted_holes, fit_clearance)
                if not ring_sets:
                    logger.warning("insert: polygon %s vanished at %.2fmm fit clearance", poly.id, fit_clearance)
                    failed += 1
                    continue
            made = 0
            try:
                for piece_pts, piece_holes in ring_sets:
                    rings = _shapely_to_cross_sections(piece_pts, piece_holes)
                    if not rings:
                        continue
                    has_holes = len(rings) > 1
                    cs = mf.CrossSection(rings, mf.FillRule.EvenOdd) if has_holes else mf.CrossSection(rings)
                    if cs.area() <= 0:
                        cs = mf.CrossSection([r[::-1] for r in rings], mf.FillRule.EvenOdd if has_holes else mf.FillRule.Positive)
                    if cs.area() > 0:
                        shapes.append(mf.Manifold.extrude(cs, insert_height))
                        made += 1
                if made == 0:
                    logger.warning("insert: empty cross-section for polygon %s", poly.id)
                    failed += 1
            except Exception as e:
                logger.warning("insert polygon %s failed: %s", poly.id, e)
                failed += 1

        if not shapes:
            logger.error("insert generation produced no shapes (%d polygons, %d failed)", len(polygons), failed)
            return False

        combined = mf.Manifold.batch_boolean(shapes, mf.OpType.Add)
        _export_stl(combined, output_path)
        logger.info("insert: exported %d shapes to %s", len(shapes), output_path)
        return True

    @staticmethod
    def _compute_split_points(total_mm: float, grid_count: float, bed_size: float) -> list[float]:
        """Split points relative to bin centre for one axis.

        Uses half-grid (21mm) granularity so fractional bins split cleanly.
        """
        if bed_size <= 0 or total_mm <= bed_size:
            return []
        import math as _m
        # work in half-units for split granularity
        half_units = int(grid_count * 2)
        max_halves = max(1, int(bed_size // GF_HALF_GRID))
        num_pieces = _m.ceil(half_units / max_halves)
        base = half_units // num_pieces
        extra = half_units % num_pieces
        sizes = [base + (1 if i < extra else 0) for i in range(num_pieces)]
        points = []
        pos = -total_mm / 2
        for s in sizes[:-1]:
            pos += s * GF_HALF_GRID
            points.append(pos)
        return points

    def split_bin(
        self,
        bin_body,
        text_body,
        config: GenerateRequest,
        bed_size: float,
        output_dir: str,
        session_id: str,
    ) -> list[str]:
        """Split completed bin into bed-sized pieces. Returns list of output paths."""
        import math

        bin_width = config.grid_x * GF_GRID
        bin_depth = config.grid_y * GF_GRID

        fits_diagonal = (bin_width + bin_depth) / math.sqrt(2) <= bed_size
        if fits_diagonal:
            return []

        x_cuts = self._compute_split_points(bin_width, config.grid_x, bed_size)
        y_cuts = self._compute_split_points(bin_depth, config.grid_y, bed_size)

        if not x_cuts and not y_cuts:
            return []

        part = bin_body + text_body if text_body else bin_body

        x_pieces = self._split_along_axis(part, x_cuts, axis='x')
        pieces = []
        for xp in x_pieces:
            pieces.extend(self._split_along_axis(xp, y_cuts, axis='y'))

        paths = []
        for i, piece in enumerate(pieces):
            path = f"{output_dir}/{session_id}_part{i + 1}.stl"
            _export_stl(piece, path)
            paths.append(path)

        return paths

    @staticmethod
    def _split_along_axis(part, cut_points: list[float], axis: str) -> list:
        if not cut_points:
            return [part]

        # normal vector for cut plane
        normal = (1.0, 0.0, 0.0) if axis == 'x' else (0.0, 1.0, 0.0)
        pieces = []
        remainder = part

        for cut in cut_points:
            top, bottom = remainder.split_by_plane(normal, cut)
            if not top.is_empty():
                pieces.append(top)
            remainder = bottom

        if not remainder.is_empty():
            pieces.append(remainder)

        return pieces
