import pytest
from pydantic import ValidationError

from app.constants import PAPER_SIZES
from app.models.schemas import CornersRequest, Session


def test_paper_sizes_include_larger_mapping_presets():
    assert PAPER_SIZES["a3"] == (297, 420)
    assert PAPER_SIZES["tabloid"] == (279.4, 431.8)


@pytest.mark.parametrize("paper_size", ["a4", "letter", "a3", "tabloid"])
def test_corners_request_accepts_supported_paper_sizes(paper_size):
    req = CornersRequest(
        paper_size=paper_size,
        corners=[
            {"x": 0, "y": 0},
            {"x": 100, "y": 0},
            {"x": 100, "y": 100},
            {"x": 0, "y": 100},
        ],
    )

    assert req.paper_size == paper_size


def test_session_accepts_tabloid_paper_size():
    session = Session(id="session-1", paper_size="tabloid")

    assert session.paper_size == "tabloid"


def test_corners_request_rejects_unknown_paper_size():
    with pytest.raises(ValidationError):
        CornersRequest(
            paper_size="legal",
            corners=[
                {"x": 0, "y": 0},
                {"x": 100, "y": 0},
                {"x": 100, "y": 100},
                {"x": 0, "y": 100},
            ],
        )
