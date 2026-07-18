"""version endpoint reports the running app version."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, settings
from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


def test_version_defaults_to_dev(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert Settings().app_version == "dev"


def test_version_endpoint_reflects_settings(client, monkeypatch):
    monkeypatch.setattr(settings, "app_version", "1.2.3")
    resp = client.get("/api/version")
    assert resp.status_code == 200
    assert resp.json() == {"version": "1.2.3"}


def test_app_version_read_from_env(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "0.6.0")
    assert Settings().app_version == "0.6.0"
