"""Measure how cutouts meet the side wall, rim and stacking lip."""

from pathlib import Path

import pytest
import trimesh
from shapely.geometry import Point, Polygon

from app.models.schemas import GenerateRequest
from app.services.bin_profiles import (
    GF_GRID,
)
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from tests.geometry_support import render


def test_overflow_polygon_matches_clipped_equivalent(tmp_path: Path):
    """an oversized tool polygon should produce the same result as one
    that's been manually trimmed to the bin interior.

    we place a huge rectangle that overflows on all sides and compare
    its bin volume against a rectangle trimmed to just inside the walls.
    if clipping works, the two should produce identical geometry (same volume).
    if clipping is missing, the oversized polygon carves through the walls
    and removes more material, giving a smaller volume.
    """
    config = GenerateRequest(
        grid_x=1.5,
        grid_y=1.5,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        bed_size=0,
        wall_thickness=1.6,
    )
    bin_w = config.grid_x * GF_GRID
    bin_h = config.grid_y * GF_GRID

    # oversized polygon: extends 10mm beyond each edge
    overflow_poly = ScaledPolygon(
        id="overflow",
        points_mm=[
            (-10, -10),
            (bin_w + 10, -10),
            (bin_w + 10, bin_h + 10),
            (-10, bin_h + 10),
        ],
        label="overflow",
    )

    # manually clipped polygon: stays inside wall_thickness from each edge
    # (the interior boundary the clipping should enforce)
    wt = config.wall_thickness
    clipped_poly = ScaledPolygon(
        id="clipped",
        points_mm=[
            (wt, wt),
            (bin_w - wt, wt),
            (bin_w - wt, bin_h - wt),
            (wt, bin_h - wt),
        ],
        label="clipped",
    )


    body_overflow, _ = render(
        [overflow_poly], config, str(tmp_path / "overflow.stl")
    )
    body_clipped, _ = render(
        [clipped_poly], config, str(tmp_path / "clipped.stl")
    )
    body_empty, _ = render(
        [], config, str(tmp_path / "empty.stl")
    )

    # both should remove material compared to the empty bin
    assert body_overflow.volume < body_empty.volume
    assert body_clipped.volume < body_empty.volume

    # the overflow and clipped bins should have the same volume
    # (within mesh tolerance) if clipping is working
    vol_diff = abs(body_overflow.volume - body_clipped.volume)
    assert vol_diff < 1.0, (
        f"volume mismatch: overflow={body_overflow.volume:.1f} vs "
        f"clipped={body_clipped.volume:.1f}, diff={vol_diff:.1f}mm^3. "
        f"overflow polygon likely punching through walls."
    )


@pytest.mark.parametrize("rim_units", [0, 1])
@pytest.mark.parametrize("chamfer", [0, 2])
def test_tool_pocket_clears_lip_and_preserves_wall_and_floor(tmp_path, rim_units, chamfer):
    """Measure the printed opening at the pocket, rim and lip, and outside the tool."""
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=2, magnets=False, stacking_lip=True,
        rim_units=rim_units, wall_thickness=1.6, cutout_depth=7, cutout_chamfer=chamfer,
    )
    tool = ScaledPolygon(
        id="edge-tool", label="Edge tool",
        points_mm=[(26, 16), (45, 16), (45, 26), (26, 26)],
    )
    path = tmp_path / "lip-pocket.stl"
    render([tool], config, str(path))
    mesh = trimesh.load(path, force="mesh")
    assert mesh.is_watertight
    assert len(mesh.split()) == 1

    def section(z):
        outlines = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        assert outlines is not None
        return sorted((Polygon(loop[:, :2]) for loop in outlines.discrete), key=lambda p: -p.area)

    # The old clip stopped at x=18.15, and the old extrusion stopped at z=14.01.
    # Probe the intended opening all the way from the pocket to the lip.
    for z in [7.05, 13.9, 14.3, 14 + 7 * rim_units + 0.3]:
        outer, opening = section(z)
        assert opening.covers(Point(19.1, 0))
        assert not opening.covers(Point(19.2, 0))
        assert outer.bounds[2] == pytest.approx(20.75, abs=0.01)
    _, lip_opening = section(14 + 7 * rim_units + 0.3)
    assert not lip_opening.covers(Point(19.1, 12))  # unaffected stacking profile
    assert len(section(6.95)) == 1  # requested 7 mm depth, solid floor below it


@pytest.mark.parametrize("shape", ["cylinder", "square", "rectangle", "filleted_rectangle"])
@pytest.mark.parametrize("rim_units", [0, 1])
def test_flat_finger_hole_opens_side_wall_through_lip(tmp_path, shape, rim_units):
    config = GenerateRequest(
        grid_x=1, grid_y=2, height_units=2, magnets=False, stacking_lip=True,
        rim_units=rim_units, cutout_depth=7, allow_wall_cutouts=True,
    )
    hole = ScaledFingerHole("side-access", 21, 42, 23, shape, width_mm=50, height_mm=20)
    tool = ScaledPolygon(
        id="tool", label="Tool", finger_holes=[hole],
        points_mm=[(12, 37), (30, 37), (30, 47), (12, 47)],
    )
    path = tmp_path / "finger-hole.stl"
    render([tool], config, str(path))
    mesh = trimesh.load(path, force="mesh")
    assert mesh.is_watertight
    assert len(mesh.split()) == 1

    def has_material(x, y, z):
        section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        assert section is not None
        point = Point(x, y)
        return sum(Polygon(loop[:, :2]).covers(point) for loop in section.discrete) % 2 == 1

    for x in (-20.7, 20.7):
        assert has_material(x, 0, 6.95)
        for z in (13.9, 14.3, 14 + 7 * rim_units + 4.2):
            assert not has_material(x, 0, z)
            assert has_material(x, 30, z)


def test_overflow_at_rounded_corners_preserves_wall(tmp_path):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=2, magnets=False, stacking_lip=True,
        wall_thickness=0.8, cutout_depth=5, cutout_chamfer=2,
    )
    tool = ScaledPolygon(
        id="overflow", label="Overflow",
        points_mm=[(-5, -5), (47, -5), (47, 47), (-5, 47)],
    )
    path = tmp_path / "corners.stl"
    render([tool], config, str(path))
    mesh = trimesh.load(path, force="mesh")
    assert mesh.is_watertight
    for z in (13.9, 14.3):
        contours = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        assert contours is not None
        outer, opening = sorted(
            (Polygon(loop[:, :2]) for loop in contours.discrete), key=lambda p: -p.area,
        )
        assert outer.covers(opening)
        assert outer.boundary.distance(opening.boundary) == pytest.approx(0.8, abs=0.01)


@pytest.mark.parametrize("cutout", ["outline", "circle", "cylinder", "square", "rectangle", "filleted_rectangle"])
@pytest.mark.parametrize(("stacking_lip", "rim_units"), [(False, 0), (True, 0), (True, 1)])
def test_side_openings_require_opt_in(tmp_path, cutout, stacking_lip, rim_units):
    config = GenerateRequest(
        grid_x=1, grid_y=2, height_units=2, magnets=False, stacking_lip=stacking_lip,
        rim_units=rim_units, cutout_depth=7, cutout_chamfer=2,
    )
    points = [(16, 36), (29, 36), (29, 48), (16, 48)]
    holes = []
    if cutout == "outline":
        points = [(16, 36), (48, 36), (48, 48), (16, 48)]
    elif cutout == "circle":
        holes = [ScaledFingerHole("side-access", 35, 42, 7.4, cutout)]
    else:
        holes = [ScaledFingerHole("side-access", 21, 42, 23, cutout, width_mm=50, height_mm=20)]
    tool = ScaledPolygon(id="tool", label="Tool", points_mm=points, finger_holes=holes)
    levels = [13.9]
    if stacking_lip:
        levels.extend((14.3, 14 + 7 * rim_units + 4.2))

    for allow in (False, True):
        path = tmp_path / f"side-cutout-{allow}.stl"
        request = config.model_copy(update={"allow_wall_cutouts": allow}) if allow else config
        render([tool], request, str(path))
        mesh = trimesh.load(path, force="mesh")
        assert mesh.is_watertight
        assert len(mesh.split()) == 1

        for z in (6.95, *levels):
            section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
            assert section is not None
            loops = [Polygon(loop[:, :2]) for loop in section.discrete]

            def has_material(y):
                point = Point(20.7, y)
                return sum(loop.covers(point) for loop in loops) % 2 == 1

            assert has_material(0) == (z < 7 or not allow)
            assert has_material(30)
