"""Regression for #213: on a bright sheet against a dark background U2-Net
returns the sheet as the salient object, and blacking it out left nothing
for paper detection to find."""

import cv2
import numpy as np
import pytest

from app.services import image_processor as ip_module
from app.services.image_processor import ImageProcessor

W, H = 1200, 1600
SHEET = (150, 200, 1050, 1400)


def _processor() -> ImageProcessor:
    ip = ImageProcessor.__new__(ImageProcessor)
    ip._tool_mask_session = object()  # pretend U2-Net loaded
    return ip


@pytest.fixture
def photo(tmp_path):
    img = np.full((H, W, 3), 30, np.uint8)
    cv2.rectangle(img, SHEET[:2], SHEET[2:], (245, 245, 245), -1)
    path = tmp_path / "photo.png"
    cv2.imwrite(str(path), img)
    return path


def _sheet_mask() -> np.ndarray:
    mask = np.zeros((H, W), np.uint8)
    mask[SHEET[1]:SHEET[3], SHEET[0]:SHEET[2]] = 255
    return mask


def _small_mask() -> np.ndarray:
    mask = np.zeros((H, W), np.uint8)
    mask[600:800, 500:700] = 255
    return mask


def test_mask_covering_the_sheet_is_ignored(photo, monkeypatch):
    ip = _processor()
    monkeypatch.setattr(ip, "_get_tool_mask", lambda _p: _sheet_mask())

    corners = ip.detect_paper_corners(str(photo))

    assert corners is not None
    expected = [(SHEET[0], SHEET[1]), (SHEET[2], SHEET[1]), (SHEET[2], SHEET[3]), (SHEET[0], SHEET[3])]
    for (x, y), (ex, ey) in zip(corners, expected):
        assert abs(x - ex) <= 15 and abs(y - ey) <= 15, corners


def test_large_mask_skips_masking_entirely(photo, monkeypatch):
    ip = _processor()
    monkeypatch.setattr(ip, "_get_tool_mask", lambda _p: _sheet_mask())
    seen = []
    monkeypatch.setattr(ip, "_detect_paper", lambda img: seen.append(img.copy()) or [(1, 1), (2, 1), (2, 2), (1, 2)])

    ip.detect_paper_corners(str(photo))

    assert len(seen) == 1
    assert (seen[0][_sheet_mask() > 0] != 0).any()


def test_masked_miss_retries_unmasked(photo, monkeypatch):
    ip = _processor()
    small = _small_mask()
    monkeypatch.setattr(ip, "_get_tool_mask", lambda _p: small)
    seen = []

    def detect(img):
        seen.append(img.copy())
        return None if len(seen) == 1 else [(1, 1), (2, 1), (2, 2), (1, 2)]

    monkeypatch.setattr(ip, "_detect_paper", detect)

    corners = ip.detect_paper_corners(str(photo))

    assert corners == [(1, 1), (2, 1), (2, 2), (1, 2)]
    assert len(seen) == 2
    assert (seen[0][small > 0] == 0).all()
    assert (seen[1][small > 0] != 0).any()


def test_fraction_threshold_is_below_a_sheet_and_above_a_tool():
    assert 0.25 <= ip_module.TOOL_MASK_MAX_FRACTION <= 0.5
