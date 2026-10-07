import io

import pytest
import trimesh
from fastapi.testclient import TestClient
from shapely.geometry import Polygon, box

from app.api import routes
from app.config import ensure_user_dirs
from app.main import app
from app.models.schemas import Point, Tool


@pytest.mark.parametrize("stacking_lip,half_grid,wall,expected_grid", [
    (True, False, 1.6, 3),
    (False, False, 1.6, 2),
    (True, True, 1.6, 2.5),
    (True, False, 3.0, 3),
])
@pytest.mark.parametrize("vertical", [False, True])
def test_new_bin_preserves_pocket_at_grid_boundary(
    tmp_path, monkeypatch, stacking_lip, half_grid, wall, expected_grid, vertical,
):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    ensure_user_dirs(tmp_path / "default")
    _, tools, _ = routes.get_stores("default")
    half_x, half_y = (15, 40) if vertical else (40, 15)
    physical_tool = box(-half_x, -half_y, half_x, half_y)
    tools.set("rectangle", Tool(
        id="rectangle", name="80 by 30 mm", smoothed=False,
        points=[Point(x=x, y=y) for x, y in list(physical_tool.exterior.coords)[:-1]],
    ))

    with TestClient(app) as client:
        response = client.post("/api/bins", json={
            "tool_ids": ["rectangle"],
            "bin_config": {
                "stacking_lip": stacking_lip, "half_grid_base": half_grid,
                "wall_thickness": wall, "cutout_clearance": .1,
                "cutout_chamfer": 0, "magnets": False,
            },
        })
        assert response.status_code == 200
        created = response.json()
        bin_id = created["id"]
        assert client.post(f"/api/bins/{bin_id}/generate").status_code == 200
        response = client.get(f"/api/files/bins/{bin_id}/bin.stl")
        assert response.status_code == 200

    mesh = trimesh.load(io.BytesIO(response.content), file_type="stl", force="mesh")
    assert mesh.is_watertight
    section = mesh.section(plane_origin=[0, 0, 25], plane_normal=[0, 0, 1])
    assert section is not None
    outlines = [Polygon(loop[:, :2]) for loop in section.discrete]
    assert len(outlines) == 2
    pocket = min(outlines, key=lambda p: p.area)
    # Measure the exported cavity, not just the auto-size calculation.
    assert pocket.hausdorff_distance(physical_tool.buffer(.1)) < .05
    assert pocket.covers(physical_tool)
    axis = "grid_y" if vertical else "grid_x"
    assert created["bin_config"][axis] == expected_grid
