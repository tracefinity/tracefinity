"""test that tool polygons extending beyond the bin wall are clipped
at the interior boundary, not punched through the wall."""

from pathlib import Path

import pytest
import trimesh
from shapely.geometry import Point, Polygon

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import (
    GF_GRID,
    ManifoldSTLGenerator,
)


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

    gen = ManifoldSTLGenerator()

    body_overflow, _ = gen.generate_bin(
        [overflow_poly], config, str(tmp_path / "overflow.stl")
    )
    body_clipped, _ = gen.generate_bin(
        [clipped_poly], config, str(tmp_path / "clipped.stl")
    )
    body_empty, _ = gen.generate_bin(
        [], config, str(tmp_path / "empty.stl")
    )

    # both should remove material compared to the empty bin
    assert body_overflow.volume() < body_empty.volume()
    assert body_clipped.volume() < body_empty.volume()

    # the overflow and clipped bins should have the same volume
    # (within mesh tolerance) if clipping is working
    vol_diff = abs(body_overflow.volume() - body_clipped.volume())
    assert vol_diff < 1.0, (
        f"volume mismatch: overflow={body_overflow.volume():.1f} vs "
        f"clipped={body_clipped.volume():.1f}, diff={vol_diff:.1f}mm^3. "
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
    ManifoldSTLGenerator().generate_bin([tool], config, str(path))
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
    ManifoldSTLGenerator().generate_bin([tool], config, str(path))
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
