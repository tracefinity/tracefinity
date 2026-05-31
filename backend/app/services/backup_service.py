from __future__ import annotations

import json
import shutil
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO


BACKUP_MANIFEST = "tracefinity-backup.json"
BACKUP_FORMAT_VERSION = 1
BACKUP_STORAGE_PREFIX = "storage"
BACKUP_DIR_NAME = "backups"
EXCLUDED_TOP_LEVEL = {BACKUP_DIR_NAME}


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
        create_backup_package(user_path, auto_backup_path)
        _clear_user_data(user_path)
        _copy_staged_data(staging_path, user_path)
        return RestoreResult(auto_backup_path=auto_backup_path, restored_files=restored_files)
    finally:
        shutil.rmtree(staging_path, ignore_errors=True)
