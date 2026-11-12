"""Measure the exported finger pockets and their chamfers."""

import numpy as np
import pytest

from app.models.schemas import GenerateRequest
from app.services.bin_profiles import _filleted_rect_radius
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from tests.geometry_support import render, rings_at


def _hole(tmp_path, shape, *, depth=15, radius=10, width=40, length=18, angle=0, chamfer=0):
    cfg = GenerateRequest(grid_x=2, grid_y=2, height_units=4, magnets=False, stacking_lip=False,
                          cutout_depth=depth, cutout_chamfer=chamfer)
    tool = ScaledPolygon("finger", [], "Finger", [
        ScaledFingerHole("hole", 42, 42, radius, shape, width, length, angle),
    ])
    body, _ = render([tool], cfg, tmp_path / f"{shape}-{angle}.stl")
    assert body.is_watertight
    return body


@pytest.mark.parametrize(("shape", "floor"), [("cylinder", 13), ("circle", 18), ("filleted_rectangle", 13)])
def test_finger_cutout_floor(tmp_path, shape, floor):
    body = _hole(tmp_path, shape)
    assert len(rings_at(body, floor-0.1)) == 1
    assert len(rings_at(body, floor+0.1)) == 2


@pytest.mark.parametrize(("angle", "extents"), [(0, (40, 18)), (90, (18, 40))])
def test_filleted_rectangle_rotates_and_retains_dimensions(tmp_path, angle, extents):
    body = _hole(tmp_path, "filleted_rectangle", angle=angle)
    profile = min(rings_at(body, 24), key=lambda ring: np.ptp(ring[:, 0]))
    assert np.ptp(profile[:, :2], axis=0) == pytest.approx(extents, abs=.02)


@pytest.mark.parametrize("shape", ["cylinder", "square", "rectangle", "filleted_rectangle"])
def test_finger_chamfer_widens_the_mouth(tmp_path, shape):
    body = _hole(tmp_path, shape, chamfer=1)
    narrow = min(np.ptp(ring[:, 0]) for ring in rings_at(body, 26))
    wide = min(np.ptp(ring[:, 0]) for ring in rings_at(body, 27.9))
    assert wide-narrow > 1.6


def test_filleted_rectangle_radius_clamps_to_width_or_depth():
    assert _filleted_rect_radius(width=10, pocket_depth=30) == pytest.approx(10/3)
    assert _filleted_rect_radius(width=80, pocket_depth=30) == 15
    assert _filleted_rect_radius(width=-10, pocket_depth=30) == 0
    assert _filleted_rect_radius(width=10, pocket_depth=-30) == 0
