"""Measure exported pocket floors instead of duplicating the depth formula."""

import numpy as np
import pytest
import trimesh
from pydantic import ValidationError

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from tests.geometry_support import render


def _surface_z(mesh, x=0, y=0):
    """Find the upward-facing horizontal surface at a point in bin coordinates."""
    triangles = mesh.triangles[mesh.face_normals[:, 2] > 0.99]
    points = np.column_stack((np.full(len(triangles), x), np.full(len(triangles), y), triangles[:, 0, 2]))
    barycentric = trimesh.triangles.points_to_barycentric(triangles, points)
    heights = triangles[np.all(barycentric >= -1e-6, axis=1), 0, 2]
    assert len(heights), "no pocket floor at measurement point"
    assert np.ptp(heights) < 1e-5
    return heights[0]


def _generate(tmp_path, config, override=None, finger_depth=None):
    holes = [] if finger_depth is None else [
        ScaledFingerHole("finger", 34, 21, 2, shape="cylinder", depth_override=finger_depth)
    ]
    poly = ScaledPolygon(
        "square", [(11, 11), (31, 11), (31, 31), (11, 31)], "Square",
        depth_override=override, finger_holes=holes,
    )
    output = tmp_path / "bin.stl"
    body, _ = render([poly], config, str(output))
    mesh = trimesh.load_mesh(output)
    assert mesh.is_watertight
    assert body.volume > 0
    return mesh


@pytest.mark.parametrize("lip,rim", [(False, 0), (True, 0), (True, 2)])
@pytest.mark.parametrize("height,requested", [(2, 7), (3, 14)])
def test_requested_depth_survives_lip_and_raised_rim(tmp_path, lip, rim, height, requested):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=height, cutout_depth=requested,
                             stacking_lip=lip, rim_units=rim)
    mesh = _generate(tmp_path, config)
    floor = _surface_z(mesh)
    assert height * 7 - floor == pytest.approx(requested)
    assert floor - 4.75 == pytest.approx(2.25)
    assert mesh.bounds[1, 2] == pytest.approx(height * 7 + rim * 7 + (4.4 if lip else 0))


@pytest.mark.parametrize("lip", [False, True])
@pytest.mark.parametrize("height,maximum", [(1, 0.25), (2, 7.25), (3, 14.25), (4, 21.25)])
@pytest.mark.parametrize("override", [None, 200])
def test_global_and_feature_limits_preserve_floor(tmp_path, lip, height, maximum, override):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=height,
                             cutout_depth=200 if override is None else 5, stacking_lip=lip)
    mesh = _generate(tmp_path, config, override=override, finger_depth=200)
    for x in (0, 13):  # tool pocket and independently overridden finger hole
        floor = _surface_z(mesh, x=x)
        assert height * 7 - floor == pytest.approx(maximum)
        assert floor - 4.75 == pytest.approx(2)


@pytest.mark.parametrize("override", [None, 6])
@pytest.mark.parametrize("height,insert,expected", [(2, 1, 7), (2, 2, 7.25), (1, 1, 0.25)])
def test_insert_allowance_respects_physical_limit(tmp_path, override, height, insert, expected):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=height,
                             cutout_depth=6 if override is None else 5,
                             insert_enabled=True, insert_height=insert)
    mesh = _generate(tmp_path, config, override=override)
    floor = _surface_z(mesh)
    assert height * 7 - floor == pytest.approx(expected)
    assert floor >= 6.75 - 1e-5


def test_shallow_depth_round_trips_through_saved_config(tmp_path):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=1, cutout_depth=0.25)
    restored = GenerateRequest.model_validate_json(config.model_dump_json())
    assert restored.cutout_depth == 0.25
    assert _surface_z(_generate(tmp_path, restored)) == pytest.approx(6.75)


@pytest.mark.parametrize("depth", [0, 0.24, 201])
def test_depth_schema_rejects_out_of_range_values(depth):
    with pytest.raises(ValidationError, match="cutout depth must be between"):
        GenerateRequest(cutout_depth=depth)
