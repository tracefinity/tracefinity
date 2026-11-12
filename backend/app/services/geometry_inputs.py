"""Prepare traced outlines and saved bin settings for the native CAD worker."""

import math
from itertools import product

from shapely import affinity, remove_repeated_points, union_all
from shapely.geometry import Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.strtree import STRtree

from app.constants import GF_GRID
from app.models.schemas import GenerateRequest
from app.services import bin_profiles as grid
from app.services.polygon_scaler import ScaledPolygon

PARTIAL_CORNER_CLEARANCE_MM = 0.01
POCKET_CONTACT_RELIEF_MM = 0.005


def _polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [orient(geometry)]
    return [orient(p) for p in getattr(geometry, "geoms", []) if p.geom_type == "Polygon" and p.area > 0]


def _rings(shape):
    shape = remove_repeated_points(shape)
    return [list(ring.coords[:-1]) for ring in (shape.exterior, *shape.interiors)]


def _extrusion(shape, low, high):
    return {"rings": _rings(shape), "low": low, "high": high}


def _relieve_corner_contacts(shapes, distance):
    if len(shapes) < 2:
        return shapes
    contacts = set()
    for a, b in STRtree(shapes).query(shapes, predicate="touches").T:
        if a < b and shapes[a].intersection(shapes[b]).geom_type in {"Point", "MultiPoint"}:
            contacts.update((a, b))
    return [shape.buffer(distance, join_style="mitre") if index in contacts else shape
            for index, shape in enumerate(shapes)]


def _outline(placement, x0, y0):
    outer = [(x - x0, y0 - y) for x, y in placement.points_mm]
    holes = [[(x - x0, y0 - y) for x, y in ring] for ring in placement.interior_rings_mm if len(ring) >= 3]
    return outer, holes


def _label_profiles(text, font_size):
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw

    px_per_mm = grid.TEXT_DPI / 25.4
    font = grid._load_font(max(8, int(font_size * px_per_mm)))
    left, top, right, bottom = font.getbbox(text)
    image = Image.new("L", (right-left+16, bottom-top+16), 255)
    ImageDraw.Draw(image).text((8-left, 8-top), text, fill=0, font=font)
    _, binary = cv2.threshold(np.asarray(image), 127, 255, cv2.THRESH_BINARY_INV)
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    w, h = image.size
    rings = [
        [((x-w/2)/px_per_mm, (h/2-y)/px_per_mm) for x, y in contour.reshape(-1, 2)]
        for contour in contours
    ]
    shapes = []
    for i, (_, _, _, parent) in enumerate(hierarchy[0]):
        if parent != -1 or len(rings[i]) < 3:
            continue
        holes = [r for r, relation in zip(rings, hierarchy[0]) if relation[3] == i and len(r) >= 3]
        polygon = Polygon(rings[i], holes)
        shapes.extend(_polygons(polygon if polygon.is_valid else polygon.buffer(0)))
    return shapes


def _labels(config, tool_floors, x0, y0, wall):
    recessed = []
    embossed = []
    for label in config.text_labels:
        if not grid._label_in_enabled_cell(config, label.x, label.y):
            continue
        x, y = label.x-x0, y0-label.y
        at = Point(x, y)
        floor = min((z for polygon, z in tool_floors if polygon.covers(at)), default=wall)
        for shape in _label_profiles(label.text, label.font_size):
            shape = affinity.translate(affinity.rotate(shape, -label.rotation, origin=(0, 0)), x, y)
            if label.emboss:
                embossed.append(_extrusion(shape, floor, floor+label.depth))
            else:
                recessed.append(_extrusion(shape, floor-label.depth, floor+0.01))
    return recessed, embossed


def split_points(total_mm, grid_count, bed_size):
    if bed_size <= 0 or total_mm <= bed_size:
        return []
    half_units = int(grid_count * 2)
    num_pieces = math.ceil(half_units / max(1, int(bed_size // grid.GF_HALF_GRID)))
    base, extra = divmod(half_units, num_pieces)
    return [-total_mm/2 + (i*base + min(i, extra))*grid.GF_HALF_GRID for i in range(1, num_pieces)]


def _splits(config):
    if config.bed_size <= 0:
        return [[], []]
    span_x, span_y = ((config.grid_x, config.grid_y) if grid._partial_bins_connect_bases(config)
                      else grid._effective_grid_span(config))
    if (span_x + span_y) * GF_GRID / math.sqrt(2) <= config.bed_size:
        return [[], []]
    return [split_points(size*GF_GRID, size, config.bed_size) for size in (config.grid_x, config.grid_y)]


def _feet(config):
    pitch = grid.GF_HALF_GRID if config.half_grid_base else GF_GRID
    xs, ys = (grid._base_cell_layout(size, pitch) for size in (config.grid_x, config.grid_y))
    magnets = set(grid._magnet_centres(config)) if config.magnets else set()
    for (x, w), (y, d) in product(xs, ys):
        yield {
            "at": [x, y],
            "size": [w-0.5, d-0.5],
            "magnets": [[dx, dy] for dx, dy in product((-13., 13.), repeat=2)
                        if (round(x+dx, 4), round(y+dy, 4)) in magnets],
        }


def _diagonal_corner_cuts(config):
    columns, rows = grid._grid_cell_counts(config)
    for ix, iy in product(range(columns - 1), range(rows - 1)):
        lower_left = grid._cell_enabled(config, ix, iy)
        if (lower_left == grid._cell_enabled(config, ix + 1, iy + 1)
                and lower_left != grid._cell_enabled(config, ix + 1, iy)
                and lower_left != grid._cell_enabled(config, ix, iy + 1)):
            cx, cy = grid._cell_center(ix, iy, config.grid_x, config.grid_y)
            x, y = cx + GF_GRID / 2, cy + GF_GRID / 2
            clearance = PARTIAL_CORNER_CLEARANCE_MM
            # Bevel the meeting corners to remove the zero-width seam.
            yield Polygon([(x - clearance, y), (x, y - clearance),
                           (x + clearance, y), (x, y + clearance)])


def _trim(config, top):
    if not grid._uses_partial_shell(config):
        return [], []
    if grid._partial_bins_connect_bases(config):
        low = grid.GF_BASE_HEIGHT
        rects = grid._connect_wall_rectangles(config)
        bridges = [{"at": [x, y], "size": [w, d], "radius": r}
                   for x, y, w, d, r in grid._stability_plate_profiles(config)]
    else:
        low = -1.
        rects = ((x, y, GF_GRID, GF_GRID) for _, _, x, y in grid._disabled_cells(config))
        bridges = []
    profiles = [box(x-w/2, y-d/2, x+w/2, y+d/2) for x, y, w, d in rects]
    profiles.extend(_diagonal_corner_cuts(config))
    # Shared grid edges can be a few floating-point units apart after insetting
    # the retained wall. Snap the trim before unioning the corner bevels.
    clipped = union_all(profiles, grid_size=0.000001)
    return [_extrusion(shape, low, top+1) for shape in _polygons(clipped)], bridges


def build_job(polygons: list[ScaledPolygon], config: GenerateRequest):
    x0, y0 = (config.grid_x*GF_GRID/2, config.grid_y*GF_GRID/2)
    wall = config.height_units * grid.GF_HEIGHT_UNIT
    top = grid._bin_top_z(config, wall)
    max_depth = wall-grid.GF_BASE_HEIGHT-2
    default_depth = grid._resolve_pocket_depth(None, config, max_depth)
    trim, bridges = _trim(config, top)
    pocket_specs, fingers, insert_shapes = [], [], []
    for placement in polygons:
        depth = grid._resolve_pocket_depth(placement.depth_override, config, max_depth)
        chamfer = min(config.cutout_chamfer, max(depth-1, 0))
        if len(placement.points_mm) >= 3:
            outer, holes = _outline(placement, x0, y0)
            shape = Polygon(outer, holes)
            shapes = _polygons(shape if shape.is_valid else shape.buffer(0))
            for shape in shapes:
                floor = wall-depth
                fit = min(0.05, config.cutout_clearance/10) if placement.smoothed else 0
                pocket_specs.append((shape, floor, fit, chamfer))
                if config.insert_enabled:
                    clearance = max(config.insert_clearance, fit)
                    inset = shape.buffer(-clearance, join_style="mitre") if clearance else shape
                    insert_shapes.extend(_polygons(inset))
        for hole in placement.finger_holes:
            override = hole.depth_override if hole.depth_override is not None else placement.depth_override
            finger_depth = grid._resolve_pocket_depth(override, config, max_depth)
            w = hole.width_mm or 2*hole.radius_mm
            d = hole.height_mm or 2*hole.radius_mm
            if hole.shape == "square":
                w = d = 2*hole.radius_mm
            fingers.append({
                "at": [hole.x_mm-x0, y0-hole.y_mm], "floor": wall-finger_depth, "shape": hole.shape,
                "radius": hole.radius_mm, "size": [w, d], "angle": -hole.rotation,
                "round": grid._filleted_rect_radius(w, finger_depth),
                "chamfer": min(config.cutout_chamfer, max(finger_depth-1, 0)),
            })
    # Merge point-touching voids with microscopic overlap. Give inserts a gap
    # at equivalent contacts so they remain individually printable.
    outlines = _relieve_corner_contacts([shape for shape, *_ in pocket_specs], POCKET_CONTACT_RELIEF_MM)
    pockets, tool_floors = [], []
    for outline, (_, floor, fit, chamfer) in zip(outlines, pocket_specs, strict=True):
        x, y, right, back = outline.bounds
        pockets.append({
            "rings": _rings(orient(outline)), "floor": floor, "fit": fit, "chamfer": chamfer,
            "center": [(x+right)/2, (y+back)/2],
            "scale": [1+2*chamfer/(right-x), 1+2*chamfer/(back-y)],
        })
        tool_floors.append((outline, floor))
    insert_shapes = _relieve_corner_contacts(insert_shapes, -POCKET_CONTACT_RELIEF_MM)
    inserts = [_extrusion(piece, 0, config.insert_height)
               for shape in insert_shapes for piece in _polygons(shape)]
    recessed, embossed = _labels(config, tool_floors, x0, y0, wall)
    return {
        "size": [2*x0-0.5, 2*y0-0.5], "wall_top": wall, "lip": config.stacking_lip,
        "rim": config.rim_units*grid.GF_HEIGHT_UNIT, "wall": config.wall_thickness,
        "allow_wall_cutouts": config.allow_wall_cutouts, "blank_floor": None if polygons else wall-default_depth,
        "feet": list(_feet(config)), "magnet": [config.magnet_diameter/2, config.magnet_depth],
        "trim": trim, "bridges": bridges, "pockets": pockets, "fingers": fingers,
        "recessed": recessed, "embossed": embossed, "inserts": inserts,
        "splits": _splits(config), "separate": grid._exports_separated_partial_parts(config),
    }
