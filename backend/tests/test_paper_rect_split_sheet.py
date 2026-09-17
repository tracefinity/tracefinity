"""Regression for #212 (part 2): a tool crossing the sheet splits the bright
paper region in two, and the saliency crop used to keep only the larger half,
discarding the tool with the other."""

import cv2
import numpy as np

from app.services.ai_tracer import AITracer

W, H = 1200, 1600
SHEET = (200, 350, 1000, 1450)  # x0, y0, x1, y1


def _scene() -> np.ndarray:
    img = np.full((H, W, 3), 30, np.uint8)
    cv2.rectangle(img, SHEET[:2], SHEET[2:], (245, 245, 245), -1)
    return img


def _covers_sheet(rect: tuple[int, int, int, int]) -> bool:
    x, y, w, h = rect
    # erosion pulls the rect ~20px inside the sheet; anything beyond that is a miss
    return x <= SHEET[0] + 30 and y <= SHEET[1] + 30 and x + w >= SHEET[2] - 30 and y + h >= SHEET[3] - 30


def test_rect_spans_sheet_split_by_a_tool():
    img = _scene()
    # dark bar wider than the closing kernel can bridge, top to bottom
    cv2.rectangle(img, (520, 100), (640, 1550), (40, 40, 40), -1)

    rect = AITracer._detect_paper_rect(img)

    assert rect is not None
    assert _covers_sheet(rect), rect


def test_rect_spans_sheet_split_sideways():
    img = _scene()
    cv2.rectangle(img, (100, 800), (1100, 930), (40, 40, 40), -1)

    rect = AITracer._detect_paper_rect(img)

    assert rect is not None
    assert _covers_sheet(rect), rect


def test_rect_ignores_bright_object_off_the_sheet_axis():
    img = _scene()
    # bright object diagonal to the sheet: shares neither axis span
    cv2.rectangle(img, (1050, 20), (1190, 200), (250, 250, 250), -1)

    x, y, w, h = AITracer._detect_paper_rect(img)

    assert x + w <= SHEET[2] + 5
    assert y >= SHEET[1] - 5


def test_rect_ignores_adjacent_lighter_surface_of_a_different_tone():
    img = _scene()
    # a pale wooden table beside the sheet, past the reach of the closing
    # kernel: bright and desaturated enough to pass the threshold, but
    # not the sheet's tone
    cv2.rectangle(img, (1090, 300), (1199, 1500), (170, 195, 210), -1)

    x, y, w, h = AITracer._detect_paper_rect(img)

    assert x + w <= SHEET[2] + 5, (x, y, w, h)


def test_rect_ignores_aligned_bright_object_far_from_sheet():
    img = _scene()
    # aligned with the sheet in x, but the gap is far wider than any tool
    cv2.rectangle(img, (300, 0), (700, 60), (250, 250, 250), -1)

    x, y, w, h = AITracer._detect_paper_rect(img)

    assert y >= SHEET[1] - 5
