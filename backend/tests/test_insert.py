"""Tests for contrast insert STL generation."""
import os
from pathlib import Path

import pytest

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon
from tests.geometry_support import render


def _make_polygon(x, y, size, poly_id="test"):
    return ScaledPolygon(
        id=poly_id,
        points_mm=[(x, y), (x + size, y), (x + size, y + size), (x, y + size)],
        label="test",
        finger_holes=[],
        interior_rings_mm=[],
    )


@pytest.fixture
def output_path(tmp_path):
    return tmp_path / "bin_insert.stl"


def generate_insert(polygons, config, output_path):
    render(polygons, config, output_path.with_name("bin.stl"))
    return Path(output_path).is_file()


def test_generate_insert_produces_file(output_path):
    poly = _make_polygon(10, 10, 20)
    config = GenerateRequest(insert_enabled=True, )

    result = generate_insert([poly], config, output_path)

    assert result is True
    assert os.path.exists(output_path)
    assert os.path.getsize(output_path) > 0


def test_generate_insert_empty_polygons(output_path):
    config = GenerateRequest(insert_enabled=True, )

    result = generate_insert([], config, output_path)

    assert result is False


def test_generate_insert_custom_height(output_path):
    poly = _make_polygon(10, 10, 20)
    config = GenerateRequest(insert_enabled=True, insert_height=2.5)

    result = generate_insert([poly], config, output_path)

    assert result is True
    assert os.path.getsize(output_path) > 0


def test_generate_insert_multiple_polygons(output_path):
    polys = [
        _make_polygon(5, 5, 15, "tool1"),
        _make_polygon(30, 30, 10, "tool2"),
    ]
    config = GenerateRequest(insert_enabled=True, )

    result = generate_insert(polys, config, output_path)

    assert result is True
    assert os.path.getsize(output_path) > 0


def test_generate_insert_degenerate_polygon(output_path):
    degen = ScaledPolygon(
        id="degen",
        points_mm=[(0, 0), (1, 0)],
        label="degen",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = GenerateRequest(insert_enabled=True, )

    result = generate_insert([degen], config, output_path)

    assert result is False


def _stl_extents(path):
    import trimesh
    mesh = trimesh.load(path)
    return mesh.bounds[1] - mesh.bounds[0]


def test_generate_insert_default_fit_clearance(output_path):
    """insert must be smaller than the pocket it drops into (default 0.2mm/side)."""
    poly = _make_polygon(10, 10, 20)
    config = GenerateRequest(insert_enabled=True, )

    assert generate_insert([poly], config, output_path) is True

    extents = _stl_extents(output_path)
    assert extents[0] == pytest.approx(20.0 - 2 * 0.2, abs=0.02)
    assert extents[1] == pytest.approx(20.0 - 2 * 0.2, abs=0.02)


def test_generate_insert_custom_fit_clearance(output_path):
    poly = _make_polygon(10, 10, 20)
    config = GenerateRequest(insert_enabled=True, insert_clearance=0.5)

    assert generate_insert([poly], config, output_path) is True

    extents = _stl_extents(output_path)
    assert extents[0] == pytest.approx(20.0 - 2 * 0.5, abs=0.02)


def test_generate_insert_keeps_all_pieces_when_clearance_splits_shape(output_path):
    """a narrow neck can vanish under the fit clearance; both lobes must survive."""
    dumbbell = ScaledPolygon(
        id="dumbbell",
        points_mm=[
            (0, 0), (20, 0), (20, 9.85), (50, 9.85), (50, 0), (70, 0),
            (70, 20), (50, 20), (50, 10.15), (20, 10.15), (20, 20), (0, 20),
        ],
        label="dumbbell",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = GenerateRequest(insert_enabled=True, )  # default 0.2mm clearance kills the 0.3mm neck

    assert generate_insert([dumbbell], config, output_path) is True

    extents = _stl_extents(output_path)
    # both 20mm lobes present: full 70mm span minus clearance each side
    assert extents[0] == pytest.approx(70.0 - 2 * 0.2, abs=0.02)


def test_generate_insert_with_hole(output_path):
    poly = ScaledPolygon(
        id="holed",
        points_mm=[(0, 0), (40, 0), (40, 40), (0, 40)],
        label="holed",
        finger_holes=[],
        interior_rings_mm=[[(10, 10), (30, 10), (30, 30), (10, 30)]],
    )
    config = GenerateRequest(insert_enabled=True, )

    result = generate_insert([poly], config, output_path)

    assert result is True
    assert os.path.getsize(output_path) > 0
