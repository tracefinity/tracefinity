from __future__ import annotations

import asyncio
import base64
import io
import logging
from dataclasses import dataclass

import cv2
import httpx
import numpy as np
from PIL import Image

FAL_BASE = "https://fal.run"
REPLICATE_BASE = "https://api.replicate.com/v1"


@dataclass(frozen=True)
class RemoteSaliencyConfig:
    provider: str  # "replicate" | "fal"
    model: str  # slug, e.g. "men1scus/birefnet" or "fal-ai/birefnet/v2"
    token: str
    fal_operating_resolution: str = "1024x1024"
    replicate_resolution: str | None = None


def _data_uri(image_png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(image_png).decode()


def _to_binary(img_bytes: bytes, target_size: tuple[int, int]) -> np.ndarray:
    """decode a provider mask or cutout to a binary fg mask (fg=255) at
    target_size (w, h). cutout => alpha is foreground; mask => luminance."""
    img = Image.open(io.BytesIO(img_bytes))
    if "A" in img.getbands():
        chan = np.array(img.convert("RGBA"))[:, :, 3]
    else:
        chan = np.array(img.convert("L"))
    w, h = target_size
    if chan.shape[:2] != (h, w):
        chan = cv2.resize(chan, (w, h), interpolation=cv2.INTER_AREA)
    _, binary = cv2.threshold(chan, 127, 255, cv2.THRESH_BINARY)
    return binary


async def _fetch_image_bytes(client: httpx.AsyncClient, ref: str) -> bytes:
    if ref.startswith("data:"):
        return base64.b64decode(ref.split(",", 1)[1])
    resp = await client.get(ref)
    resp.raise_for_status()
    return resp.content


async def remote_saliency_mask(
    cfg: RemoteSaliencyConfig,
    image_png: bytes,
    target_size: tuple[int, int],
    *,
    client: httpx.AsyncClient | None = None,
    timeout: float = 90.0,
) -> np.ndarray:
    raise NotImplementedError
