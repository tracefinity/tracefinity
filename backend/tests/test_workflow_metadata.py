"""Compatibility tests for workflow planning metadata fields."""

from app.models.schemas import BinModel, BinUpdateRequest, CreateBinRequest, Tool, ToolUpdateRequest


def test_old_tool_records_get_metadata_defaults():
    tool = Tool.model_validate({
        "id": "tool-1",
        "name": "pliers",
        "points": [
            {"x": 0, "y": 0},
            {"x": 10, "y": 0},
            {"x": 10, "y": 10},
            {"x": 0, "y": 10},
        ],
        "finger_holes": [],
        "interior_rings": [],
    })

    assert tool.category is None
    assert tool.drawer is None
    assert tool.tags == []
    assert tool.project_ids == []
    assert tool.review_status is None
    assert tool.needs_cleanup is False


def test_tool_metadata_round_trips():
    tool = Tool.model_validate({
        "id": "tool-1",
        "name": "pliers",
        "points": [
            {"x": 0, "y": 0},
            {"x": 10, "y": 0},
            {"x": 10, "y": 10},
            {"x": 0, "y": 10},
        ],
        "category": "hand tools",
        "drawer": "drawer 1",
        "tags": ["cutting", "metal"],
        "project_ids": ["project-1"],
        "review_status": "reviewed",
        "needs_cleanup": True,
    })

    data = tool.model_dump()

    assert data["category"] == "hand tools"
    assert data["drawer"] == "drawer 1"
    assert data["tags"] == ["cutting", "metal"]
    assert data["project_ids"] == ["project-1"]
    assert data["review_status"] == "reviewed"
    assert data["needs_cleanup"] is True


def test_old_bin_records_get_project_default():
    bin_data = BinModel.model_validate({
        "id": "bin-1",
        "name": "drawer 1 bin",
        "placed_tools": [],
        "text_labels": [],
    })

    assert bin_data.project_id is None


def test_bin_project_id_round_trips():
    bin_data = BinModel.model_validate({
        "id": "bin-1",
        "name": "drawer 1 bin",
        "project_id": "project-1",
        "placed_tools": [],
        "text_labels": [],
    })

    assert bin_data.model_dump()["project_id"] == "project-1"


def test_create_bin_request_accepts_project_id():
    req = CreateBinRequest(name="drawer bin", project_id="project-1", tool_ids=["tool-1"])

    assert req.project_id == "project-1"
    assert req.tool_ids == ["tool-1"]


def test_bin_update_request_can_clear_project_id():
    req = BinUpdateRequest(project_id=None)

    assert "project_id" in req.model_fields_set
    assert req.project_id is None


def test_bin_update_request_distinguishes_absent_project_id():
    req = BinUpdateRequest()

    assert "project_id" not in req.model_fields_set


def test_tool_update_request_can_clear_nullable_metadata():
    req = ToolUpdateRequest(category=None, drawer=None, review_status=None)

    assert "category" in req.model_fields_set
    assert "drawer" in req.model_fields_set
    assert "review_status" in req.model_fields_set
    assert req.category is None
    assert req.drawer is None
    assert req.review_status is None


def test_tool_update_request_distinguishes_absent_metadata():
    req = ToolUpdateRequest()

    assert "category" not in req.model_fields_set
    assert "drawer" not in req.model_fields_set
    assert "review_status" not in req.model_fields_set
