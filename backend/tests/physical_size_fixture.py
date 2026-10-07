"""Synthetic flat object and pixel-based inference shared by API/browser tests."""

import base64
import io

import cv2
import numpy as np
from PIL import Image


def synthetic_photo(paper_mm, landscape=False, exif_rotated=False):
    width_mm, height_mm = paper_mm
    if landscape:
        width_mm, height_mm = height_mm, width_mm
    px_per_mm = 8
    paper = np.full((round(height_mm * px_per_mm), round(width_mm * px_per_mm), 3), 255, np.uint8)
    left = (width_mm - 80) / 2 * px_per_mm
    top = (height_mm - 30) / 2 * px_per_mm
    cv2.rectangle(paper, (round(left), round(top)), (round(left + 80 * px_per_mm), round(top + 30 * px_per_mm)), (0, 0, 0), -1)
    photo_size = (3600, 2800) if landscape else (2800, 3600)
    w, h = photo_size
    corners = np.float32([(w * .12, h * .15), (w * .85, h * .08), (w * .91, h * .86), (w * .08, h * .91)])
    source = np.float32([(0, 0), (paper.shape[1], 0), (paper.shape[1], paper.shape[0]), (0, paper.shape[0])])
    transform = cv2.getPerspectiveTransform(source, corners)
    photo = Image.fromarray(cv2.warpPerspective(paper, transform, photo_size, borderValue=(100, 70, 40)))
    exif = Image.Exif()
    if exif_rotated:
        photo = photo.transpose(Image.Transpose.ROTATE_90)
        exif[274] = 6
    encoded = io.BytesIO()
    photo.save(encoded, format="JPEG", quality=98, exif=exif)
    return encoded.getvalue(), corners, photo_size


def rectangle_mask(data_uri):
    pixels = Image.open(io.BytesIO(base64.b64decode(data_uri.split(",", 1)[1])))
    gray = np.array(pixels.convert("L"))
    neutral = np.ptp(np.array(pixels.convert("RGB")), axis=2) < 20
    mask = Image.fromarray(np.uint8((gray < 127) & neutral) * 255)
    # Exercise provider output resizing, independently of image ingest resizing.
    mask = mask.resize((1024, 768), Image.Resampling.NEAREST)
    result = io.BytesIO()
    mask.save(result, format="PNG")
    return result.getvalue(), pixels.size
