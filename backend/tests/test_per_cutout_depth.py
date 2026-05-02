"""Tests for per-cutout depth override in stl_generator_manifold."""
from app.models.schemas import BinParams
from app.services.stl_generator_manifold import _resolve_pocket_depth


class TestResolvePocketDepth:
    def test_no_override_uses_global(self):
        bp = BinParams(cutout_depth=20)
        assert _resolve_pocket_depth(None, bp, max_depth=100) == 20.0

    def test_override_takes_precedence(self):
        bp = BinParams(cutout_depth=20)
        assert _resolve_pocket_depth(8, bp, max_depth=100) == 8.0

    def test_override_clamped_to_min(self):
        bp = BinParams(cutout_depth=20)
        assert _resolve_pocket_depth(2, bp, max_depth=100) == 5.0

    def test_override_clamped_to_max(self):
        bp = BinParams(cutout_depth=20)
        assert _resolve_pocket_depth(150, bp, max_depth=100) == 100.0

    def test_global_clamped_to_max(self):
        bp = BinParams(cutout_depth=200)
        assert _resolve_pocket_depth(None, bp, max_depth=50) == 50.0

    def test_insert_height_added_to_global(self):
        bp = BinParams(cutout_depth=20, insert_enabled=True, insert_height=2.5)
        assert _resolve_pocket_depth(None, bp, max_depth=100) == 22.5

    def test_insert_height_added_to_override(self):
        bp = BinParams(cutout_depth=20, insert_enabled=True, insert_height=2.5)
        assert _resolve_pocket_depth(10, bp, max_depth=100) == 12.5

    def test_insert_disabled_ignores_insert_height(self):
        bp = BinParams(cutout_depth=20, insert_enabled=False, insert_height=5.0)
        assert _resolve_pocket_depth(None, bp, max_depth=100) == 20.0

    def test_zero_override_is_clamped_to_min(self):
        bp = BinParams(cutout_depth=20)
        assert _resolve_pocket_depth(0, bp, max_depth=100) == 5.0
