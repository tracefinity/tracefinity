"""Tests for max cutout depth calculation in stl_generator_manifold."""
import pytest

from app.services.stl_generator_manifold import (
    GF_BASE_HEIGHT,
    GF_HEIGHT_UNIT,
    LIP_D3,
    LIP_D4,
)


def _max_depth(height_units: int, stacking_lip: bool) -> float:
    """replicate the max_depth formula from generate_bin"""
    wall_top_z = height_units * GF_HEIGHT_UNIT
    floor_z = GF_BASE_HEIGHT
    lip_deduction = (LIP_D3 + LIP_D4) if stacking_lip else 0
    return max(5, wall_top_z - floor_z - 2 - lip_deduction)


class TestMaxCutoutDepth:
    def test_2u_with_lip_floors_to_minimum(self):
        assert _max_depth(2, True) == 5.0

    def test_2u_without_lip(self):
        assert _max_depth(2, False) == 7.25

    def test_4u_with_lip(self):
        assert _max_depth(4, True) == 17.45

    def test_4u_without_lip(self):
        assert _max_depth(4, False) == 21.25

    def test_toggling_lip_clamps_depth(self):
        # a depth of 7mm is valid at 2u without lip
        depth = 7.0
        max_with_lip = _max_depth(2, True)
        # toggling lip on should force clamp: min(7.0, 5.0) = 5.0
        assert min(depth, max_with_lip) == 5.0
