"""Physical dimensions through upload, tracing, library, and downloaded STL.

The photo is generated from a known flat 80 x 30 mm rectangle on paper.
Sheet corners are either confirmed directly or found by the OpenCV detector.
Hosted inference is substituted with segmentation of the actual submitted
pixels, so calibration, both resizes, mask placement, contour extraction,
persistence, clearance, and mesh generation stay real. This does not measure
live model accuracy, browser coordinate handling, or camera parallax.
"""

import io

import cv2
import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient
from shapely.geometry import Polygon, box

import app.api.routes as routes
import app.services.remote_saliency as remote
from app.config import ensure_user_dirs
from app.main import app
from tests.physical_size_fixture import rectangle_mask, synthetic_photo

# Warping, provider resampling, and contour cleanup each quantize the boundary.
# At the 2048px image limit their combined error can exceed half a millimetre.
SIZE_TOLERANCE_MM = 1.0


def _dimensions(points):
    return sorted(cv2.minAreaRect(np.asarray(points, dtype=np.float32))[1])


def _json(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("automatic_corners", [False, True], ids=["confirmed-corners", "detected-corners"])
@pytest.mark.parametrize(
    "paper_size,paper_mm,landscape,exif_rotated,smoothed",
    [
        ("a4", (210, 297), False, False, False),
        ("a4", (210, 297), True, True, True),
        ("letter", (215.9, 279.4), False, True, False),
        ("a3", (297, 420), True, False, True),
    ],
)
def test_photo_to_downloaded_pocket_preserves_millimetres(
    tmp_path, monkeypatch, paper_size, paper_mm, landscape, exif_rotated, smoothed, automatic_corners,
):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "tracers", "replicate")
    monkeypatch.setattr(routes.settings, "replicate_api_token", "synthetic-test-token")
    monkeypatch.setattr(routes.settings, "tool_label_provider", "none")
    monkeypatch.setattr(routes, "_store_cache", {})
    monkeypatch.setattr(routes, "_project_store_cache", {})
    monkeypatch.setattr(routes, "_tracers", {})
    monkeypatch.delenv("E2E_TEST_MODE", raising=False)
    ensure_user_dirs(tmp_path / "default")
    if automatic_corners:
        # Exercise OpenCV corner detection without U2-Net mask inference.
        monkeypatch.setattr(routes.image_processor, "_tool_mask_session", None)
    else:
        monkeypatch.setattr(routes.image_processor, "detect_paper_corners", lambda *_: None)
    provider_calls = []

    async def infer_rectangle(client, config, data_uri):
        mask, size = rectangle_mask(data_uri)
        provider_calls.append(size)
        return mask

    monkeypatch.setattr(remote, "_via_replicate", infer_rectangle)
    photo, corners, original_size = synthetic_photo(paper_mm, landscape, exif_rotated)
    with TestClient(app) as client:
        uploaded = _json(client.post("/api/upload", files={"image": ("rectangle.jpg", photo, "image/jpeg")}))
        sid = uploaded["session_id"]
        session = _json(client.get(f"/api/sessions/{sid}"))
        ratio = session["original_image_width"] / original_size[0]
        assert ratio < 1, "fixture must exercise upload downscaling"
        confirmed_corners = uploaded["detected_corners"] if automatic_corners else [
            {"x": float(x * ratio), "y": float(y * ratio)} for x, y in corners
        ]
        assert confirmed_corners is not None and len(confirmed_corners) == 4
        _json(client.post(f"/api/sessions/{sid}/corners", json={
            "paper_size": paper_size,
            "corners": confirmed_corners,
        }))
        traced = _json(client.post(f"/api/sessions/{sid}/trace", json={"tracer": "replicate"}))
        assert provider_calls, "must exercise mask conversion, not the E2E polygon stub"
        assert len(traced["polygons"]) == 1
        saved = _json(client.post(f"/api/sessions/{sid}/save-tools", json={}))
        assert len(saved["tool_ids"]) == 1
        tid = saved["tool_ids"][0]
        tool = _json(client.get(f"/api/tools/{tid}"))
        assert _dimensions([(p["x"], p["y"]) for p in tool["points"]]) == pytest.approx([30, 80], abs=SIZE_TOLERANCE_MM)
        _json(client.put(f"/api/tools/{tid}", json={"smoothed": smoothed}))
        clearance = .3
        bin_data = _json(client.post("/api/bins", json={
            "tool_ids": [tid],
            "bin_config": {"height_units": 4, "cutout_depth": 10, "cutout_clearance": clearance,
                           "cutout_chamfer": 0, "stacking_lip": False, "magnets": False},
        }))
        bid = bin_data["id"]
        _json(client.post(f"/api/bins/{bid}/generate"))
        download = client.get(f"/api/files/bins/{bid}/bin.stl")
        assert download.status_code == 200, download.text
        mesh = trimesh.load(io.BytesIO(download.content), file_type="stl", force="mesh")
        assert mesh.is_watertight
        section = mesh.section(plane_origin=[0, 0, 27], plane_normal=[0, 0, 1])
        assert section is not None
        loops = section.discrete
        assert len(loops) == 2, "expected one outer boundary and one tool pocket"
        pocket = min(loops, key=lambda loop: np.prod(np.ptp(loop[:, :2], axis=0)))
        assert _dimensions(pocket[:, :2]) == pytest.approx([30 + 2 * clearance, 80 + 2 * clearance], abs=SIZE_TOLERANCE_MM)
        # Dimensions alone miss excessive corner rounding on a straight tool.
        outline = Polygon(pocket[:, :2])
        x0, y0, x1, y1 = outline.bounds
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        reference = box(cx - 40 - clearance, cy - 15 - clearance,
                        cx + 40 + clearance, cy + 15 + clearance)
        assert outline.hausdorff_distance(reference) < SIZE_TOLERANCE_MM
