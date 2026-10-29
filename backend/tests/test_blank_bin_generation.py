from pathlib import Path

import pytest

from app.models.schemas import GenerateRequest
from app.services.stl_generator_manifold import (
    GF_BASE_HEIGHT,
    GF_GRID,
    GF_HEIGHT_UNIT,
    LIP_D0,
    LIP_D2,
    ManifoldSTLGenerator,
    _make_blank_bin_cutout,
)


def test_generate_blank_bin_writes_full_width_cutout(tmp_path: Path):
    output_path = tmp_path / "blank_bin.stl"
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=3,
        magnets=False,
        stacking_lip=True,
        bed_size=0,
    )

    body, text_body = ManifoldSTLGenerator().generate_bin([], config, str(output_path))

    assert text_body is None
    assert output_path.exists()
    assert output_path.stat().st_size > 0
    assert body.bounding_box()[5] > 0


def test_blank_bin_cutout_observes_cutout_depth():
    shallow = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        cutout_depth=8,
    )
    deep = shallow.model_copy(update={"cutout_depth": 14})
    wall_top_z = shallow.height_units * GF_HEIGHT_UNIT
    max_depth = wall_top_z - GF_BASE_HEIGHT - 2

    _, shallow_depth = _make_blank_bin_cutout(shallow, wall_top_z, max_depth)
    _, deep_depth = _make_blank_bin_cutout(deep, wall_top_z, max_depth)

    assert shallow_depth == 8
    assert deep_depth == 14


@pytest.mark.parametrize(("stacking_lip", "wall_thickness", "expected_wall"), [
    (False, 1.6, 1.6),
    (False, 5, 5),
    (True, 1.6, LIP_D0 + LIP_D2),
    (True, 5, 5),
])
def test_blank_bin_cutout_respects_wall_and_lip(stacking_lip, wall_thickness, expected_wall):
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=stacking_lip,
        wall_thickness=wall_thickness,
        cutout_depth=8,
    )
    wall_top_z = config.height_units * GF_HEIGHT_UNIT
    max_depth = wall_top_z - GF_BASE_HEIGHT - 2

    cutter, _ = _make_blank_bin_cutout(config, wall_top_z, max_depth)
    min_x, min_y, _, max_x, max_y, _ = cutter.bounding_box()

    assert max_x - min_x == pytest.approx(config.grid_x * GF_GRID - 0.5 - 2 * expected_wall)
    assert max_y - min_y == pytest.approx(config.grid_y * GF_GRID - 0.5 - 2 * expected_wall)


@pytest.mark.parametrize("stacking_lip", [False, True])
@pytest.mark.parametrize("height_units", [1, 3])
def test_blank_bin_maximum_depth_preserves_floor(tmp_path, stacking_lip, height_units):
    config = GenerateRequest(
        grid_x=2, grid_y=1, height_units=height_units, magnets=False,
        stacking_lip=stacking_lip, cutout_depth=100, bed_size=0,
    )
    body, _ = ManifoldSTLGenerator().generate_bin([], config, str(tmp_path / "floor.stl"))
    floor_z = GF_BASE_HEIGHT + 2
    # An actual cross-section below the floor is solid; above it is a cavity.
    assert len(body.slice(floor_z - 0.05).to_polygons()) == 1
    assert len(body.slice(floor_z + 0.05).to_polygons()) == 2


def test_deeper_blank_bin_cutout_removes_more_material(tmp_path: Path):
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        cutout_depth=8,
        bed_size=0,
    )
    generator = ManifoldSTLGenerator()

    shallow_body, _ = generator.generate_bin([], config, str(tmp_path / "shallow.stl"))
    deep_body, _ = generator.generate_bin([], config.model_copy(update={"cutout_depth": 14}), str(tmp_path / "deep.stl"))

    assert shallow_body.volume() > deep_body.volume()
