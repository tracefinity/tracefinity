from __future__ import annotations

import json
import shutil
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from pydantic import ValidationError

from app.models.schemas import BinModel, BinProject, Session, Tool


BACKUP_MANIFEST = "tracefinity-backup.json"
BACKUP_FORMAT_VERSION = 1
BACKUP_STORAGE_PREFIX = "storage"
BACKUP_DIR_NAME = "backups"
EXCLUDED_TOP_LEVEL = {BACKUP_DIR_NAME}
RESTORED_TOP_LEVEL = {"uploads", "processed", "outputs", "tools", "bins"}
STORAGE_PATH_FIELDS = {
    "original_image_path",
    "corrected_image_path",
    "mask_image_path",
    "stl_path",
    "source_image_path",
    "thumbnail_path",
}
STORE_MODELS = {
    "sessions.json": Session,
    "tools.json": Tool,
    "bins.json": BinModel,
    "bin-projects.json": BinProject,
}


class BackupError(ValueError):
    """Raised when a backup package cannot be imported safely."""


@dataclass
class RestoreResult:
    auto_backup_path: Path
    restored_files: int


def backup_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def backup_filename(prefix: str = "tracefinity-backup") -> str:
    return f"{prefix}-{backup_timestamp()}.zip"


def _manifest() -> dict[str, object]:
    return {
        "app": "tracefinity",
        "format_version": BACKUP_FORMAT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "storage_prefix": BACKUP_STORAGE_PREFIX,
    }


def _should_export(rel_path: Path) -> bool:
    if not rel_path.parts:
        return False
    if rel_path.parts[0] in EXCLUDED_TOP_LEVEL:
        return False
    if rel_path.name.endswith(".tmp") and rel_path.name.startswith("."):
        return False
    return True


def create_backup_package(user_path: Path, output_path: Path) -> Path:
    """Write a Tracefinity backup ZIP for one user's storage directory."""
    user_path.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(BACKUP_MANIFEST, json.dumps(_manifest(), indent=2))

        for path in sorted(user_path.rglob("*")):
            if not path.is_file():
                continue
            rel_path = path.relative_to(user_path)
            if not _should_export(rel_path):
                continue
            archive_name = f"{BACKUP_STORAGE_PREFIX}/{rel_path.as_posix()}"
            zf.write(path, archive_name)

    return output_path


def _validate_manifest(zf: zipfile.ZipFile) -> None:
    try:
        raw = zf.read(BACKUP_MANIFEST)
    except KeyError as exc:
        raise BackupError("backup is missing tracefinity metadata") from exc

    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupError("backup metadata is not valid JSON") from exc

    if manifest.get("app") != "tracefinity":
        raise BackupError("backup was not created by Tracefinity")
    if manifest.get("format_version") != BACKUP_FORMAT_VERSION:
        raise BackupError("backup format is not supported by this version of Tracefinity")
    if manifest.get("storage_prefix") != BACKUP_STORAGE_PREFIX:
        raise BackupError("backup storage layout is not supported")


def _storage_rel_from_archive_name(name: str) -> Path | None:
    normalized = name.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if not parts or parts[0] == BACKUP_MANIFEST:
        return None
    if parts[0] != BACKUP_STORAGE_PREFIX:
        raise BackupError("backup contains files outside Tracefinity storage")
    rel_parts = parts[1:]
    if not rel_parts:
        return None
    if rel_parts[0] in EXCLUDED_TOP_LEVEL:
        return None
    for part in rel_parts:
        if part in {".", ".."} or ":" in part:
            raise BackupError("backup contains an unsafe file path")
    return Path(*rel_parts)


def extract_backup_package(backup_file: BinaryIO, staging_path: Path) -> int:
    """Validate and extract a backup package into staging_path."""
    staging_path.mkdir(parents=True, exist_ok=True)
    staging_root = staging_path.resolve()
    restored_files = 0

    try:
        with zipfile.ZipFile(backup_file) as zf:
            _validate_manifest(zf)
            for info in zf.infolist():
                if info.is_dir():
                    continue
                rel_path = _storage_rel_from_archive_name(info.filename)
                if rel_path is None:
                    continue

                dest = staging_path / rel_path
                dest_parent = dest.parent
                dest_parent.mkdir(parents=True, exist_ok=True)
                resolved_dest = dest.resolve()
                if staging_root != resolved_dest and staging_root not in resolved_dest.parents:
                    raise BackupError("backup contains an unsafe file path")

                with zf.open(info) as src, dest.open("wb") as out:
                    shutil.copyfileobj(src, out)
                restored_files += 1
    except zipfile.BadZipFile as exc:
        raise BackupError("backup file is not a valid ZIP") from exc

    return restored_files


def _rewrite_storage_path(value: str, user_id: str) -> str:
    normalized = value.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        return value
    if any(part in {".", ".."} or ":" in part for part in parts):
        return value
    if parts[0] in RESTORED_TOP_LEVEL:
        return f"{user_id}/{'/'.join(parts)}"
    if len(parts) > 1 and parts[1] in RESTORED_TOP_LEVEL:
        return f"{user_id}/{'/'.join(parts[1:])}"
    return value


def _rewrite_storage_paths(value: object, user_id: str, key: str | None = None) -> object:
    if isinstance(value, dict):
        return {k: _rewrite_storage_paths(v, user_id, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_rewrite_storage_paths(item, user_id, key) for item in value]
    if key in STORAGE_PATH_FIELDS and isinstance(value, str):
        return _rewrite_storage_path(value, user_id)
    return value


def _rewrite_staged_user_paths(staging_path: Path, user_id: str) -> None:
    for file_name in STORE_MODELS:
        path = staging_path / file_name
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            raise BackupError(f"{file_name} is not valid JSON") from exc
        path.write_text(json.dumps(_rewrite_storage_paths(data, user_id), indent=2))


def _validate_storage_path_ref(value: str, user_id: str, file_name: str) -> None:
    parts = [part for part in value.replace("\\", "/").split("/") if part]
    if (
        len(parts) < 2
        or parts[0] != user_id
        or parts[1] not in RESTORED_TOP_LEVEL
        or any(part in {".", ".."} or ":" in part for part in parts)
    ):
        raise BackupError(f"{file_name} contains an unsafe storage path")


def _validate_storage_path_refs(value: object, user_id: str, file_name: str, key: str | None = None) -> None:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            _validate_storage_path_refs(child_value, user_id, file_name, child_key)
    elif isinstance(value, list):
        for item in value:
            _validate_storage_path_refs(item, user_id, file_name, key)
    elif key in STORAGE_PATH_FIELDS and isinstance(value, str):
        _validate_storage_path_ref(value, user_id, file_name)


def _validate_store_file(
    path: Path,
    model: type[Session] | type[Tool] | type[BinModel] | type[BinProject],
    user_id: str,
) -> None:
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise BackupError(f"{path.name} is not valid JSON") from exc
    if not isinstance(data, dict):
        raise BackupError(f"{path.name} must contain a JSON object")
    _validate_storage_path_refs(data, user_id, path.name)
    try:
        for record_id, record in data.items():
            if not isinstance(record_id, str):
                raise BackupError(f"{path.name} contains a non-string record id")
            model.model_validate(record)
    except ValidationError as exc:
        raise BackupError(f"{path.name} contains invalid records") from exc


def validate_staged_user_data(staging_path: Path, user_id: str) -> None:
    for file_name, model in STORE_MODELS.items():
        path = staging_path / file_name
        if path.exists():
            _validate_store_file(path, model, user_id)


def _clear_user_data(user_path: Path) -> None:
    user_path.mkdir(parents=True, exist_ok=True)
    for child in user_path.iterdir():
        if child.name == BACKUP_DIR_NAME:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def _copy_staged_data(staging_path: Path, user_path: Path) -> None:
    for child in staging_path.iterdir():
        dest = user_path / child.name
        if child.is_dir():
            shutil.copytree(child, dest, dirs_exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child, dest)


def restore_backup_package(user_path: Path, backup_file: BinaryIO) -> RestoreResult:
    """Restore a backup package, saving an automatic pre-restore backup first."""
    user_path.mkdir(parents=True, exist_ok=True)
    staging_path = user_path.parent / f".restore-{backup_timestamp()}-{uuid.uuid4().hex}"
    backup_dir = user_path / BACKUP_DIR_NAME
    auto_backup_path = backup_dir / backup_filename("tracefinity-auto-backup")

    try:
        restored_files = extract_backup_package(backup_file, staging_path)
        _rewrite_staged_user_paths(staging_path, user_path.name)
        validate_staged_user_data(staging_path, user_path.name)
        create_backup_package(user_path, auto_backup_path)
        _clear_user_data(user_path)
        _copy_staged_data(staging_path, user_path)
        return RestoreResult(auto_backup_path=auto_backup_path, restored_files=restored_files)
    finally:
        shutil.rmtree(staging_path, ignore_errors=True)
