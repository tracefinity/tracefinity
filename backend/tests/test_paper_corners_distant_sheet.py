"""Regression for #254: a sheet that is small in the frame is still the
salient object, but its mask is well under the frame share that marks a mask
as the sheet. The sheet was blacked out and the corners came back on the
outline of the mask. Unmasked, the brightness rectangle took in bright floor
beside the sheet while an accurate contour was never compared with it."""

from pathlib import Path

import cv2
import numpy as np

from app.services import image_processor as ip_module
from app.services.image_processor import ImageProcessor

PHOTO = Path(__file__).parent / "fixtures" / "paper-corners" / "distant-sheet.jpg"
# visible sheet corners, from lines fitted to each paper edge
SHEET = [(386, 586), (1043, 650), (997, 1111), (347, 1051)]
TOLERANCE_PX = 8


def _processor(mask: np.ndarray | None = None) -> ImageProcessor:
    ip = ImageProcessor.__new__(ImageProcessor)
    ip._tool_mask_session = None if mask is None else object()
    if mask is not None:
        ip._get_tool_mask = lambda _path: mask
    return ip


def _mask(quad) -> np.ndarray:
    mask = np.zeros((2048, 1536), np.uint8)
    cv2.fillPoly(mask, [np.asarray(quad, np.int32)], 255)
    return mask


def _max_error(corners) -> float:
    return float(np.linalg.norm(np.asarray(corners) - SHEET, axis=1).max())


def test_mask_of_a_small_sheet_does_not_move_the_corners():
    # the saliency mask takes the sheet for the object and spills past one edge
    spilled = [SHEET[0], (SHEET[1][0] + 21, SHEET[1][1]), (SHEET[2][0] + 45, SHEET[2][1]), SHEET[3]]
    mask = _mask(spilled)
    assert np.count_nonzero(mask) / mask.size < ip_module.TOOL_MASK_MAX_FRACTION

    corners = _processor(mask).detect_paper_corners(str(PHOTO))

    assert corners is not None
    assert _max_error(corners) <= TOLERANCE_PX, corners


def test_mask_of_a_tool_on_the_sheet_is_still_applied(monkeypatch):
    tool = _mask([(600, 760), (820, 780), (810, 930), (590, 910)])
    ip = _processor(tool)
    seen = []
    detect = ip._detect_paper
    monkeypatch.setattr(ip, "_detect_paper", lambda img: seen.append(img.copy()) or detect(img))

    corners = ip.detect_paper_corners(str(PHOTO))

    assert len(seen) == 1
    assert (seen[0][tool > 0] == 0).all()
    assert _max_error(corners) <= TOLERANCE_PX, corners


def test_corners_on_the_mask_are_kept_when_nothing_else_is_found(monkeypatch):
    ip = _processor(_mask(SHEET))
    on_mask = [(float(x), float(y)) for x, y in SHEET]
    results = iter([on_mask, None])
    monkeypatch.setattr(ip, "_detect_paper", lambda _img: next(results))

    assert ip.detect_paper_corners(str(PHOTO)) == on_mask


def test_boundary_on_the_sheet_edge_outscores_one_in_the_floor():
    ip = _processor()
    gray = cv2.GaussianBlur(cv2.cvtColor(cv2.imread(str(PHOTO)), cv2.COLOR_BGR2GRAY), (5, 5), 0)
    widened = [(x + dx, y + dy) for (x, y), (dx, dy) in zip(SHEET, [(-30, -8), (60, 3), (58, 36), (-37, 25)])]

    assert ip._edge_support(gray, SHEET) > 0.9
    assert ip._edge_support(gray, widened) < 0.5
