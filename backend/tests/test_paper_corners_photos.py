"""Real paper boundaries must survive shadows and bright wooden backgrounds."""

from pathlib import Path

import cv2
import numpy as np
import pytest

from app.services.image_processor import ImageProcessor


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("bevel-square.jpg", [(245, 423), (1176, 405), (1246, 1808), (185, 1807)]),
        ("rafter-square.jpg", [(305, 271), (1259, 263), (1290, 1626), (306, 1633)]),
        ("shadowed-pliers.jpg", [(222, 472), (1191, 429), (1254, 1807), (273, 1842)]),
        ("line-level.jpg", [(181, 266), (1265, 255), (1293, 1794), (189, 1807)]),
    ],
)
def test_detected_corners_follow_the_visible_sheet(filename, expected):
    processor = ImageProcessor.__new__(ImageProcessor)
    processor._tool_mask_session = None
    photo = Path(__file__).parent / "fixtures" / "paper-corners" / filename

    actual = processor.detect_paper_corners(str(photo))

    assert actual is not None
    # Manually annotated visible corners; allow raster/annotation uncertainty,
    # but not the tens-to-hundreds of pixels lost to the brightness threshold.
    errors = np.linalg.norm(np.asarray(actual) - expected, axis=1)
    assert max(errors) <= 8, (filename, actual, errors.tolist())


def test_dark_rectangular_tool_does_not_replace_low_contrast_paper():
    photo = np.full((1600, 1200, 3), 175, np.uint8)
    cv2.rectangle(photo, (150, 200), (1050, 1400), (215, 215, 215), -1)
    cv2.rectangle(photo, (350, 450), (750, 1150), (20, 20, 20), -1)
    processor = ImageProcessor.__new__(ImageProcessor)

    actual = processor._detect_paper(photo)

    expected = [(150, 200), (1050, 200), (1050, 1400), (150, 1400)]
    assert actual is not None
    assert np.max(np.linalg.norm(np.asarray(actual) - expected, axis=1)) <= 8


def test_dim_paper_can_still_be_detected_from_its_edges():
    path = Path(__file__).parent / "fixtures" / "paper-corners" / "shadowed-pliers.jpg"
    photo = (cv2.imread(str(path)) * 0.75).astype(np.uint8)
    processor = ImageProcessor.__new__(ImageProcessor)

    actual = processor._detect_paper(photo)

    expected = [(222, 472), (1191, 429), (1254, 1807), (273, 1842)]
    assert actual is not None
    assert np.max(np.linalg.norm(np.asarray(actual) - expected, axis=1)) <= 8
