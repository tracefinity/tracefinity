"""image ingest: HEIC conversion, EXIF orientation normalisation, downscaling.

cv2 ignores EXIF orientation, browsers apply it. orientation must be baked
into the pixels at ingest or corner coordinates from the UI land in a
different frame than the backend processes.
"""
from __future__ import annotations

import io
import logging

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

HEIC_EXTENSIONS = {".heic", ".heif"}
_ORIENTATION_TAG = 0x0112

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass


def ingest_image(content: bytes, ext: str, max_dim: int | None = None) -> tuple[bytes, str, float]:
    """normalise an uploaded image. returns (bytes, ext, downscale_ratio).

    HEIC becomes JPEG, EXIF orientation is applied to the pixels and the tag
    dropped, and the long edge is capped at max_dim. ratio is <1 when shrunk;
    the long edge lands exactly on max_dim so the ratio is exact for it and
    within half a pixel for the short edge (dimensions are rounded)."""
    img = Image.open(io.BytesIO(content))
    changed = False
    new_ext = ext.lower()

    if new_ext in HEIC_EXTENSIONS:
        new_ext = ".jpg"
        changed = True

    if img.getexif().get(_ORIENTATION_TAG, 1) != 1:
        img = ImageOps.exif_transpose(img)
        changed = True

    ratio = 1.0
    w, h = img.size
    if max_dim and max(w, h) > max_dim:
        ratio = max_dim / max(w, h)
        new_w, new_h = round(w * ratio), round(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        logger.info("downscaled image %dx%d -> %dx%d", w, h, new_w, new_h)
        changed = True

    if not changed:
        return content, new_ext, ratio

    buf = io.BytesIO()
    if new_ext in (".jpg", ".jpeg"):
        img.convert("RGB").save(buf, format="JPEG", quality=90)
    else:
        new_ext = ".png"
        img.save(buf, format="PNG")
    return buf.getvalue(), new_ext, ratio
