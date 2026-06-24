"""SVG download endpoint must return Cache-Control: no-cache."""

from fastapi.testclient import TestClient

import app.api.routes as routes
from app.config import ensure_user_dirs, settings
from app.main import app
from app.models.schemas import Tool


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    routes._store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def _triangle_tool(tool_id: str) -> Tool:
    return Tool(
        id=tool_id,
        name="test wrench",
        points=[
            {"x": 0, "y": 0},
            {"x": 20, "y": 0},
            {"x": 10, "y": 15},
        ],
    )


def test_svg_download_has_no_cache_header(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    _, tools, _ = routes.get_stores("default")
    tools.set("t1", _triangle_tool("t1"))

    resp = client.get("/api/files/tools/t1/tool.svg")

    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["content-type"].startswith("image/svg+xml")


def test_svg_download_returns_valid_svg(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    _, tools, _ = routes.get_stores("default")
    tools.set("t1", _triangle_tool("t1"))

    resp = client.get("/api/files/tools/t1/tool.svg")

    assert b"<svg" in resp.content
    assert b"</svg>" in resp.content


def test_svg_download_404_for_missing_tool(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    resp = client.get("/api/files/tools/nonexistent/tool.svg")

    assert resp.status_code == 404
