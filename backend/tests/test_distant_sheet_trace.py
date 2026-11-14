"""Regression for #253: a sheet photographed from further away is a small
share of the corrected image. The saliency crop measured the sheet against the
frame, discarded it, and the model ran on the whole image, where the sheet is
the salient object. Tools on such a sheet cover few pixels, and the fixed
pixel floor for traced regions dropped the smaller ones."""

import asyncio

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.api.routes as routes
import app.services.remote_saliency as remote
from app.config import ensure_user_dirs
from app.constants import PAPER_SIZES
from app.main import app
from app.services.ai_tracer import MIN_TOOL_AREA_PX, AITracer, _min_tool_area_px
from tests.physical_size_fixture import rectangle_mask, synthetic_photo

W, H = 1600, 2048
SHEET = (500, 800, 1100, 1224)  # x0, y0, x1, y1: under 8% of the frame
SHEET_AREA = (SHEET[2] - SHEET[0]) * (SHEET[3] - SHEET[1])
TOOL = (720, 960, 880, 1060)
FLOOR = (90, 130, 170)


def _scene() -> np.ndarray:
    img = np.full((H, W, 3), FLOOR, np.uint8)
    cv2.rectangle(img, SHEET[:2], SHEET[2:], (245, 245, 245), -1)
    cv2.rectangle(img, TOOL[:2], TOOL[2:], (40, 40, 40), -1)
    return img


def test_distant_sheet_is_found_from_its_own_area():
    rect = AITracer._detect_paper_rect(_scene(), SHEET_AREA)

    assert rect is not None
    x, y, w, h = rect
    # erosion pulls the rect ~20px inside the sheet
    assert SHEET[0] <= x <= SHEET[0] + 30 and SHEET[1] <= y <= SHEET[1] + 30
    assert SHEET[2] - 30 <= x + w <= SHEET[2] and SHEET[3] - 30 <= y + h <= SHEET[3]


def test_bright_patch_much_smaller_than_the_sheet_is_not_the_sheet():
    img = np.full((H, W, 3), FLOOR, np.uint8)
    # large enough to survive erosion, a twelfth of the sheet's area
    cv2.rectangle(img, (600, 900), (780, 1040), (245, 245, 245), -1)

    assert AITracer._detect_paper_rect(img, SHEET_AREA) is None


def test_model_runs_on_the_sheet_not_the_frame(tmp_path, monkeypatch):
    path = tmp_path / "corrected.png"
    cv2.imwrite(str(path), _scene())
    tracer = AITracer(saliency_tracer="fal", remote_model="m", remote_token="x")
    crops: list[tuple[int, int]] = []

    async def fake_saliency(pil_img: Image.Image):
        crops.append(pil_img.size)
        return np.where(np.array(pil_img.convert("L")) < 80, 255, 0).astype(np.uint8)

    monkeypatch.setattr(tracer, "_saliency_on_image", fake_saliency)

    out = asyncio.run(tracer._generate_mask_saliency(
        str(path), output_path=str(tmp_path / "mask.png"), sheet_area_px=SHEET_AREA,
    ))

    assert crops[0][0] <= SHEET[2] - SHEET[0] and crops[0][1] <= SHEET[3] - SHEET[1], crops
    ys, xs = np.where(cv2.imread(out, cv2.IMREAD_GRAYSCALE) == 0)
    assert (xs.min(), ys.min(), xs.max(), ys.max()) == (TOOL[0], TOOL[1], TOOL[2], TOOL[3])


def test_smallest_kept_region_is_physical_once_the_sheet_is_distant():
    assert _min_tool_area_px(None) == MIN_TOOL_AREA_PX
    # sheet filling the frame: the pixel floor still applies
    assert _min_tool_area_px(0.15) == MIN_TOOL_AREA_PX
    # distant sheet: the same 150 mm2 is far fewer pixels
    assert _min_tool_area_px(0.5) == 600


def test_trace_route_crops_a_distant_sheet_and_keeps_its_tool(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "tracers", "replicate")
    monkeypatch.setattr(routes.settings, "replicate_api_token", "synthetic-test-token")
    monkeypatch.setattr(routes.settings, "tool_label_provider", "none")
    monkeypatch.setattr(routes, "_store_cache", {})
    monkeypatch.setattr(routes, "_project_store_cache", {})
    monkeypatch.setattr(routes, "_tracers", {})
    monkeypatch.setattr(routes.image_processor, "detect_paper_corners", lambda *_: None)
    monkeypatch.delenv("E2E_TEST_MODE", raising=False)
    ensure_user_dirs(tmp_path / "default")
    submitted = []

    async def infer_rectangle(client, config, data_uri):
        mask, size = rectangle_mask(data_uri)
        submitted.append(size)
        return mask

    monkeypatch.setattr(remote, "_via_replicate", infer_rectangle)
    photo, corners, original_size = synthetic_photo(PAPER_SIZES["a4"], sheet_scale=0.3)
    with TestClient(app) as client:
        uploaded = client.post("/api/upload", files={"image": ("distant.jpg", photo, "image/jpeg")}).json()
        sid = uploaded["session_id"]
        ratio = uploaded["image_width"] / original_size[0]
        confirmed = client.post(f"/api/sessions/{sid}/corners", json={
            "paper_size": "a4",
            "corners": [{"x": float(x * ratio), "y": float(y * ratio)} for x, y in corners],
        })
        assert confirmed.status_code == 200, confirmed.text
        scale = confirmed.json()["scale_factor"]
        traced = client.post(f"/api/sessions/{sid}/trace", json={"tracer": "replicate"})
        assert traced.status_code == 200, traced.text

    sheet_area = 210 * 297 / scale ** 2
    assert sheet_area < 0.1 * 2048 * 2048, "fixture must put the sheet under the old frame-share floor"
    width, height = submitted[0]
    assert 0.7 * sheet_area <= width * height <= sheet_area, (submitted, sheet_area)
    polygons = traced.json()["polygons"]
    assert len(polygons) == 1
    points = np.asarray([(p["x"], p["y"]) for p in polygons[0]["points"]], dtype=np.float32)
    assert cv2.contourArea(points) < MIN_TOOL_AREA_PX, "fixture's tool must be under the pixel floor"
    assert sorted(cv2.minAreaRect(points)[1]) == pytest.approx([30 / scale, 80 / scale], abs=1 / scale)
