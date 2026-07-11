"""Small rectangle cutouts (issue #114): 25x5mm and 1mm-floor sizes must
produce valid geometry."""
from pathlib import Path

import pytest

from app.models.schemas import BinParams, GenerateRequest
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from app.services.stl_generator_manifold import (
    ManifoldSTLGenerator,
    _make_finger_holes,
)


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
class TestSmallRectangleCutter:
    def test_25x5_cutter_has_correct_extents(self, shape):
        poly = _poly_with_rect_hole(shape, width=25.0, height=5.0)
        config = BinParams(cutout_depth=10.0)
        cutter = _make_finger_holes(
            [poly], config, wall_top_z=25.0, max_depth=15.0,
            offset_x=0.0, offset_y=0.0,
        )
        assert cutter is not None
        assert cutter.volume() > 0
        bb = cutter.bounding_box()
        assert abs((bb[3] - bb[0]) - 25.0) < 0.1
        assert abs((bb[4] - bb[1]) - 5.0) < 0.1

    def test_1mm_floor_cutter_is_valid(self, shape):
        poly = _poly_with_rect_hole(shape, width=1.0, height=1.0)
        config = BinParams(cutout_depth=10.0)
        cutter = _make_finger_holes(
            [poly], config, wall_top_z=25.0, max_depth=15.0,
            offset_x=0.0, offset_y=0.0,
        )
        assert cutter is not None
        assert cutter.volume() > 0


@pytest.mark.parametrize("shape", ["rectangle", "filleted_rectangle"])
def test_25x5_cutout_generates_valid_bin(shape, tmp_path: Path):
    """Reporter's exact case: 25x5mm cutout straddling the polygon edge."""
    gen = ManifoldSTLGenerator()
    config = _config()

    with_hole, _ = gen.generate_bin(
        [_poly_with_rect_hole(shape, width=25.0, height=5.0)],
        config, str(tmp_path / "with.stl"),
    )
    without_hole, _ = gen.generate_bin(
        [_poly_without_hole()], config, str(tmp_path / "without.stl"),
    )

    assert with_hole.volume() > 0
    assert (tmp_path / "with.stl").exists()
    # hole straddles the polygon edge, so it must remove extra material
    assert with_hole.volume() < without_hole.volume()
