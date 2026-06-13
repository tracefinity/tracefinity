from __future__ import annotations

import asyncio
import base64
import io
from dataclasses import dataclass

import cv2
import httpx
import numpy as np
from PIL import Image

FAL_BASE = "https://fal.run"
REPLICATE_BASE = "https://api.replicate.com/v1"

# community models run via POST /v1/predictions with a version hash. cache the
# resolved latest version per model slug for the process lifetime.
_REPLICATE_VERSIONS: dict[str, str] = {}


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


async def _via_fal(client: httpx.AsyncClient, cfg: RemoteSaliencyConfig, data_uri: str) -> bytes:
    payload = {
        "image_url": data_uri,
        "mask_only": True,
        "sync_mode": True,
        "output_format": "png",
        "operating_resolution": cfg.fal_operating_resolution,
    }
    resp = await client.post(
        f"{FAL_BASE}/{cfg.model}",
        json=payload,
        headers={"Authorization": f"Key {cfg.token}", "Content-Type": "application/json"},
    )
    resp.raise_for_status()
    ref = resp.json()["image"]["url"]
    return await _fetch_image_bytes(client, ref)


async def remote_saliency_mask(
    cfg: RemoteSaliencyConfig,
    image_png: bytes,
    target_size: tuple[int, int],
    *,
    client: httpx.AsyncClient | None = None,
    timeout: float = 90.0,
) -> np.ndarray:
    """run a hosted saliency model, return a binary fg mask (fg=255) at
    target_size (w, h). raises on provider failure."""
    data_uri = _data_uri(image_png)
    owns = client is None
    client = client or httpx.AsyncClient(timeout=timeout)
    try:
        if cfg.provider == "fal":
            img_bytes = await asyncio.wait_for(_via_fal(client, cfg, data_uri), timeout=timeout)
        elif cfg.provider == "replicate":
            img_bytes = await asyncio.wait_for(_via_replicate(client, cfg, data_uri), timeout=timeout)
        else:
            raise ValueError(f"unknown remote provider: {cfg.provider}")
    finally:
        if owns:
            await client.aclose()
    return _to_binary(img_bytes, target_size)


async def _poll_replicate(client: httpx.AsyncClient, cfg: RemoteSaliencyConfig, pred: dict, attempts: int = 30, delay: float = 2.0):
    """if Prefer: wait did not reach a terminal state, poll urls.get."""
    headers = {"Authorization": f"Bearer {cfg.token}"}
    for _ in range(attempts):
        status = pred.get("status")
        if status == "succeeded":
            return pred
        if status in ("failed", "canceled"):
            raise ValueError(f"replicate prediction {status}: {pred.get('error')}")
        get_url = pred.get("urls", {}).get("get")
        if not get_url:
            raise ValueError("replicate prediction not terminal and no poll url")
        await asyncio.sleep(delay)
        resp = await client.get(get_url, headers=headers)
        resp.raise_for_status()
        pred = resp.json()
    raise TimeoutError("replicate prediction did not finish in time")


async def _best_effort_delete(client, cfg, pred) -> None:
    """opportunistic purge; api predictions also auto-expire after ~1h."""
    url = pred.get("urls", {}).get("get")
    if not url:
        return
    try:
        await client.delete(url, headers={"Authorization": f"Bearer {cfg.token}"})
    except Exception:
        pass


async def _resolve_replicate_version(client: httpx.AsyncClient, cfg: RemoteSaliencyConfig) -> str:
    """resolve the version hash to run. `owner/name:version` pins explicitly;
    `owner/name` resolves (and caches) the model's latest version."""
    if ":" in cfg.model:
        return cfg.model.split(":", 1)[1]
    if cfg.model in _REPLICATE_VERSIONS:
        return _REPLICATE_VERSIONS[cfg.model]
    resp = await client.get(
        f"{REPLICATE_BASE}/models/{cfg.model}",
        headers={"Authorization": f"Bearer {cfg.token}"},
    )
    resp.raise_for_status()
    version = resp.json()["latest_version"]["id"]
    _REPLICATE_VERSIONS[cfg.model] = version
    return version


async def _via_replicate(client: httpx.AsyncClient, cfg: RemoteSaliencyConfig, data_uri: str) -> bytes:
    version = await _resolve_replicate_version(client, cfg)
    image_input = {"image": data_uri}
    if cfg.replicate_resolution:
        image_input["resolution"] = cfg.replicate_resolution
    resp = await client.post(
        f"{REPLICATE_BASE}/predictions",
        json={"version": version, "input": image_input},
        headers={
            "Authorization": f"Bearer {cfg.token}",
            "Content-Type": "application/json",
            "Prefer": "wait",
        },
    )
    resp.raise_for_status()
    pred = await _poll_replicate(client, cfg, resp.json())
    output = pred.get("output")
    if isinstance(output, list):
        output = output[0] if output else None
    if not output:
        raise ValueError("replicate prediction returned no output")
    img = await _fetch_image_bytes(client, output)
    await _best_effort_delete(client, cfg, pred)
    return img
