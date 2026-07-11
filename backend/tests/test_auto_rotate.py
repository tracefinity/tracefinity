"""Tests for auto-rotate optimal angle computation."""

import math

import pytest

from app.services.geometry import optimal_rotation_angle


def test_axis_aligned_rectangle_needs_no_rotation():
    # already aligned -- angle should be 0 (or equivalent)
    pts = [(0, 0), (10, 0), (10, 5), (0, 5)]
    angle = optimal_rotation_angle(pts)
    assert abs(angle) < 1.0, f"expected ~0, got {angle}"


def test_tilted_rectangle_returns_corrective_angle():
    # rectangle tilted 30 degrees: minAreaRect should find ~30 or ~-60
    rad = math.radians(30)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    base = [(0, 0), (20, 0), (20, 5), (0, 5)]
    tilted = [(x * cos_r - y * sin_r, x * sin_r + y * cos_r) for x, y in base]
    angle = optimal_rotation_angle(tilted)
    # after applying this rotation, the bounding box should be minimal
    rotated = _apply_rotation(tilted, angle)
    bb_area = _bbox_area(rotated)
    # original bbox is 20 * 5 = 100
    assert bb_area < 110, f"bbox area {bb_area} too large after rotation"


def test_square_returns_near_zero():
    # square is symmetric, any axis-aligned rotation is optimal
    pts = [(0, 0), (10, 0), (10, 10), (0, 10)]
    angle = optimal_rotation_angle(pts)
    # for a square, 0, 90, -90 are all valid
    assert abs(angle % 90) < 1.0 or abs(abs(angle) - 90) < 1.0


def test_complex_polygon_reduces_bounding_box():
    # L-shape tilted 45 degrees -- rotation should reduce bbox
    rad = math.radians(45)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    l_shape = [(0, 0), (20, 0), (20, 10), (10, 10), (10, 20), (0, 20)]
    tilted = [(x * cos_r - y * sin_r, x * sin_r + y * cos_r) for x, y in l_shape]

    original_area = _bbox_area(tilted)
    angle = optimal_rotation_angle(tilted)
    rotated = _apply_rotation(tilted, angle)
    rotated_area = _bbox_area(rotated)

    assert rotated_area <= original_area + 0.1


def test_degenerate_two_points():
    pts = [(0, 0), (10, 5)]
    angle = optimal_rotation_angle(pts)
    # line from (0,0) to (10,5) is ~26.57deg from horizontal; rotation should align it
    assert angle == pytest.approx(-26.57, abs=1)


def test_single_point_returns_zero():
    pts = [(5, 5)]
    angle = optimal_rotation_angle(pts)
    assert angle == 0.0


def test_collinear_points():
    pts = [(0, 0), (5, 5), (10, 10)]
    angle = optimal_rotation_angle(pts)
    assert isinstance(angle, float)


def _apply_rotation(pts, angle_deg):
    rad = math.radians(angle_deg)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    return [(x * cos_r - y * sin_r, x * sin_r + y * cos_r) for x, y in pts]


def _bbox_area(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))
