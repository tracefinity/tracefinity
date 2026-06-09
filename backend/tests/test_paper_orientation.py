"""Paper orientation must survive perspective foreshortening.

A portrait sheet photographed at a steep tilt can project with its top edge
longer than its left edge in pixels; naive edge comparison then warps it as
landscape, a 1.414x anisotropic scale error. Orientation is picked by which
assignment yields the more isotropic homography at the quad centre.
"""
import math

import numpy as np
import pytest

from app.services.image_processor import pick_paper_orientation


def _rot_x(deg: float) -> np.ndarray:
    t = math.radians(deg)
    return np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])


def _rot_y(deg: float) -> np.ndarray:
    t = math.radians(deg)
    return np.array([[math.cos(t), 0, math.sin(t)], [0, 1, 0], [-math.sin(t), 0, math.cos(t)]])


def _rot_z(deg: float) -> np.ndarray:
    t = math.radians(deg)
    return np.array([[math.cos(t), -math.sin(t), 0], [math.sin(t), math.cos(t), 0], [0, 0, 1]])


def _project_paper(width_mm: float, height_mm: float, tilt_deg: float,
                   distance: float = 420.0, focal: float = 800.0,
                   yaw_deg: float = 8.0, roll_deg: float = 6.0):
    """corners of a width x height sheet photographed at tilt_deg from overhead.

    small yaw/roll mimic a hand-held shot; a mathematically pure single-axis
    tilt keeps one edge pair exactly parallel, which no real photo does."""
    corners = np.array([
        [-width_mm / 2, -height_mm / 2, 0],
        [width_mm / 2, -height_mm / 2, 0],
        [width_mm / 2, height_mm / 2, 0],
        [-width_mm / 2, height_mm / 2, 0],
    ], dtype=np.float64)
    rot = _rot_z(roll_deg) @ _rot_y(yaw_deg) @ _rot_x(tilt_deg)
    src = []
    for p in corners:
        q = rot @ p + np.array([0, 0, distance])
        src.append((focal * q[0] / q[2] + 320, focal * q[1] / q[2] + 240))
    return src


PRINCIPAL = (320.0, 240.0)  # image centre used by _project_paper


class TestPickPaperOrientation:
    def test_portrait_overhead(self):
        src = _project_paper(210, 297, tilt_deg=5)
        assert pick_paper_orientation(src, 210, 297, PRINCIPAL) == (210, 297)

    def test_landscape_overhead(self):
        src = _project_paper(297, 210, tilt_deg=5)
        assert pick_paper_orientation(src, 210, 297, PRINCIPAL) == (297, 210)

    def test_portrait_steep_tilt_not_flipped(self):
        # at 55 degrees the top edge projects longer than the left edge;
        # the old px-edge comparison flipped this to landscape
        src = _project_paper(210, 297, tilt_deg=55)
        top = math.dist(src[0], src[1])
        left = math.dist(src[0], src[3])
        assert top > left, "precondition: foreshortening must defeat edge compare"
        assert pick_paper_orientation(src, 210, 297, PRINCIPAL) == (210, 297)

    def test_landscape_steep_tilt(self):
        src = _project_paper(297, 210, tilt_deg=50)
        assert pick_paper_orientation(src, 210, 297, PRINCIPAL) == (297, 210)

    def test_letter_portrait_moderate_tilt(self):
        src = _project_paper(215.9, 279.4, tilt_deg=40)
        assert pick_paper_orientation(src, 215.9, 279.4, PRINCIPAL) == (215.9, 279.4)

    def test_defaults_to_quad_centroid_when_no_principal_point(self):
        # moderate tilt: centroid approximation must still pick correctly
        src = _project_paper(210, 297, tilt_deg=30)
        assert pick_paper_orientation(src, 210, 297) == (210, 297)
