"""Tag edits use the existing tool API and survive a fresh store load."""

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.config import ensure_user_dirs
from app.main import app
from app.models.schemas import Point, Tool
from app.services.tool_store import ToolStore


@pytest.mark.parametrize("tags", [["Hex keys", "Metric"], []])
def test_tag_update_survives_reload_without_changing_geometry(tmp_path, monkeypatch, tags):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    user_path = tmp_path / "default"
    ensure_user_dirs(user_path)
    _, tools, _ = routes.get_stores("default")
    tool = Tool(id="hex-key", name="Hex key", tags=["Old"], category="hand tools",
                points=[Point(x=0, y=0), Point(x=10, y=0), Point(x=0, y=10)])
    tools.set(tool.id, tool)
    with TestClient(app) as client:
        assert client.put(f"/api/tools/{tool.id}", json={"tags": tags}).status_code == 200
        assert client.get("/api/tools").json()["tools"][0]["tags"] == tags
    reloaded = ToolStore(user_path).get(tool.id)
    assert reloaded.tags == tags
    assert reloaded.points == tool.points
    assert reloaded.category == "hand tools"
