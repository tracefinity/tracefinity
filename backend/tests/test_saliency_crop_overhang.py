"""Regression for #212 (part 1): saliency ran on a crop clipped to the paper,
so a tool overhanging the sheet came back cut flat at the paper edge."""

import asyncio

import cv2
import numpy as np
from PIL import Image

from app.services.ai_tracer import AITracer

W, H = 600, 800
SHEET_RECT = (110, 160, 380, 480)  # x, y, w, h, as _detect_paper_rect would return


def _tracer():
    # remote backend: no model load, _saliency_on_image is replaced anyway
    return AITracer(saliency_tracer="fal", remote_model="m", remote_token="x")


def _scene(tool_y0: int, tool_y1: int) -> np.ndarray:
    img = np.full((H, W, 3), 120, np.uint8)
    cv2.rectangle(img, (100, 150), (500, 650), (245, 245, 245), -1)
    cv2.rectangle(img, (280, tool_y0), (320, tool_y1), (40, 40, 40), -1)
    return img


def _run(tmp_path, monkeypatch, img):
    path = tmp_path / "corrected.png"
    cv2.imwrite(str(path), img)
    t = _tracer()
    crops: list[tuple[int, int]] = []

    async def fake_saliency(pil_img: Image.Image):
        arr = np.array(pil_img.convert("L"))
        crops.append(pil_img.size)
        return np.where(arr < 80, 255, 0).astype(np.uint8)

    monkeypatch.setattr(t, "_saliency_on_image", fake_saliency)
    monkeypatch.setattr(AITracer, "_detect_paper_rect", staticmethod(lambda _img: SHEET_RECT))
    out = asyncio.run(t._generate_mask_saliency(str(path), output_path=str(tmp_path / "mask.png")))
    mask = cv2.imread(out, cv2.IMREAD_GRAYSCALE)
    return mask, crops


def test_overhanging_tool_is_kept_whole(tmp_path, monkeypatch):
    mask, crops = _run(tmp_path, monkeypatch, _scene(60, 740))

    ys = np.where(mask == 0)[0]
    assert ys.min() <= 60
    assert ys.max() >= 739
    assert len(crops) >= 2
    assert crops[-1][1] > SHEET_RECT[3]


def test_tool_inside_sheet_uses_single_crop(tmp_path, monkeypatch):
    mask, crops = _run(tmp_path, monkeypatch, _scene(300, 500))

    ys = np.where(mask == 0)[0]
    assert ys.min() == 300
    assert ys.max() == 500
    assert len(crops) == 1
    assert crops[0] == (SHEET_RECT[2], SHEET_RECT[3])


def test_ballooning_mask_after_growth_keeps_previous_crop(tmp_path, monkeypatch):
    img = _scene(60, 740)
    path = tmp_path / "corrected.png"
    cv2.imwrite(str(path), img)
    t = _tracer()
    crops: list[tuple[int, int]] = []

    async def fake_saliency(pil_img: Image.Image):
        # inside the paper crop: the tool. any larger crop: saliency flips
        # onto the sheet and returns everything as foreground
        crops.append(pil_img.size)
        arr = np.array(pil_img.convert("L"))
        if pil_img.size == (SHEET_RECT[2], SHEET_RECT[3]):
            return np.where(arr < 80, 255, 0).astype(np.uint8)
        return np.full(arr.shape, 255, np.uint8)

    monkeypatch.setattr(t, "_saliency_on_image", fake_saliency)
    monkeypatch.setattr(AITracer, "_detect_paper_rect", staticmethod(lambda _img: SHEET_RECT))
    out = asyncio.run(t._generate_mask_saliency(str(path), output_path=str(tmp_path / "mask.png")))
    mask = cv2.imread(out, cv2.IMREAD_GRAYSCALE)

    ys, xs = np.where(mask == 0)
    assert len(crops) == 2
    assert ys.min() == SHEET_RECT[1]
    assert ys.max() == SHEET_RECT[1] + SHEET_RECT[3] - 1
    assert xs.min() == 280 and xs.max() == 320


def test_crop_never_leaves_the_image(tmp_path, monkeypatch):
    mask, crops = _run(tmp_path, monkeypatch, _scene(0, H))

    ys = np.where(mask == 0)[0]
    assert ys.min() == 0
    assert ys.max() == H - 1
    assert all(w <= W and h <= H for w, h in crops)
