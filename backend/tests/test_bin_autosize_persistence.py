import json

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.config import ensure_user_dirs
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    monkeypatch.setattr(routes, "_project_store_cache", {})
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def test_auto_size_is_saved_per_bin_and_survives_unrelated_updates(client):
    first = client.post("/api/bins", json={"name": "manual"}).json()
    second = client.post("/api/bins", json={"name": "automatic"}).json()
    path = f"/api/bins/{first['id']}"

    assert first["auto_size"] is True
    assert client.put(path, json={"auto_size": False}).status_code == 200
    routes._store_cache.clear()
    assert client.get(path).json()["auto_size"] is False

    assert client.put(path, json={"name": "renamed"}).status_code == 200
    routes._store_cache.clear()
    saved = client.get(path).json()
    assert saved["name"] == "renamed"
    assert saved["auto_size"] is False
    assert client.get(f"/api/bins/{second['id']}").json()["auto_size"] is True

    assert client.put(path, json={"auto_size": True}).status_code == 200
    routes._store_cache.clear()
    assert client.get(path).json()["auto_size"] is True


def test_existing_bins_default_to_auto_size(client, tmp_path):
    (tmp_path / "default" / "bins.json").write_text(json.dumps({
        "existing": {"id": "existing", "name": "Existing bin"},
    }))

    response = client.get("/api/bins/existing")

    assert response.status_code == 200
    assert response.json()["auto_size"] is True
