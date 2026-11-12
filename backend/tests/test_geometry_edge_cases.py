"""Exercise contacts and combinations that can create non-printable seams."""

import pytest
import trimesh
from shapely.geometry import Point, Polygon

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import PolygonScaler, ScaledFingerHole, ScaledPolygon
from tests.geometry_support import render, rings_at


def has_material(mesh, x, y, z):
    point = Point(x, y)
    return sum(Polygon(ring[:, :2]).covers(point) for ring in rings_at(mesh, z)) % 2 == 1


@pytest.mark.parametrize("offset", [-0.01, -0.0001, 0, 0.0001, 0.01])
@pytest.mark.parametrize("wall_open", [False, True])
def test_cylinder_at_a_tool_pocket_contact(tmp_path, offset, wall_open):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10,
        cutout_clearance=0, stacking_lip=True, magnets=False,
        allow_wall_cutouts=wall_open, bed_size=0,
    )
    if wall_open:
        x = 21 + offset
        outline = [(6, 15), (16, 15), (16, 27), (6, 27)]
        sample = (-10, 0)
    else:
        x = 6.85 + offset
        outline = [(6, 26), (18, 26), (18, 34), (6, 34)]
        sample = (-9, -8)
    finger = ScaledFingerHole("round", x, 21, 5, "cylinder")
    tool = ScaledPolygon("tool", outline, "Tool", finger_holes=[finger])
    mesh, _ = render([tool], config, tmp_path / "bin.stl")

    assert mesh.is_volume
    assert has_material(mesh, x - 21, 0, 10.9)
    assert not has_material(mesh, x - 21, 0, 11.1)
    assert not has_material(mesh, *sample, 11.1)
    assert has_material(mesh, 16, 12, 18)


@pytest.mark.parametrize("mode", ["cut", "connect", "retain"])
@pytest.mark.parametrize("mask", [[True, False, False, True], [False, True, True, False]])
def test_diagonal_partial_bin_has_printable_cell_boundaries(tmp_path, mode, mask):
    config = GenerateRequest(
        grid_x=2, grid_y=1.5, height_units=3, cutout_depth=9,
        cutout_chamfer=1.5, stacking_lip=True, magnets=False, bed_size=0,
        partial_bins=True, partial_bins_values=mask, partial_bins_connect=mode != "cut",
        partial_bins_retain_wall=mode == "retain",
    )
    tool = ScaledPolygon("crossing", [(12, 12), (67, 18), (60, 50), (19, 47)], "Tool")
    mesh, paths = render([tool], config, tmp_path / "partial.stl")

    assert mesh.is_volume
    if mode == "cut":
        assert len(mesh.split()) == len(paths) == 2
        pieces = [trimesh.load_mesh(path) for path in paths]
        assert all(piece.is_volume for piece in pieces)
        assert sum(piece.volume for piece in pieces) == pytest.approx(mesh.volume)
    else:
        assert len(mesh.split()) == 1
        assert paths == []


@pytest.mark.parametrize("shape", ["circle", "cylinder", "square", "rectangle", "filleted_rectangle"])
def test_rotated_corner_cutter_with_a_raised_lip(tmp_path, shape):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10, cutout_chamfer=2,
        rim_units=2, stacking_lip=True, allow_wall_cutouts=True, magnets=False, bed_size=0,
    )
    finger = ScaledFingerHole("corner", 3, 4, 8, shape, 16, 24, 33, depth_override=13)
    tool = ScaledPolygon(
        "corner", [(2, 3), (22, 3), (22, 8), (10, 8), (10, 17), (22, 17), (22, 22), (2, 22)],
        "Corner tool", finger_holes=[finger],
    )
    mesh, _ = render([tool], config, tmp_path / "corner.stl")

    assert mesh.is_volume
    assert mesh.bounds[1, 2] == pytest.approx(39.4, abs=0.01)
    assert has_material(mesh, -20.65, 16, 7.9)
    assert not has_material(mesh, -20.65, 16, 35.2)
    assert has_material(mesh, 20.65, 10, 35.2)


@pytest.mark.parametrize("shape", ["rectangle", "filleted_rectangle"])
def test_finger_rotation_follows_the_layout_coordinate_system(tmp_path, shape):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10,
        cutout_clearance=0, stacking_lip=False, magnets=False, bed_size=0,
    )
    finger = ScaledFingerHole("rotated", 21, 21, 8, shape, 16, 6, 30)
    tool = ScaledPolygon("tool", [(6, 6), (12, 6), (12, 12), (6, 12)], "Tool", [finger])
    mesh, _ = render([tool], config, tmp_path / "rotated.stl")

    # The right-hand end of the cutter points down in the layout and toward -Y in CAD.
    assert not has_material(mesh, 5, -3, 19)
    assert has_material(mesh, 5, 3, 19)


def test_ring_pocket_retains_a_wide_island_next_to_a_cylinder(tmp_path):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10, cutout_clearance=0,
        stacking_lip=True, magnets=False, bed_size=0,
    )
    tool = ScaledPolygon(
        "ring", [(5, 5), (37, 5), (37, 37), (5, 37)], "Ring",
        finger_holes=[ScaledFingerHole("access", 19, 21, 7, "cylinder")],
        interior_rings_mm=[[(12, 12), (30, 12), (30, 30), (12, 30)]],
    )
    mesh, _ = render([tool], config, tmp_path / "ring.stl")

    assert mesh.is_volume
    assert has_material(mesh, 7.5, 0, 20)
    assert has_material(mesh, 0, 0, 10.9)
    assert not has_material(mesh, 0, 0, 11.1)
    assert not has_material(mesh, 13, 0, 11.1)


def test_duplicate_trace_vertices_preserve_the_pocket(tmp_path):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10, cutout_clearance=0,
        cutout_chamfer=2, stacking_lip=True, magnets=False, bed_size=0,
    )
    outline = [(4, 4), (22, 4), (22, 16), (12, 17), (4, 16)]
    plain = ScaledPolygon("plain", outline, "Tool")
    repeated = ScaledPolygon("repeated", [outline[0], *outline, outline[-1], outline[0]], "Tool")
    expected, _ = render([plain], config, tmp_path / "plain.stl")
    actual, _ = render([repeated], config, tmp_path / "repeated.stl")

    assert actual.is_volume
    assert actual.volume == pytest.approx(expected.volume)


@pytest.mark.parametrize("chamfer", [0, 2])
def test_pockets_touching_at_a_corner_keep_printable_inserts(tmp_path, chamfer):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10, cutout_clearance=0,
        cutout_chamfer=chamfer, stacking_lip=True, magnets=False, bed_size=0,
        insert_enabled=True, insert_clearance=0,
    )
    tools = [
        ScaledPolygon("first", [(7, 7), (20, 7), (20, 20), (7, 20)], "First"),
        ScaledPolygon("second", [(20, 20), (34, 20), (34, 34), (20, 34)], "Second"),
    ]
    mesh, _ = render(tools, config, tmp_path / "bin.stl")
    insert = trimesh.load_mesh(tmp_path / "bin_insert.stl")

    assert mesh.is_volume
    assert not has_material(mesh, -1, 1, 12)
    assert has_material(mesh, -1, 1, 9.9)
    assert insert.is_volume
    assert len(insert.split()) == 2
    assert insert.volume == pytest.approx(13**2 + 14**2, rel=0.002)


def test_tool_and_finger_cutout_fully_off_bin_leave_geometry_intact(tmp_path):
    config = GenerateRequest(
        grid_x=1.5, grid_y=1, height_units=1, cutout_depth=200,
        cutout_chamfer=5, cutout_clearance=0, half_grid_base=True,
        stacking_lip=True, allow_wall_cutouts=True, bed_size=0,
    )
    inside = ScaledPolygon("inside", [(20, 15), (43, 15), (43, 27), (20, 27)], "Inside")
    outside = ScaledPolygon(
        "outside", [(77, -15), (99, -15), (99, 11), (77, 11)], "Outside",
        finger_holes=[ScaledFingerHole("round", 81, 0, 7, "circle")],
    )
    expected, _ = render([inside], config, tmp_path / "inside.stl")
    actual, _ = render([inside, outside], config, tmp_path / "outside.stl")

    assert actual.is_volume
    assert actual.volume == pytest.approx(expected.volume)
    assert has_material(actual, 0, 0, 6.74)
    assert not has_material(actual, 0, 0, 6.76)


@pytest.mark.parametrize("offset", [-0.0001, 0.0001])
def test_nearly_coincident_rotations_keep_both_cutout_depths(tmp_path, offset):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10, cutout_clearance=0,
        cutout_chamfer=2, stacking_lip=True, rim_units=1, magnets=False, bed_size=0,
        allow_wall_cutouts=True,
    )
    tool = ScaledPolygon(
        "tool", [(4, 4), (22, 4), (22, 16), (12, 17), (4, 16)], "Tool",
        finger_holes=[
            ScaledFingerHole("shallow", 6, 15, 7, "rectangle", 14, 27, 45 + offset, 12),
            ScaledFingerHole("deep", 6, 15, 7, "filleted_rectangle", 14, 27, 45 - offset, 15),
        ],
    )
    mesh, _ = render([tool], config, tmp_path / "rotation.stl")

    assert mesh.is_volume
    assert has_material(mesh, -15, 6, 6.74)
    assert not has_material(mesh, -15, 6, 6.76)
    assert has_material(mesh, 12, 0, 10)


@pytest.mark.parametrize("outline", [
    [(4, 4), (4, 4), (22, 4), (22, 3.9999), (22, 16), (12, 17), (4, 16), (4, 4)],
    [(6, 6), (24, 24), (6, 24), (24, 5.9999)],
    [(6, 6), (24, 24), (6, 24), (24, 6.0001)],
], ids=["repeated-vertex", "crossing-left", "crossing-right"])
def test_smoothed_trace_with_ambiguous_edges_can_export(tmp_path, outline):
    config = GenerateRequest(
        grid_x=1, grid_y=1, height_units=3, cutout_depth=10, cutout_clearance=0,
        cutout_chamfer=2, stacking_lip=True, rim_units=1, magnets=False, bed_size=0,
        allow_wall_cutouts=True,
    )
    tool = ScaledPolygon("trace", outline, "Tool")
    prepared = PolygonScaler().prepare_for_generation(tool, 0, smoothed=True)
    prepared.smoothed = True
    mesh, _ = render([prepared], config, tmp_path / "smooth.stl")
    center = Polygon(prepared.points_mm).buffer(0).representative_point()
    point = center.x - 21, 21 - center.y

    assert mesh.is_volume
    assert has_material(mesh, *point, 10.9)
    assert not has_material(mesh, *point, 12)
    assert has_material(mesh, 15, 0, 12)
