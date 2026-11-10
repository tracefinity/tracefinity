"""Corner step on photos where the sheet fills only part of the frame.

The corrected image covers the whole visible frame, so the area it spans grows
as the sheet shrinks in the photo. It must still come out at the stored size
and at the true scale (#244).
"""

import math
import tracemalloc

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.api.routes as routes
from app.config import ensure_user_dirs
from app.constants import PAPER_SIZES
from app.main import app
from tests.physical_size_fixture import synthetic_photo

# warping and jpeg leave each sheet edge within a pixel of its true position
EDGE_TOLERANCE_PX = 2


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    monkeypatch.setattr(routes.image_processor, "detect_paper_corners", lambda *_: None)
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def _upload(client, photo):
    resp = client.post("/api/upload", files={"image": ("photo.jpg", photo, "image/jpeg")})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _confirm_corners(client, uploaded, corners, original_size, paper_size):
    ratio = uploaded["image_width"] / original_size[0]
    return client.post(f"/api/sessions/{uploaded['session_id']}/corners", json={
        "paper_size": paper_size,
        "corners": [{"x": float(x * ratio), "y": float(y * ratio)} for x, y in corners],
    })


def _corrected_path(tmp_path, body):
    return tmp_path / body["corrected_image_url"].removeprefix("/storage/")


def _sheet_mm(image_path, scale_factor):
    """side lengths of the bright sheet in the corrected image, in mm.

    taken from the sheet's area and the aspect ratio of its bounding rectangle:
    ragged pixel edges widen a bounding rectangle but leave the area unbiased."""
    gray = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    # midway between the table and the sheet
    _, bright = cv2.threshold(gray, 165, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    sheet = max(contours, key=cv2.contourArea)
    filled = np.zeros_like(bright)
    cv2.drawContours(filled, [sheet], -1, 255, cv2.FILLED)
    area = cv2.countNonZero(filled)
    short, long = sorted(cv2.minAreaRect(sheet)[1])
    aspect = long / short
    return [math.sqrt(area / aspect) * scale_factor, math.sqrt(area * aspect) * scale_factor]


def _small_photo():
    """600x800 photo of a sheet, small enough that the corrected image outgrows it."""
    size = (600, 800)
    corners = np.float32([(150, 200), (450, 210), (460, 620), (140, 610)])
    img = np.full((size[1], size[0], 3), (40, 70, 100), np.uint8)
    cv2.fillPoly(img, [corners.astype(np.int32)], (255, 255, 255))
    ok, encoded = cv2.imencode(".jpg", img)
    assert ok
    return encoded.tobytes(), corners, size


@pytest.mark.parametrize(
    "paper_size,landscape,exif_rotated,sheet_scale",
    [
        ("a4", False, False, 1 / 3),
        ("letter", True, True, 1 / 3),
        ("a3", False, False, 1 / 3),
        ("a4", False, False, 1 / 8),
    ],
    ids=["a4-quarter-of-frame", "letter-landscape-rotated", "a3-quarter-of-frame", "a4-tenth-of-frame"],
)
def test_distant_sheet_is_corrected_at_true_scale(
    tmp_path, monkeypatch, paper_size, landscape, exif_rotated, sheet_scale,
):
    client = _client(tmp_path, monkeypatch)
    photo, corners, original_size = synthetic_photo(PAPER_SIZES[paper_size], landscape, exif_rotated, sheet_scale)

    resp = _confirm_corners(client, _upload(client, photo), corners, original_size, paper_size)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    corrected = _corrected_path(tmp_path, body)
    height, width = cv2.imread(str(corrected)).shape[:2]
    assert max(width, height) == routes.MAX_UPLOAD_DIM
    tolerance = EDGE_TOLERANCE_PX * body["scale_factor"]
    assert _sheet_mm(corrected, body["scale_factor"]) == pytest.approx(sorted(PAPER_SIZES[paper_size]), abs=tolerance)


def test_corrected_image_follows_the_stored_size(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(routes, "MAX_UPLOAD_DIM", 512)
    photo, corners, original_size = synthetic_photo(PAPER_SIZES["a4"], sheet_scale=1 / 3)

    resp = _confirm_corners(client, _upload(client, photo), corners, original_size, "a4")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    corrected = _corrected_path(tmp_path, body)
    height, width = cv2.imread(str(corrected)).shape[:2]
    assert max(width, height) == 512
    tolerance = EDGE_TOLERANCE_PX * body["scale_factor"]
    assert _sheet_mm(corrected, body["scale_factor"]) == pytest.approx([210, 297], abs=tolerance)


def test_upload_pixel_limit_does_not_reject_the_corrected_image(tmp_path, monkeypatch):
    """the limit guards uploaded files. the corrected image is produced at the
    stored size and can hold more pixels than a small upload."""
    client = _client(tmp_path, monkeypatch)
    photo, corners, original_size = _small_photo()
    monkeypatch.setattr(routes.settings, "max_image_pixels", original_size[0] * original_size[1])

    resp = _confirm_corners(client, _upload(client, photo), corners, original_size, "a4")

    assert resp.status_code == 200, resp.text


def test_distant_sheet_is_corrected_within_a_bounded_working_size(tmp_path, monkeypatch):
    """at full resolution the frame around a distant sheet spans tens of
    megapixels; the step must not allocate it."""
    client = _client(tmp_path, monkeypatch)
    photo, corners, original_size = synthetic_photo(PAPER_SIZES["a4"], sheet_scale=1 / 3)
    uploaded = _upload(client, photo)

    tracemalloc.start()
    try:
        resp = _confirm_corners(client, uploaded, corners, original_size, "a4")
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert resp.status_code == 200, resp.text
    stored_bytes = routes.MAX_UPLOAD_DIM ** 2 * 3
    assert peak < 8 * stored_bytes
