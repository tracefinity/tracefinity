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
