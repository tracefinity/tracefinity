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


def _tool_record(tool_id: str, name: str, **extra):
    return {
        "id": tool_id,
        "name": name,
        "points": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}],
        **extra,
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
    (user_path / "tools.json").write_text(json.dumps({"tool-1": _tool_record("tool-1", "pliers")}))
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
    (source_path / "tools.json").write_text(json.dumps({"tool-new": _tool_record("tool-new", "new")}))
    (source_path / "outputs" / "new.stl").write_bytes(b"new stl")
    package_path = tmp_path / "source.zip"
    create_backup_package(source_path, package_path)

    target_path = tmp_path / "default"
    (target_path / "outputs").mkdir(parents=True)
    (target_path / "backups").mkdir()
    (target_path / "tools.json").write_text(json.dumps({"tool-old": _tool_record("tool-old", "old")}))
    (target_path / "outputs" / "old.stl").write_bytes(b"old stl")
    (target_path / "backups" / "keep.zip").write_bytes(b"kept")

    with package_path.open("rb") as f:
        result = restore_backup_package(target_path, f)

    assert json.loads((target_path / "tools.json").read_text()) == {"tool-new": _tool_record("tool-new", "new")}
    assert (target_path / "outputs" / "new.stl").read_bytes() == b"new stl"
    assert not (target_path / "outputs" / "old.stl").exists()
    assert (target_path / "backups" / "keep.zip").exists()
    assert result.auto_backup_path.exists()

    with zipfile.ZipFile(result.auto_backup_path) as zf:
        old_tools = json.loads(zf.read("storage/tools.json"))
        names = set(zf.namelist())

    assert old_tools == {"tool-old": _tool_record("tool-old", "old")}
    assert "storage/outputs/old.stl" in names


def test_restore_rewrites_storage_paths_for_target_user(tmp_path):
    source_path = tmp_path / "source"
    (source_path / "processed").mkdir(parents=True)
    (source_path / "outputs").mkdir()
    (source_path / "tools").mkdir()
    (source_path / "sessions.json").write_text(json.dumps({
        "session-1": {
            "id": "session-1",
            "corrected_image_path": "source/processed/session-1.png",
            "stl_path": "source/outputs/session-1.stl",
        }
    }))
    (source_path / "tools.json").write_text(json.dumps({
        "tool-1": _tool_record(
            "tool-1",
            "pliers",
            source_image_path="source/processed/session-1.png",
            thumbnail_path="source/tools/tool-1.svg",
        )
    }))
    (source_path / "bins.json").write_text(json.dumps({
        "bin-1": {"id": "bin-1", "stl_path": "source/outputs/bin-1.stl"}
    }))
    package_path = tmp_path / "source.zip"
    create_backup_package(source_path, package_path)

    target_path = tmp_path / "default"
    target_path.mkdir()
    with package_path.open("rb") as f:
        restore_backup_package(target_path, f)

    session = json.loads((target_path / "sessions.json").read_text())["session-1"]
    tool = json.loads((target_path / "tools.json").read_text())["tool-1"]
    bin_data = json.loads((target_path / "bins.json").read_text())["bin-1"]
    assert session["corrected_image_path"] == "default/processed/session-1.png"
    assert session["stl_path"] == "default/outputs/session-1.stl"
    assert tool["source_image_path"] == "default/processed/session-1.png"
    assert tool["thumbnail_path"] == "default/tools/tool-1.svg"
    assert bin_data["stl_path"] == "default/outputs/bin-1.stl"


def test_restore_rejects_invalid_store_before_changing_data(tmp_path):
    target_path = tmp_path / "default"
    target_path.mkdir()
    (target_path / "tools.json").write_text(json.dumps({"tool-old": _tool_record("tool-old", "old")}))

    package_path = tmp_path / "invalid-store.zip"
    with zipfile.ZipFile(package_path, "w") as zf:
        zf.writestr(BACKUP_MANIFEST, json.dumps(_manifest()))
        zf.writestr("storage/tools.json", json.dumps({"tool-bad": {"id": "tool-bad"}}))

    with package_path.open("rb") as f:
        with pytest.raises(BackupError):
            restore_backup_package(target_path, f)

    assert json.loads((target_path / "tools.json").read_text()) == {"tool-old": _tool_record("tool-old", "old")}
    assert not (target_path / "backups").exists()


def test_restore_rejects_unsafe_json_path_before_changing_data(tmp_path):
    target_path = tmp_path / "default"
    target_path.mkdir()
    (target_path / "tools.json").write_text(json.dumps({"tool-old": _tool_record("tool-old", "old")}))

    package_path = tmp_path / "unsafe-json-path.zip"
    with zipfile.ZipFile(package_path, "w") as zf:
        zf.writestr(BACKUP_MANIFEST, json.dumps(_manifest()))
        zf.writestr(
            "storage/tools.json",
            json.dumps({
                "tool-bad": _tool_record("tool-bad", "bad", source_image_path="../processed/evil.png")
            }),
        )

    with package_path.open("rb") as f:
        with pytest.raises(BackupError):
            restore_backup_package(target_path, f)

    assert json.loads((target_path / "tools.json").read_text()) == {"tool-old": _tool_record("tool-old", "old")}
    assert not (target_path / "backups").exists()


def test_restore_rejects_unsafe_paths_before_changing_data(tmp_path):
    target_path = tmp_path / "default"
    target_path.mkdir()
    (target_path / "tools.json").write_text(json.dumps({"tool-old": _tool_record("tool-old", "old")}))

    package_path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(package_path, "w") as zf:
        zf.writestr(BACKUP_MANIFEST, json.dumps(_manifest()))
        zf.writestr("storage/../evil.txt", "bad")

    with package_path.open("rb") as f:
        with pytest.raises(BackupError):
            restore_backup_package(target_path, f)

    assert json.loads((target_path / "tools.json").read_text()) == {"tool-old": _tool_record("tool-old", "old")}
    assert not (target_path / "backups").exists()


def test_user_restore_endpoint_replaces_data_and_reports_auto_backup(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    target_path = tmp_path / "default"
    (target_path / "tools.json").write_text(json.dumps({"tool-old": _tool_record("tool-old", "old")}))
    (target_path / "outputs" / "old.stl").write_bytes(b"old stl")

    export_response = client.get("/api/users/me/export")
    assert export_response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(export_response.content)) as zf:
        assert "storage/tools.json" in zf.namelist()

    source_path = tmp_path / "source"
    (source_path / "outputs").mkdir(parents=True)
    (source_path / "tools.json").write_text(json.dumps({"tool-new": _tool_record("tool-new", "new")}))
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
    assert json.loads((target_path / "tools.json").read_text()) == {"tool-new": _tool_record("tool-new", "new")}
    assert not (target_path / "outputs" / "old.stl").exists()
    assert (target_path / "backups" / body["auto_backup_filename"]).exists()
