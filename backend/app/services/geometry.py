"""pure geometry utilities (no I/O, no persistence)."""

from __future__ import annotations

import cv2
import numpy as np


def optimal_rotation_angle(points: list[tuple[float, float]]) -> float:
    """find the rotation angle (degrees) that minimises bounding box area.

    uses cv2.minAreaRect on the convex hull. returns the angle to apply
    to the current points so they sit in their minimum bounding rectangle
    axis-aligned.
    """
    if len(points) < 2:
        return 0.0

    pts = np.array(points, dtype=np.float32)

    if len(points) == 2:
        dx = pts[1][0] - pts[0][0]
        dy = pts[1][1] - pts[0][1]
        return -float(np.degrees(np.arctan2(dy, dx)))

    rect = cv2.minAreaRect(pts)
    # rect = ((cx, cy), (w, h), angle) where angle is in [-90, 0)
    angle = rect[2]
    w, h = rect[1]

    # to un-rotate points back to axis-aligned: negate the rect angle.
    # if w < h the longer side is vertical in the rect, subtract 90
    # so the longer side ends up horizontal after rotation.
    correction = -angle
    if w < h:
        correction -= 90

    return float(correction)
