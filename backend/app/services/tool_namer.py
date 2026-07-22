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

# Per-model retry budget for OpenRouterToolNamer before falling through to
# the next model in the priority list.
_OPENROUTER_MAX_ATTEMPTS_PER_MODEL = 2


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
    openrouter_api_key: str | None = settings.openrouter_api_key
    openrouter_model: str = settings.openrouter_label_model

    @classmethod
    def from_settings(cls) -> "ToolNamerConfig":
        return cls(
            provider=settings.tool_label_provider,
            model=settings.tool_label_model,
            ollama_url=settings.tool_label_ollama_url,
            timeout_seconds=settings.tool_label_timeout_seconds,
            max_crop_px=settings.tool_label_max_crop_px,
            openrouter_api_key=settings.openrouter_api_key,
            openrouter_model=settings.openrouter_label_model,
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

        result = await _call()
        raw = result.get("message", {}).get("content", "")
        return parse_label_response(raw)


class OpenRouterToolNamer:
    """Names an isolated tool crop via an OpenRouter vision model.
    """

    def __init__(self, config: ToolNamerConfig):
        self.config = config

    async def name(self, image_png: bytes) -> str | None:
        import httpx

        if not self.config.openrouter_api_key:
            logger.warning("tool naming provider=openrouter but no OPENROUTER_API_KEY set")
            return None

        image_b64 = base64.b64encode(image_png).decode("ascii")
        data_url = f"data:image/png;base64,{image_b64}"

        # openrouter_model may be a comma-separated priority list. Free-tier
        # (":free") models share a 20 req/min pool per model across all
        # OpenRouter users, so any single model can fail under load that has
        # nothing to do with this account. Try each model in order and fall
        # through to the next on any error, not just 429.
        models = [m.strip() for m in self.config.openrouter_model.split(",") if m.strip()]

        async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
            for model in models:
                response = await self._post_with_retry(client, model, data_url)
                if response.status_code >= 400:
                    logger.info("openrouter %s failed (%d)", model, response.status_code)
                    continue

                # A 200 can still carry no usable content (e.g. reasoning
                # models may return null content); treat that as "no name".
                result = response.json()
                choices = result.get("choices") or [{}]
                message = choices[0].get("message") or {}
                raw = message.get("content")
                if not raw:
                    return None
                return parse_label_response(raw)

        logger.warning("openrouter failed on all configured models: %s", models)
        return None

    async def _post_with_retry(self, client, model: str, data_url: str):
        """POST one naming request for one model, retrying briefly on 429."""
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": LABEL_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            "temperature": 0,
        }
        headers = {"Authorization": f"Bearer {self.config.openrouter_api_key}"}

        for attempt in range(_OPENROUTER_MAX_ATTEMPTS_PER_MODEL):
            response = await client.post(settings.openrouter_url, json=payload, headers=headers)
            if response.status_code != 429 or attempt == _OPENROUTER_MAX_ATTEMPTS_PER_MODEL - 1:
                return response

            # Retry-After is server-controlled; cap it to the namer's own
            # TOOL_LABEL_TIMEOUT_SECONDS budget so a large value can't stall
            # the whole trace request. The HTTP-date form isn't a float and
            # falls back to the default backoff.
            try:
                delay = float(response.headers["retry-after"])
            except (KeyError, ValueError):
                delay = 2.0 * (attempt + 1)
            delay = min(delay, self.config.timeout_seconds)
            logger.info("openrouter 429 on %s, retrying in %.1fs", model, delay)
            await asyncio.sleep(delay)


def create_tool_namer(config: ToolNamerConfig | None = None) -> ToolNamer:
    config = config or ToolNamerConfig.from_settings()
    provider = config.provider.strip().lower()
    if provider in ("", "none", "off", "disabled"):
        return FallbackToolNamer()
    if provider == "ollama":
        return OllamaToolNamer(config)
    if provider == "openrouter":
        return OpenRouterToolNamer(config)

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
