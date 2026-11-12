"""Independent CAD readback of STEP files from the same solid as STL."""

import pytest

pytest.importorskip("build123d")

from build123d import import_step

from app.models.schemas import GenerateRequest, TextLabel
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from tests.geometry_support import render


@pytest.mark.parametrize("enabled", [False, True])
def test_step_export_preserves_pockets_and_side_opening_rules(tmp_path, enabled):
    config = GenerateRequest(
        grid_x=1, grid_y=2, height_units=2, cutout_depth=7, rim_units=1,
        magnets=False, allow_wall_cutouts=enabled,
    )
    outline = ScaledPolygon(
        "outline", [(12, 32), (48, 32), (48, 52), (12, 52)], "Outline",
        interior_rings_mm=[[(17, 37), (25, 37), (25, 47), (17, 47)]],
    )
    finger = ScaledPolygon(
        "finger", [(5, 61), (19, 61), (19, 73), (5, 73)], "Finger cutout",
        finger_holes=[ScaledFingerHole("relief", 4, 67, 7, "filleted_rectangle", 24, 10)],
    )
    path = tmp_path / "bin.step"
    render([outline, finger], config, path.with_suffix(".stl"))
    solid, = import_step(path).solids()

    assert solid.is_valid
    assert tuple(solid.bounding_box().size) == pytest.approx((41.5, 83.5, 25.4))
    assert solid.is_inside((0, 0, 8))  # material inside the traced ring
    assert not solid.is_inside((8, 0, 8))
    assert solid.is_inside((8, 0, 6.95))  # pocket floor

    for z in (13.8, 14.3, 21.3, 25.2):
        assert solid.is_inside((20.7, 0, z)) == (not enabled)
        assert solid.is_inside((-20.7, -25, z)) == (not enabled)
        assert solid.is_inside((20.7, 25, z))


def test_overlapping_chamfered_cutouts_open_the_wall_and_lip(tmp_path):
    config = GenerateRequest(
        grid_x=11, grid_y=1, height_units=4, cutout_depth=20, cutout_chamfer=2,
        stacking_lip=True, allow_wall_cutouts=True, magnets=False, bed_size=0,
    )
    tool = ScaledPolygon(
        "tool", [(228, 34), (234, 34), (234, 37), (228, 37)], "Tool",
        finger_holes=[
            ScaledFingerHole("outer", 171, 49, 9, "rectangle", 260, 18),
            ScaledFingerHole("inner", 221, 39, 10, "rectangle", 164, 20),
        ],
    )
    path = tmp_path / "bin.step"
    mesh, _ = render([tool], config, path.with_suffix(".stl"))
    solid, = import_step(path).solids()

    assert mesh.is_volume
    assert solid.is_valid
    assert solid.volume == pytest.approx(mesh.volume, rel=0.002)
    for x in (-100, 0, 71):
        assert solid.is_inside((x, -20.65, 7.9))
        for z in (8.1, 27, 28.3, 32.2):
            assert not solid.is_inside((x, -20.65, z))
    assert solid.is_inside((-200, -20.65, 32.2))


@pytest.mark.parametrize("enabled", [False, True])
def test_concave_chamfer_keeps_the_traced_rim_opening(tmp_path, enabled):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=4, cutout_depth=20, cutout_chamfer=2,
        stacking_lip=True, allow_wall_cutouts=enabled, magnets=False, bed_size=0,
    )
    tool = ScaledPolygon(
        "tool", [(6, -1), (14, -1), (14, 21), (28, 21), (28, -1), (36, -1), (36, 31), (6, 31)],
        "U-shaped tool",
    )
    path = tmp_path / "bin.step"
    mesh, _ = render([tool], config, path.with_suffix(".stl"))
    solid, = import_step(path).solids()

    assert mesh.is_volume
    assert solid.is_valid
    assert solid.volume == pytest.approx(mesh.volume, rel=0.002)
    for x in (-11, 11):
        assert solid.is_inside((x, 10, 7.9))
        assert not solid.is_inside((x, 10, 8.1))
        for z in (28.3, 32.2):
            assert solid.is_inside((x, 20.65, z)) == (not enabled)
    assert solid.is_inside((0, 10, 8.1))
    assert solid.is_inside((0, 20.65, 32.2))


@pytest.mark.parametrize("half_grid", [False, True])
def test_step_uses_same_fractional_and_half_grid_feet_as_stl(tmp_path, half_grid):
    config = GenerateRequest(
        grid_x=1.5, grid_y=2.5, height_units=2,
        half_grid_base=half_grid, magnets=False,
    )
    step_path = tmp_path / "grid.step"
    render([], config, step_path.with_suffix(".stl"))
    solid, = import_step(step_path).solids()
    from trimesh import load_mesh
    mesh = load_mesh(tmp_path / "grid.stl")
    assert solid.is_valid
    assert tuple(solid.bounding_box().size) == pytest.approx((62.5, 104.5, 18.4))
    assert solid.volume == pytest.approx(mesh.volume, rel=0.002)
    # Full-grid feet have material at the middle of the first cell. The
    # half-grid version has a gap there between its two smaller feet.
    assert solid.is_inside((-10.5, -31.5, 1.5)) == (not half_grid)


@pytest.mark.parametrize("connect,retain_wall", [(False, False), (True, False), (True, True)])
def test_step_partial_bins_retain_intended_solids_and_walls(tmp_path, connect, retain_wall):
    config = GenerateRequest(
        grid_x=3, grid_y=1, height_units=2, cutout_depth=6, magnets=False,
        partial_bins=True, partial_bins_values=[True, False, True],
        partial_bins_connect=connect, partial_bins_retain_wall=retain_wall,
    )
    step_path = tmp_path / "partial.step"
    render([], config, step_path.with_suffix(".stl"))
    assembly = import_step(step_path)
    solids = assembly.solids()
    assert all(solid.is_valid for solid in solids)
    from trimesh import load_mesh
    mesh = load_mesh(tmp_path / "partial.stl")
    assert len(solids) == len(mesh.split())
    assert any(solid.is_inside((0, 0, 6)) for solid in solids) == connect
    assert any(solid.is_inside((0, 20.6, 15)) for solid in solids) == retain_wall
    assert not any(solid.is_inside((0, 0, 13)) for solid in solids)


def test_step_chamfers_tool_outline_and_finger_hole(tmp_path):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=2, cutout_depth=7, cutout_chamfer=2,
                             magnets=False, stacking_lip=False)
    tool = ScaledPolygon(
        "tool", [(14, 16), (26, 16), (26, 26), (14, 26)], "Tool",
        finger_holes=[ScaledFingerHole("relief", 32, 29, 3, "cylinder")],
    )
    path = tmp_path / "chamfer.step"
    render([tool], config, path.with_suffix(".stl"))
    solid, = import_step(path).solids()
    assert solid.is_valid
    for x, y in [(6, 0), (15, -8)]:
        assert solid.is_inside((x, y, 11))
        assert not solid.is_inside((x, y, 13.7))
    assert solid.is_inside((0, 0, 6.95))


def test_step_insert_is_separate_and_preserves_fit(tmp_path):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=3, cutout_depth=6,
                             insert_enabled=True, insert_height=1.5, insert_clearance=0.5)
    tool = ScaledPolygon(
        "tool", [(8, 8), (28, 8), (28, 24), (8, 24)], "Tool",
        interior_rings_mm=[[(14, 13), (18, 13), (18, 17), (14, 17)]],
    )
    path = tmp_path / "insert.step"
    render([tool], config, tmp_path / "bin.stl")
    path = tmp_path / "bin_insert.step"
    insert, = import_step(path).solids()
    assert insert.is_valid
    assert tuple(insert.bounding_box().size) == pytest.approx((19, 15, 1.5), abs=0.04)
    assert not insert.is_inside((-5, 6, 0.5))
    assert insert.is_inside((-9, 10, 0.5))
    bin_solid = import_step(tmp_path / "bin.step")
    assert not bin_solid.is_inside((-9, 10, 14))  # extra 1.5 mm cutout depth
    assert bin_solid.is_inside((-9, 10, 13.4))


def test_step_text_is_recessed_and_embossed_on_the_printed_body(tmp_path):
    config = GenerateRequest(grid_x=1, grid_y=1, height_units=3, cutout_depth=7,
                             stacking_lip=False, magnets=False)
    tool = ScaledPolygon("tool", [(11, 11), (31, 11), (31, 31), (11, 31)], "Tool")
    render([tool], config, tmp_path / "original.stl")
    original = import_step(tmp_path / "original.step")
    config.text_labels = [
        TextLabel(id="recessed", text="I", x=21, y=21, font_size=5, depth=0.5, emboss=False),
        TextLabel(id="embossed", text="O", x=21, y=6, font_size=5, depth=0.6, emboss=True, rotation=20),
    ]
    path = tmp_path / "labels.step"
    render([tool], config, path.with_suffix(".stl"))
    body, = import_step(path).solids()
    assert body.is_valid
    assert not body.is_inside((0, 0, 13.8))  # recessed letter at the pocket floor
    assert original.is_inside((0, 0, 13.8))
    assert body.bounding_box().max.Z == pytest.approx(21.6)
    assert not body.is_inside((0, 15, 21.3))  # the O retains its interior ring


def test_trace_session_step_uses_generation_request(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api import routes
    from app.auth import get_user_id
    from app.models.schemas import Session
    from app.services.session_store import SessionStore

    sessions = SessionStore(tmp_path)
    sessions.set("test-session", Session(
        id="test-session", scale_factor=0.5,
        polygons=[{
            "id": "tool", "label": "Tool",
            "points": [{"x": x, "y": y} for x, y in [(20, 20), (56, 20), (56, 56), (20, 56)]],
        }],
    ))
    monkeypatch.setattr(routes, "get_stores", lambda _: (sessions, None, None))
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_user_path", lambda _: tmp_path)
    (tmp_path / "outputs").mkdir()
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.dependency_overrides[get_user_id] = lambda: "default"
    client = TestClient(app)
    request = {"grid_x": 1, "grid_y": 1, "height_units": 3, "magnets": False,
               "cutout_depth": 7, "insert_enabled": True, "insert_height": 1.5}
    for insert in (False, True):
        response = client.post(f"/api/sessions/test-session/export/step?insert={str(insert).lower()}", json=request)
        assert response.status_code == 200
        path = tmp_path / "result.step"
        path.write_bytes(response.content)
        solid, = import_step(path).solids()
        assert solid.is_valid
        assert solid.bounding_box().size.Z == pytest.approx(1.5 if insert else 25.4)
    assert (tmp_path / "outputs/test-session.stl").is_file()

    # Retention can remove one representation before the others. Regeneration
    # must restore it even while the corresponding STL and revision still exist.
    for filename, insert in [("test-session.step", False), ("test-session_insert.step", True)]:
        missing = tmp_path / "outputs" / filename
        original = missing.read_bytes()
        missing.unlink()
        response = client.post(f"/api/sessions/test-session/export/step?insert={str(insert).lower()}", json=request)
        assert response.status_code == 200
        assert response.content == original == missing.read_bytes()
