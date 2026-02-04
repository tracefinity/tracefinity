from __future__ import annotations

from pydantic_settings import BaseSettings
from pathlib import Path
from typing import Optional


class Settings(BaseSettings):
    storage_path: Path = Path("./storage")
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    google_api_key: Optional[str] = None
    gridfinity_lib_path: Optional[str] = None
    max_upload_mb: int = 20

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()

settings.storage_path.mkdir(parents=True, exist_ok=True)
(settings.storage_path / "uploads").mkdir(exist_ok=True)
(settings.storage_path / "processed").mkdir(exist_ok=True)
(settings.storage_path / "outputs").mkdir(exist_ok=True)
