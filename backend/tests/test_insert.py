"""Tests for contrast insert STL generation."""
import os
import tempfile

import pytest

from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import ManifoldSTLGenerator

GF_GRID = 42.0


class FakeConfig:
    def __init__(self, insert_height=1.0, grid_x=2, grid_y=2, insert_clearance=None):
        self.insert_enabled = True
        self.insert_height = insert_height
        self.grid_x = grid_x
        self.grid_y = grid_y
        if insert_clearance is not None:
            self.insert_clearance = insert_clearance


def _make_polygon(x, y, size, poly_id="test"):
    return ScaledPolygon(
        id=poly_id,
        points_mm=[(x, y), (x + size, y), (x + size, y + size), (x, y + size)],
        label="test",
        finger_holes=[],
        interior_rings_mm=[],
    )


def _grid_offsets(grid_x=2, grid_y=2):
    bin_width = grid_x * GF_GRID
    bin_depth = grid_y * GF_GRID
    return -bin_width / 2, -bin_depth / 2


@pytest.fixture
def generator():
    return ManifoldSTLGenerator()


@pytest.fixture
def output_path():
    fd, path = tempfile.mkstemp(suffix=".stl")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.unlink(path)


def test_generate_insert_produces_file(generator, output_path):
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert([poly], config, output_path, ox, oy)

    assert result is True
    assert os.path.exists(output_path)
    assert os.path.getsize(output_path) > 0


def test_generate_insert_empty_polygons(generator, output_path):
    config = FakeConfig()

    result = generator.generate_insert([], config, output_path, 0, 0)

    assert result is False


def test_generate_insert_custom_height(generator, output_path):
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig(insert_height=2.5)
    ox, oy = _grid_offsets()

    result = generator.generate_insert([poly], config, output_path, ox, oy)

    assert result is True
    assert os.path.getsize(output_path) > 0


def test_generate_insert_multiple_polygons(generator, output_path):
    polys = [
        _make_polygon(5, 5, 15, "tool1"),
        _make_polygon(30, 30, 10, "tool2"),
    ]
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert(polys, config, output_path, ox, oy)

    assert result is True
    assert os.path.getsize(output_path) > 0


def test_generate_insert_degenerate_polygon(generator, output_path):
    degen = ScaledPolygon(
        id="degen",
        points_mm=[(0, 0), (1, 0)],
        label="degen",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert([degen], config, output_path, ox, oy)

    assert result is False


def _stl_extents(path):
    import trimesh
    mesh = trimesh.load(path)
    return mesh.bounds[1] - mesh.bounds[0]


def test_generate_insert_default_fit_clearance(generator, output_path):
    """insert must be smaller than the pocket it drops into (default 0.2mm/side)."""
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig()
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    extents = _stl_extents(output_path)
    assert extents[0] == pytest.approx(20.0 - 2 * 0.2, abs=0.02)
    assert extents[1] == pytest.approx(20.0 - 2 * 0.2, abs=0.02)


def test_generate_insert_custom_fit_clearance(generator, output_path):
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig(insert_clearance=0.5)
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    extents = _stl_extents(output_path)
    assert extents[0] == pytest.approx(20.0 - 2 * 0.5, abs=0.02)


def test_generate_insert_keeps_all_pieces_when_clearance_splits_shape(generator, output_path):
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
    config = FakeConfig()  # default 0.2mm clearance kills the 0.3mm neck
    ox, oy = _grid_offsets()

    assert generator.generate_insert([dumbbell], config, output_path, ox, oy) is True

    extents = _stl_extents(output_path)
    # both 20mm lobes present: full 70mm span minus clearance each side
    assert extents[0] == pytest.approx(70.0 - 2 * 0.2, abs=0.02)


def test_generate_insert_with_hole(generator, output_path):
    poly = ScaledPolygon(
        id="holed",
        points_mm=[(0, 0), (40, 0), (40, 40), (0, 40)],
        label="holed",
        finger_holes=[],
        interior_rings_mm=[[(10, 10), (30, 10), (30, 30), (10, 30)]],
    )
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert([poly], config, output_path, ox, oy)

    assert result is True
    assert os.path.getsize(output_path) > 0
