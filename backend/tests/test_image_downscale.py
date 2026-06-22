from io import BytesIO

from PIL import Image

from app.api.routes import MAX_UPLOAD_DIM
from app.services.image_ingest import ingest_image


def _png_bytes(size: tuple[int, int]) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, color=(32, 64, 96)).save(buf, format="PNG")
    return buf.getvalue()


def test_downscale_returns_actual_integer_resize_ratio():
    original_width = 6041
    content, _, ratio = ingest_image(_png_bytes((original_width, 10)), ".png", MAX_UPLOAD_DIM)
    resized = Image.open(BytesIO(content))

    assert resized.width == MAX_UPLOAD_DIM
    assert ratio == resized.width / original_width
