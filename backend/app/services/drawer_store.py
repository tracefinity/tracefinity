from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import DrawerModel


class DrawerStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "drawers.json"
        self._drawers: dict[str, DrawerModel] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for did, ddata in data.items():
                    self._drawers[did] = DrawerModel.model_validate(ddata)
            except Exception:
                self._drawers = {}

    def _save(self):
        data = {did: d.model_dump() for did, d in self._drawers.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent,
            prefix=".drawers_",
            suffix=".tmp"
        )
        try:
            with open(temp_fd, 'w') as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def get(self, drawer_id: str) -> Optional[DrawerModel]:
        with self._lock:
            return self._drawers.get(drawer_id)

    def set(self, drawer_id: str, drawer: DrawerModel):
        with self._lock:
            self._drawers[drawer_id] = drawer
            self._save()

    def delete(self, drawer_id: str) -> Optional[DrawerModel]:
        with self._lock:
            drawer = self._drawers.pop(drawer_id, None)
            if drawer:
                self._save()
            return drawer

    def all(self) -> dict[str, DrawerModel]:
        with self._lock:
            return self._drawers.copy()
