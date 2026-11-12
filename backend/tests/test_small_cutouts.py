"""Small rectangle cutouts (issue #114): 25x5mm and 1mm-floor sizes must
produce valid geometry."""
from pathlib import Path

import pytest

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from tests.geometry_support import render


def _poly_with_rect_hole(shape: str, width: float, height: float, hole_x=42.0, hole_y=17.0):
    fh = ScaledFingerHole(
        id="fh1",
        x_mm=hole_x,
        y_mm=hole_y,
        radius_mm=max(width, height) / 2,
        shape=shape,
        width_mm=width,
        height_mm=height,
        rotation=0.0,
    )
    return ScaledPolygon(
        id="p1",
        points_mm=[(17, 17), (67, 17), (67, 67), (17, 67)],
        label="test",
        finger_holes=[fh],
    )


def _poly_without_hole():
    return ScaledPolygon(
        id="p1",
        points_mm=[(17, 17), (67, 17), (67, 67), (17, 67)],
        label="test",
        finger_holes=[],
    )


def _config():
    return GenerateRequest(
        grid_x=2, grid_y=2, height_units=4,
        magnets=False, stacking_lip=False, bed_size=0,
        cutout_depth=10.0,
    )


@pytest.mark.parametrize("shape", ["rectangle", "filleted_rectangle"])
def test_1mm_floor_cutout_is_valid(shape, tmp_path):
    mesh, _ = render([_poly_with_rect_hole(shape, width=1, height=1)], _config(), tmp_path / "small.stl")
    assert mesh.is_watertight and mesh.volume > 0


@pytest.mark.parametrize("shape", ["rectangle", "filleted_rectangle"])
def test_25x5_cutout_generates_valid_bin(shape, tmp_path: Path):
    """Reporter's exact case: 25x5mm cutout straddling the polygon edge."""
    config = _config()

    with_hole, _ = render(
        [_poly_with_rect_hole(shape, width=25.0, height=5.0)],
        config, str(tmp_path / "with.stl"),
    )
    without_hole, _ = render(
        [_poly_without_hole()], config, str(tmp_path / "without.stl"),
    )

    assert with_hole.volume > 0
    assert (tmp_path / "with.stl").exists()
    # hole straddles the polygon edge, so it must remove extra material
    assert with_hole.volume < without_hole.volume
