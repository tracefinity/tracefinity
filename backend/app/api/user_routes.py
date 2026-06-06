import logging
import re
import tempfile
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import Response

from app.auth import get_user_id
from app.config import ensure_user_dirs, settings
from app.models.schemas import RestoreResponse
from app.services.backup_service import (
    BACKUP_DIR_NAME,
    BackupError,
    BackupSizeError,
    backup_filename,
    create_backup_package,
    restore_backup_package,
    validate_backup_file_size,
)

logger = logging.getLogger(__name__)

router = APIRouter()
BACKUP_FILE_NAME_RE = re.compile(r"^tracefinity-auto-backup-\d{8}-\d{6}\.zip$")


def _evict_user_store_cache(user_id: str) -> None:
    import app.api.routes as routes

    routes._store_cache.pop(user_id, None)
    routes._project_store_cache.pop(user_id, None)
    photo_station_cache = getattr(routes, "_photo_station_store_cache", None)
    if photo_station_cache is not None:
        photo_station_cache.pop(user_id, None)


@router.get("/users/me/export")
async def export_user_data(user_id: str = Depends(get_user_id)):
    """download a complete backup package for the authenticated user"""
    user_path = settings.storage_path / user_id
    ensure_user_dirs(user_path)

    download_name = backup_filename()
    with tempfile.NamedTemporaryFile(prefix="tracefinity-export-", suffix=".zip", delete=False) as tmp:
        output_path = Path(tmp.name)

    try:
        create_backup_package(user_path, output_path)
    except Exception:
        output_path.unlink(missing_ok=True)
        raise

    return FileResponse(
        str(output_path),
        media_type="application/zip",
        filename=download_name,
        background=BackgroundTask(lambda: output_path.unlink(missing_ok=True)),
    )


@router.post("/users/me/restore", response_model=RestoreResponse)
async def restore_user_data(request: Request, backup: UploadFile, user_id: str = Depends(get_user_id)):
    """restore user data from a backup package, replacing existing app data"""
    user_path = settings.storage_path / user_id
    ensure_user_dirs(user_path)
    max_bytes = settings.max_backup_mb * 1024 * 1024
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            request_size = int(content_length)
        except ValueError:
            request_size = 0
        if request_size > max_bytes:
            await backup.close()
            raise HTTPException(status_code=413, detail=f"backup file too large (max {settings.max_backup_mb}MB)")

    try:
        validate_backup_file_size(backup.file, max_bytes)
        result = restore_backup_package(user_path, backup.file)
    except BackupSizeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await backup.close()

    ensure_user_dirs(user_path)
    _evict_user_store_cache(user_id)

    return RestoreResponse(
        status="restored",
        auto_backup_filename=result.auto_backup_path.name,
        auto_backup_url=f"/api/users/me/backups/{result.auto_backup_path.name}",
        restored_files=result.restored_files,
    )


@router.get("/users/me/backups/{file_name}")
async def download_saved_backup(file_name: str, user_id: str = Depends(get_user_id)):
    """download an automatic backup saved during restore"""
    if not BACKUP_FILE_NAME_RE.fullmatch(file_name):
        raise HTTPException(status_code=400, detail="invalid backup filename")

    backup_path = settings.storage_path / user_id / BACKUP_DIR_NAME / file_name
    if not backup_path.exists() or not backup_path.is_file():
        raise HTTPException(status_code=404, detail="backup not found")

    return FileResponse(
        str(backup_path),
        media_type="application/zip",
        filename=file_name,
    )


@router.delete("/users/me")
async def delete_user_data(user_id: str = Depends(get_user_id)):
    """delete all stored data for the authenticated user"""
    user_path = settings.storage_path / user_id
    if user_path.exists():
        shutil.rmtree(user_path)
        logger.info("deleted storage for user %s", user_id)

    _evict_user_store_cache(user_id)

    return Response(status_code=204)
