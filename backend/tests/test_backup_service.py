import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import ensure_user_dirs, settings
from app.main import app
import app.api.routes as routes
import app.api.user_routes as user_routes
from app.services.backup_service import (
    BACKUP_FORMAT_VERSION,
    BACKUP_MANIFEST,
    BACKUP_STORAGE_PREFIX,
    BackupError,
    create_backup_package,
    restore_backup_package,
)


def _manifest():
    return {
        "app": "tracefinity",
        "format_version": BACKUP_FORMAT_VERSION,
        "storage_prefix": BACKUP_STORAGE_PREFIX,
    }


def _api_client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(user_routes.settings, "storage_path", tmp_path)
    routes._store_cache.clear()
    routes._project_store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def test_backup_package_includes_storage_data_and_skips_saved_backups(tmp_path):
    user_path = tmp_path / "default"
    (user_path / "outputs").mkdir(parents=True)
    (user_path / "tools").mkdir()
    (user_path / "backups").mkdir()
    (user_path / "tools.json").write_text(json.dumps({"tool-1": {"name": "pliers"}}))
    (user_path / "outputs" / "bin.stl").write_bytes(b"solid bin")
    (user_path / "backups" / "older.zip").write_bytes(b"previous backup")

    backup_path = tmp_path / "tracefinity-backup.zip"
    create_backup_package(user_path, backup_path)

    with zipfile.ZipFile(backup_path) as zf:
        names = set(zf.namelist())
        manifest = json.loads(zf.read(BACKUP_MANIFEST))

    assert manifest["app"] == "tracefinity"
    assert "storage/tools.json" in names
    assert "storage/outputs/bin.stl" in names
    assert "storage/backups/older.zip" not in names


def test_restore_replaces_data_and_saves_pre_restore_backup(tmp_path):
    source_path = tmp_path / "source"
    (source_path / "outputs").mkdir(parents=True)
    (source_path / "tools.json").write_text(json.dumps({"tool-new": {"name": "new"}}))
    (source_path / "outputs" / "new.stl").write_bytes(b"new stl")
    package_path = tmp_path / "source.zip"
    create_backup_package(source_path, package_path)

    target_path = tmp_path / "default"
    (target_path / "outputs").mkdir(parents=True)
    (target_path / "backups").mkdir()
    (target_path / "tools.json").write_text(json.dumps({"tool-old": {"name": "old"}}))
    (target_path / "outputs" / "old.stl").write_bytes(b"old stl")
    (target_path / "backups" / "keep.zip").write_bytes(b"kept")

    with package_path.open("rb") as f:
        result = restore_backup_package(target_path, f)

    assert json.loads((target_path / "tools.json").read_text()) == {"tool-new": {"name": "new"}}
    assert (target_path / "outputs" / "new.stl").read_bytes() == b"new stl"
    assert not (target_path / "outputs" / "old.stl").exists()
    assert (target_path / "backups" / "keep.zip").exists()
    assert result.auto_backup_path.exists()

    with zipfile.ZipFile(result.auto_backup_path) as zf:
        old_tools = json.loads(zf.read("storage/tools.json"))
        names = set(zf.namelist())

    assert old_tools == {"tool-old": {"name": "old"}}
    assert "storage/outputs/old.stl" in names


def test_restore_rejects_unsafe_paths_before_changing_data(tmp_path):
    target_path = tmp_path / "default"
    target_path.mkdir()
    (target_path / "tools.json").write_text(json.dumps({"tool-old": {"name": "old"}}))

    package_path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(package_path, "w") as zf:
        zf.writestr(BACKUP_MANIFEST, json.dumps(_manifest()))
        zf.writestr("storage/../evil.txt", "bad")

    with package_path.open("rb") as f:
        with pytest.raises(BackupError):
            restore_backup_package(target_path, f)

    assert json.loads((target_path / "tools.json").read_text()) == {"tool-old": {"name": "old"}}
    assert not (target_path / "backups").exists()


def test_user_restore_endpoint_replaces_data_and_reports_auto_backup(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    target_path = tmp_path / "default"
    (target_path / "tools.json").write_text(json.dumps({"tool-old": {"name": "old"}}))
    (target_path / "outputs" / "old.stl").write_bytes(b"old stl")

    export_response = client.get("/api/users/me/export")
    assert export_response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(export_response.content)) as zf:
        assert "storage/tools.json" in zf.namelist()

    source_path = tmp_path / "source"
    (source_path / "outputs").mkdir(parents=True)
    (source_path / "tools.json").write_text(json.dumps({"tool-new": {"name": "new"}}))
    (source_path / "outputs" / "new.stl").write_bytes(b"new stl")
    package_path = tmp_path / "source.zip"
    create_backup_package(source_path, package_path)

    with package_path.open("rb") as f:
        restore_response = client.post(
            "/api/users/me/restore",
            files={"backup": ("tracefinity-backup.zip", f, "application/zip")},
        )

    assert restore_response.status_code == 200
    body = restore_response.json()
    assert body["status"] == "restored"
    assert body["auto_backup_filename"].startswith("tracefinity-auto-backup-")
    assert body["auto_backup_url"].endswith(body["auto_backup_filename"])
    assert json.loads((target_path / "tools.json").read_text()) == {"tool-new": {"name": "new"}}
    assert not (target_path / "outputs" / "old.stl").exists()
    assert (target_path / "backups" / body["auto_backup_filename"]).exists()
