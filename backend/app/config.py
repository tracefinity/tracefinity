from __future__ import annotations

from pydantic_settings import BaseSettings
from pathlib import Path
from typing import Optional


class Settings(BaseSettings):
    storage_path: Path = Path("./storage")
    google_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openrouter_image_model: str = "google/gemini-3.1-flash-image-preview"
    openrouter_label_model: str = "google/gemini-2.0-flash-001"
    gemini_image_model: str = "gemini-3.1-flash-image-preview"
    gemini_label_model: str = "gemini-2.0-flash"
    max_upload_mb: int = 20
    log_level: str = "INFO"
    proxy_secret: Optional[str] = None
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:4001"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def use_local_model(self) -> bool:
        """use InSPyReNet locally when no cloud API keys are configured."""
        return not self.google_api_key and not self.openrouter_api_key


settings = Settings()


def ensure_user_dirs(user_path: Path):
    """create storage subdirs for a user"""
    user_path.mkdir(parents=True, exist_ok=True)
    for sub in ("uploads", "processed", "outputs", "tools", "bins"):
        (user_path / sub).mkdir(exist_ok=True)


# ensure default user dirs exist
settings.storage_path.mkdir(parents=True, exist_ok=True)
ensure_user_dirs(settings.storage_path / "default")
