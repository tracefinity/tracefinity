from pathlib import Path

import numpy as np

from app.models.schemas import GenerateRequest
from tests.geometry_support import render


def _boundary_edge_count(mesh) -> int:
    _, counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    return int((counts == 1).sum())


def test_a_stacking_lip_bin_at_six_grid_units_has_no_boundary_holes(tmp_path: Path):
    """Below grid_y=6 (252mm) this config exports clean; at and above it, the
    unpatched merge tolerance used to leave a 3-edge hole in the lip notch
    seam. No tool polygons needed -- the defect is in the shell/lip geometry
    itself."""
    config = GenerateRequest(
        grid_x=2, grid_y=6, height_units=4, magnets=False, stacking_lip=True,
    )
    body, _ = render([], config, str(tmp_path / "bin.stl"))
    tm = body

    assert _boundary_edge_count(tm) == 0
    assert tm.is_watertight
