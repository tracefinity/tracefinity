"""Tests for _interior_clip_rect lip-aware clipping."""
import pytest

from app.models.schemas import GenerateRequest
from app.services.stl_generator_manifold import (
    GF_GRID,
    LIP_D0,
    LIP_D2,
    _interior_clip_rect,
)


def _make_config(**overrides):
    defaults = dict(grid_x=2, grid_y=2, wall_thickness=1.2, stacking_lip=True)
    defaults.update(overrides)
    return GenerateRequest(**defaults)


class TestInteriorClipRect:
    def test_lip_inset_wider_than_wall(self):
        """clip rect must account for stacking lip, not just wall_thickness."""
        config = _make_config(wall_thickness=1.2, stacking_lip=True)
        outer_w = config.grid_x * GF_GRID - 0.5
        rect = _interior_clip_rect(config)
        bounds = rect.bounds  # (minx, miny, maxx, maxy)

        lip_inset = LIP_D0 + LIP_D2  # 2.6mm
        expected_hw = outer_w / 2 - lip_inset
        assert bounds[2] == pytest.approx(expected_hw, abs=0.01), (
            f"clip rect half-width {bounds[2]} should use lip inset {lip_inset}, "
            f"not wall_thickness {config.wall_thickness}"
        )

    def test_no_lip_uses_wall_thickness(self):
        """without stacking lip, clip rect uses wall_thickness only."""
        config = _make_config(wall_thickness=1.2, stacking_lip=False)
        outer_w = config.grid_x * GF_GRID - 0.5
        rect = _interior_clip_rect(config)
        bounds = rect.bounds

        expected_hw = outer_w / 2 - config.wall_thickness
        assert bounds[2] == pytest.approx(expected_hw, abs=0.01)

    def test_thick_wall_overrides_lip(self):
        """if wall_thickness > lip inset, wall_thickness wins."""
        config = _make_config(wall_thickness=3.0, stacking_lip=True)
        outer_w = config.grid_x * GF_GRID - 0.5
        rect = _interior_clip_rect(config)
        bounds = rect.bounds

        expected_hw = outer_w / 2 - config.wall_thickness
        assert bounds[2] == pytest.approx(expected_hw, abs=0.01)
