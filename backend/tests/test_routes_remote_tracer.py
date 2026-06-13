"""Route-level tests for remote tracers."""

from fastapi.testclient import TestClient

import app.api.routes as routes
from app.config import ensure_user_dirs
from app.main import app
from app.models.schemas import Session


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    routes._store_cache.clear()
    routes._tracers.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def test_api_keys_reports_remote_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "tracers", "fal")
    monkeypatch.setattr(routes.settings, "fal_key", "fal_x")
    client = _client(tmp_path, monkeypatch)

    body = client.get("/api/api-keys").json()
    assert body["google"] is True
    assert body["provider"] == "remote"
    assert {"id": "fal", "label": "fal.ai"} in body["tracers"]


def test_trace_remote_missing_token_returns_400(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "tracers", "fal")
    monkeypatch.setattr(routes.settings, "fal_key", None)
    client = _client(tmp_path, monkeypatch)

    sessions, _, _ = routes.get_stores("default")
    sessions.set("s1", Session(id="s1", corrected_image_path="default/processed/x.png"))

    resp = client.post("/api/sessions/s1/trace", json={"tracer": "fal"})
    assert resp.status_code == 400
    assert "token" in resp.json()["detail"].lower()
