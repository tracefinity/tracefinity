"""pre-trace photo quality checks.

flags photo problems that degrade trace accuracy before the user invests in
tracing and printing. all checks are advisory and degrade to a no-op when
their inputs are unavailable (e.g. EXIF stripped).
"""
from __future__ import annotations

import io
import logging
import math

from PIL import ExifTags, Image

from app.constants import PAPER_SIZES, PaperSize
from app.models.schemas import CaptureCrop, PhotoWarning

logger = logging.getLogger(__name__)

# 36x24mm full-frame diagonal; FocalLengthIn35mmFilm is defined against it
FULL_FRAME_DIAG_MM = math.hypot(36.0, 24.0)

# below this height a 15mm-thick tool traces >~3.5% oversized (H/(H-t))
MIN_CAMERA_HEIGHT_MM = 450.0
REFERENCE_TOOL_THICKNESS_MM = 15.0

# corners this close to (or beyond) the image edge suggest the paper is cut off
EDGE_MARGIN_PX = 2.0

# opposite-side length ratio above this indicates a strong keystone
MAX_OPPOSITE_SIDE_RATIO = 1.35

# exif and file pixel sizes further apart than this mean the photo was edited
EXIF_SIZE_TOLERANCE = 0.01

Corners = list[tuple[float, float]]


def _is_camera_frame(size: tuple[int, int], exif_ifd: dict) -> bool:
    """false when exif records a different pixel size than the file has.

    a photo cropped or resized after capture keeps its focal length, which
    still describes the frame the camera took, not what is left of it."""
    try:
        recorded = sorted((
            float(exif_ifd[ExifTags.Base.ExifImageWidth]),
            float(exif_ifd[ExifTags.Base.ExifImageHeight]),
        ))
    except (KeyError, TypeError, ValueError):
        return True
    if not all(math.isfinite(side) and side > 0 for side in recorded):
        return True
    # sorted: exif may record the size before or after rotation
    return all(
        abs(actual - side) <= side * EXIF_SIZE_TOLERANCE
        for actual, side in zip(sorted(size), recorded)
    )


def extract_focal_length_35mm(content: bytes) -> float | None:
    """read FocalLengthIn35mmFilm from image bytes; None when absent, or when
    the file is no longer the frame the camera took."""
    try:
        img = Image.open(io.BytesIO(content))
        exif = img.getexif()
        exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
        value = exif_ifd.get(ExifTags.Base.FocalLengthIn35mmFilm)
        if value is None:
            value = exif.get(ExifTags.Base.FocalLengthIn35mmFilm)
        if value is None:
            return None
        focal = float(value)
        # crafted exif can yield inf/nan; keep those out of sessions.json
        if not math.isfinite(focal) or focal <= 0:
            return None
        if not _is_camera_frame(img.size, exif_ifd):
            logger.info("exif pixel size differs from the image; skipping the camera distance check")
            return None
        return focal
    except Exception:
        return None


def estimate_camera_height_mm(
    corners: Corners,
    image_w: float,
    image_h: float,
    paper_size: PaperSize,
    focal_length_35mm: float | None,
) -> float | None:
    """estimate camera-to-paper distance from the projected paper diagonal.

    pinhole model against the 35mm-equivalent frame: the image diagonal maps
    to the full-frame diagonal, so the paper's pixel diagonal gives its size
    on the virtual sensor and D = f35 * real / projected. image_w and image_h
    must be the whole frame the camera took.
    """
    if not focal_length_35mm or focal_length_35mm <= 0 or len(corners) != 4:
        return None
    tl, tr, br, bl = corners
    paper_diag_px = (math.dist(tl, br) + math.dist(tr, bl)) / 2
    image_diag_px = math.hypot(image_w, image_h)
    if paper_diag_px < 1.0 or image_diag_px <= 0:
        return None
    paper_w_mm, paper_h_mm = PAPER_SIZES[paper_size]
    paper_diag_mm = math.hypot(paper_w_mm, paper_h_mm)
    sensor_diag_mm = paper_diag_px * FULL_FRAME_DIAG_MM / image_diag_px
    return focal_length_35mm * paper_diag_mm / sensor_diag_mm


def _check_camera_height(
    corners: Corners,
    image_w: float,
    image_h: float,
    paper_size: PaperSize,
    focal_length_35mm: float | None,
) -> PhotoWarning | None:
    height = estimate_camera_height_mm(corners, image_w, image_h, paper_size, focal_length_35mm)
    if height is None or height >= MIN_CAMERA_HEIGHT_MM:
        return None
    height_cm = round(height / 10)
    if height > REFERENCE_TOOL_THICKNESS_MM * 2:
        oversize_pct = (height / (height - REFERENCE_TOOL_THICKNESS_MM) - 1) * 100
        detail = f"a 15 mm-thick tool would trace roughly {oversize_pct:.1f}% oversized"
    else:
        detail = "thick tools will trace well oversized"
    return PhotoWarning(
        code="camera_too_close",
        message=(
            f"Camera looks about {height_cm} cm from the paper; {detail}. "
            "Retake from 60 cm or higher for best accuracy."
        ),
    )


def _check_paper_in_frame(corners: Corners, image_w: float, image_h: float) -> PhotoWarning | None:
    for x, y in corners:
        if (
            x <= EDGE_MARGIN_PX
            or y <= EDGE_MARGIN_PX
            or x >= image_w - EDGE_MARGIN_PX
            or y >= image_h - EDGE_MARGIN_PX
        ):
            return PhotoWarning(
                code="paper_out_of_frame",
                message=(
                    "The paper looks cut off at the photo edge. Keep all four "
                    "corners inside the frame or scale accuracy may suffer."
                ),
            )
    return None


def _check_perspective(corners: Corners) -> PhotoWarning | None:
    if len(corners) != 4:
        return None
    tl, tr, br, bl = corners
    top = math.dist(tl, tr)
    bottom = math.dist(bl, br)
    left = math.dist(tl, bl)
    right = math.dist(tr, br)
    if min(top, bottom, left, right) < 1.0:
        return None
    ratio = max(
        max(top, bottom) / min(top, bottom),
        max(left, right) / min(left, right),
    )
    if ratio <= MAX_OPPOSITE_SIDE_RATIO:
        return None
    return PhotoWarning(
        code="extreme_perspective",
        message=(
            "Strong camera angle detected. Shoot from directly above the "
            "paper for the most accurate outlines."
        ),
    )


def check_photo(
    corners: Corners,
    image_w: float,
    image_h: float,
    paper_size: PaperSize,
    focal_length_35mm: float | None,
    capture_crop: CaptureCrop | None = None,
) -> list[PhotoWarning]:
    """run all photo checks; each degrades to a no-op if it cannot run.
    capture_crop is the part of the camera's frame the image kept, if not all."""
    # the height estimate needs the whole frame, not the kept part of it
    frame_w, frame_h = image_w, image_h
    if capture_crop is not None:
        frame_w, frame_h = image_w / capture_crop.width, image_h / capture_crop.height

    warnings: list[PhotoWarning] = []
    for check in (
        lambda: _check_camera_height(corners, frame_w, frame_h, paper_size, focal_length_35mm),
        lambda: _check_paper_in_frame(corners, image_w, image_h),
        lambda: _check_perspective(corners),
    ):
        try:
            warning = check()
        except Exception:
            logger.exception("photo check failed")
            continue
        if warning:
            warnings.append(warning)
    return warnings
