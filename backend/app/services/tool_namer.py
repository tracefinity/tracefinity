from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from app.config import settings
from app.models.schemas import Point, Polygon

logger = logging.getLogger(__name__)


LABEL_PROMPT = """Identify the physical tool or object in this image.
Return only JSON with this shape:
{"name":"short common tool name"}

Rules:
- Use 1 to 4 words for the name.
- Prefer common workshop/tool names.
- Do not mention color, background, paper, photo, silhouette, or image.
- If unsure, use "tool"."""

_BAD_EXACT_NAMES = {
    "tool",
    "image",
    "object",
    "unknown",
    "not sure",
    "n/a",
    "none",
    "photo",
    "silhouette",
    "background",
    "object on paper",
    "contact sheet",
}

_BAD_NAME_FRAGMENTS = (
    "image",
    "photo",
    "silhouette",
    "background",
    "unknown",
    "object",
    "not sure",
    "can't identify",
    "cannot identify",
    "contact sheet",
)


class ToolNamer(Protocol):
    async def name(self, image_png: bytes) -> str | None:
        """Return a short tool name for one isolated tool crop."""


@dataclass(frozen=True)
class ToolNamerConfig:
    provider: str = "none"
    model: str = "qwen3-vl:4b"
    ollama_url: str = "http://localhost:11434"
    timeout_seconds: float = 30.0
    max_crop_px: int = 512

    @classmethod
    def from_settings(cls) -> "ToolNamerConfig":
        return cls(
            provider=settings.tool_label_provider,
            model=settings.tool_label_model,
            ollama_url=settings.tool_label_ollama_url,
            timeout_seconds=settings.tool_label_timeout_seconds,
            max_crop_px=settings.tool_label_max_crop_px,
        )


class FallbackToolNamer:
    async def name(self, image_png: bytes) -> str | None:
        return None


class OllamaToolNamer:
    def __init__(self, config: ToolNamerConfig):
        self.config = config

    async def name(self, image_png: bytes) -> str | None:
        import httpx

        image_b64 = base64.b64encode(image_png).decode("ascii")
        payload = {
            "model": self.config.model,
            "stream": False,
            "format": "json",
            "messages": [
                {
                    "role": "user",
                    "content": LABEL_PROMPT,
                    "images": [image_b64],
                }
            ],
            "options": {"temperature": 0},
        }
        url = self.config.ollama_url.rstrip("/") + "/api/chat"

        async def _call() -> dict:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                return response.json()

        result = await asyncio.wait_for(_call(), timeout=self.config.timeout_seconds)
        raw = result.get("message", {}).get("content", "")
        return parse_label_response(raw)


def create_tool_namer(config: ToolNamerConfig | None = None) -> ToolNamer:
    config = config or ToolNamerConfig.from_settings()
    provider = config.provider.strip().lower()
    if provider in ("", "none", "off", "disabled"):
        return FallbackToolNamer()
    if provider == "ollama":
        return OllamaToolNamer(config)

    logger.warning("unsupported tool naming provider '%s'; using fallback labels", provider)
    return FallbackToolNamer()


async def name_polygons(
    image_path: str | None,
    polygons: list[Polygon],
    namer: ToolNamer | None = None,
    max_crop_px: int | None = None,
) -> list[Polygon]:
    """Apply optional generated names to generic polygon labels without failing tracing."""
    if not polygons:
        return polygons

    for index, polygon in enumerate(polygons):
        if not polygon.label:
            polygon.label = fallback_label(index)

    config = ToolNamerConfig.from_settings()
    namer = namer or create_tool_namer(config)
    max_crop_px = max_crop_px if max_crop_px is not None else config.max_crop_px
    if isinstance(namer, FallbackToolNamer) or not image_path:
        return polygons

    image = cv2.imread(image_path)
    if image is None:
        logger.warning("tool naming skipped; failed to read corrected image")
        return polygons

    for index, polygon in enumerate(polygons):
        if polygon.label and not is_fallback_label(polygon.label):
            continue

        crop = crop_polygon_image(image, polygon, max_crop_px)
        if crop is None:
            logger.info("tool naming skipped polygon=%d reason=no_crop", index + 1)
            continue

        try:
            label = await namer.name(crop)
        except Exception as exc:
            logger.warning("tool naming skipped polygon=%d: %s", index + 1, exc)
            continue

        if label:
            polygon.label = label

    return polygons


def fallback_label(index: int) -> str:
    return f"tool {index + 1}"


def is_fallback_label(label: str | None) -> bool:
    return bool(label and re.fullmatch(r"tool\s+\d+", label.strip().lower()))


def crop_polygon_image(image: np.ndarray, polygon: Polygon, max_crop_px: int) -> bytes | None:
    crop = crop_polygon_array(image, polygon, max_crop_px)
    if crop is None:
        return None
    ok, encoded = cv2.imencode(".png", crop)
    if not ok:
        return None
    return encoded.tobytes()


def crop_polygon_array(image: np.ndarray, polygon: Polygon, max_crop_px: int) -> np.ndarray | None:
    if not polygon.points:
        return None

    height, width = image.shape[:2]
    xs = [point.x for point in polygon.points]
    ys = [point.y for point in polygon.points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    box_w = max_x - min_x
    box_h = max_y - min_y
    if box_w <= 1 or box_h <= 1:
        return None

    pad = max(8, int(max(box_w, box_h) * 0.18))
    x1 = max(0, int(np.floor(min_x)) - pad)
    y1 = max(0, int(np.floor(min_y)) - pad)
    x2 = min(width, int(np.ceil(max_x)) + pad)
    y2 = min(height, int(np.ceil(max_y)) + pad)
    if x2 <= x1 or y2 <= y1:
        return None

    crop = image[y1:y2, x1:x2]
    mask = np.zeros(crop.shape[:2], dtype=np.uint8)

    exterior = _points_to_cv2(polygon.points, x1, y1)
    cv2.fillPoly(mask, [exterior], 255)
    for ring in polygon.interior_rings:
        if len(ring) >= 3:
            cv2.fillPoly(mask, [_points_to_cv2(ring, x1, y1)], 0)

    white = np.full_like(crop, 255)
    isolated = np.where(mask[:, :, None] > 0, crop, white)

    longest = max(isolated.shape[:2])
    if longest > max_crop_px > 0:
        scale = max_crop_px / longest
        new_w = max(1, int(isolated.shape[1] * scale))
        new_h = max(1, int(isolated.shape[0] * scale))
        isolated = cv2.resize(isolated, (new_w, new_h), interpolation=cv2.INTER_AREA)

    return isolated


def _points_to_cv2(points: list[Point], offset_x: int, offset_y: int) -> np.ndarray:
    return np.array(
        [[round(point.x - offset_x), round(point.y - offset_y)] for point in points],
        dtype=np.int32,
    )


def parse_label_response(response: str) -> str | None:
    try:
        start = response.find("{")
        end = response.rfind("}") + 1
        if start >= 0 and end > start:
            response = response[start:end]
        data = json.loads(response)
    except (TypeError, json.JSONDecodeError):
        return None

    name = data.get("name")
    if not isinstance(name, str):
        return None
    return validate_label(name)


def validate_label(name: str) -> str | None:
    normalized = re.sub(r"\s+", " ", name.strip().lower())
    normalized = normalized.strip(" .,:;\"'")
    if not normalized:
        return None
    if len(normalized) > 40:
        return None
    if len(normalized.split()) > 4:
        return None
    if normalized in _BAD_EXACT_NAMES:
        return None
    if any(fragment in normalized for fragment in _BAD_NAME_FRAGMENTS):
        return None
    if not re.search(r"[a-z0-9]", normalized):
        return None
    return normalized
