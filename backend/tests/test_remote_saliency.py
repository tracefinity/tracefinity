"""Tests for the hosted-inference saliency module (mocked HTTP)."""

import asyncio
import base64
import io
import json

import httpx
import numpy as np
import pytest
from PIL import Image

from app.services.remote_saliency import (
    RemoteSaliencyConfig,
    _to_binary,
    remote_saliency_mask,
)


def _png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def test_to_binary_from_grayscale_mask_resizes_and_thresholds():
    mask = np.zeros((10, 10), np.uint8)
    mask[2:8, 2:8] = 255
    out = _to_binary(_png(mask), (20, 20))
    assert out.shape == (20, 20)
    assert set(np.unique(out)) <= {0, 255}
    assert out[10, 10] == 255  # centre is foreground


def test_to_binary_from_rgba_cutout_uses_alpha():
    rgba = np.zeros((10, 10, 4), np.uint8)
    rgba[3:7, 3:7, 3] = 255  # opaque square = foreground
    out = _to_binary(_png(rgba), (10, 10))
    assert out[5, 5] == 255
    assert out[0, 0] == 0


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_fal_request_uses_mask_only_and_sync_mode():
    seen = {}
    mask = np.full((8, 8), 255, np.uint8)
    data_uri = "data:image/png;base64," + base64.b64encode(_png(mask)).decode()

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"image": {"url": data_uri}})

    cfg = RemoteSaliencyConfig(provider="fal", model="fal-ai/birefnet/v2", token="fal_x")
    client = _client(handler)
    out = asyncio.run(remote_saliency_mask(cfg, _png(mask), (8, 8), client=client))
    asyncio.run(client.aclose())

    assert seen["url"] == "https://fal.run/fal-ai/birefnet/v2"
    assert seen["auth"] == "Key fal_x"
    assert seen["body"]["mask_only"] is True
    assert seen["body"]["sync_mode"] is True
    assert seen["body"]["image_url"].startswith("data:image/png;base64,")
    assert out.shape == (8, 8)
