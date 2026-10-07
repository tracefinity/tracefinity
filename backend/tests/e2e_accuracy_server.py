"""Isolated browser-test server; only model inference is substituted.

No fixed polygons or scale factors: the substitute segments the actual image
submitted to the provider. Everything from upload through STL export is real.
"""

import os
import tempfile
from unittest.mock import patch

from fastapi.responses import Response

from tests.physical_size_fixture import rectangle_mask, synthetic_photo

storage = tempfile.TemporaryDirectory(prefix="tracefinity-physical-e2e-")
os.environ.update(
    STORAGE_PATH=storage.name,
    DEVELOPMENT_MODE="1",
    AUTH_MODE="open",
    TRACERS="replicate",
    REPLICATE_API_TOKEN="synthetic-fixture-only",
    TOOL_LABEL_PROVIDER="none",
)
os.environ.pop("E2E_TEST_MODE", None)

from app.services.image_processor import ImageProcessor

with patch.object(ImageProcessor, "__init__", lambda self: setattr(self, "_tool_mask_session", None)):
    from app.main import app

import app.services.remote_saliency as remote


async def infer_rectangle(client, config, data_uri):
    return rectangle_mask(data_uri)[0]


remote._via_replicate = infer_rectangle


@app.get("/__accuracy/photo.jpg")
def photo():
    content, _, _ = synthetic_photo((210, 297))
    return Response(content, media_type="image/jpeg")
