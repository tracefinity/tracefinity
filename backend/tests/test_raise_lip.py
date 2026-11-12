from pathlib import Path

from app.models.schemas import GenerateRequest
from tests.geometry_support import render


def test_raise_lip_is_ignored_when_stacking_lip_disabled(tmp_path: Path):
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        rim_units=0,
        bed_size=0,
    )

    standard_body, _ = render([], config, str(tmp_path / "standard.stl"))
    stale_rim_body, _ = render([], config.model_copy(update={"rim_units": 3}), str(tmp_path / "stale_rim.stl"))

    assert stale_rim_body.volume == standard_body.volume
