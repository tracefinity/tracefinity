"""Tests for the cylinder finger-hole shape."""
from app.models.schemas import BinParams
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from app.services.stl_generator_manifold import (
    _ensure_ccw,
    _filleted_rect_radius,
    _make_finger_hole_chamfers,
    _make_finger_holes,
    _rounded_bottom_rect_profile_pts,
    _signed_area,
)


def _scaled_poly_with_hole(shape: str, radius=10.0):
    fh = ScaledFingerHole(
        id="fh1",
        x_mm=0.0,
        y_mm=0.0,
        radius_mm=radius,
        shape=shape,
    )
    return ScaledPolygon(
        id="p1",
        points_mm=[(-30, -30), (30, -30), (30, 30), (-30, 30)],
        label="test",
        finger_holes=[fh],
    )


def _scaled_poly_with_rectangle_hole(shape: str, width=40.0, height=18.0, rotation=0.0):
    fh = ScaledFingerHole(
        id="fh1",
        x_mm=0.0,
        y_mm=0.0,
        radius_mm=max(width, height) / 2,
        shape=shape,
        width_mm=width,
        height_mm=height,
        rotation=rotation,
    )
    return ScaledPolygon(
        id="p1",
        points_mm=[(-30, -30), (30, -30), (30, 30), (-30, 30)],
        label="test",
        finger_holes=[fh],
    )


def _has_point(profile, x: float, y: float, tol: float = 1e-9) -> bool:
    return any(abs(px - x) < tol and abs(py - y) < tol for px, py in profile)


class TestCylinderShape:
    def test_cylinder_produces_cutter(self):
        poly = _scaled_poly_with_hole("cylinder")
        config = BinParams(cutout_depth=15.0)
        result = _make_finger_holes(
            [poly], config, wall_top_z=33.0, max_depth=15.0,
            offset_x=0.0, offset_y=0.0,
        )
        assert result is not None
        bb = result.bounding_box()
        # bb is (min_x, min_y, min_z, max_x, max_y, max_z)
        z_extent = bb[5] - bb[2]
        assert 14.5 < z_extent < 16.0, f"expected ~15mm, got {z_extent}"

    def test_cylinder_bottom_is_flat(self):
        # cylinder's bottom face sits at exactly wall_top_z - pocket_depth,
        # proving full-depth reach (vs the sphere shape which is capped at
        # its own radius).
        poly = _scaled_poly_with_hole("cylinder")
        config = BinParams(cutout_depth=12.0)
        wall_top = 30.0
        result = _make_finger_holes(
            [poly], config, wall_top_z=wall_top, max_depth=12.0,
            offset_x=0.0, offset_y=0.0,
        )
        assert result is not None
        bb = result.bounding_box()
        expected_floor = wall_top - 12.0
        assert abs(bb[2] - expected_floor) < 0.05

    def test_cylinder_chamfer_cutter_built(self):
        poly = _scaled_poly_with_hole("cylinder")
        config = BinParams(cutout_depth=15.0, cutout_chamfer=1.0)
        result = _make_finger_hole_chamfers(
            [poly], config, wall_top_z=33.0, chamfer_size=1.0,
            max_depth=15.0, offset_x=0.0, offset_y=0.0,
        )
        assert result is not None

    def test_cylinder_cuts_deeper_than_sphere_when_radius_limits(self):
        # the circle (sphere) cutter is sphere-shaped, so when the requested
        # pocket_depth exceeds the sphere's radius the sphere is recentred at
        # wall_top_z and only reaches `radius` deep — losing the rest. The
        # cylinder reaches the full pocket_depth regardless. This is the
        # primary use case for the cylinder shape (clearance pockets that
        # need to be deeper than the hole's own radius).
        wall_top = 30.0
        depth = 15.0
        radius = 10.0  # depth > radius → sphere truncates

        cyl_poly = _scaled_poly_with_hole("cylinder", radius=radius)
        circ_poly = _scaled_poly_with_hole("circle", radius=radius)
        config = BinParams(cutout_depth=depth)

        cyl = _make_finger_holes([cyl_poly], config, wall_top_z=wall_top, max_depth=depth, offset_x=0.0, offset_y=0.0)
        circ = _make_finger_holes([circ_poly], config, wall_top_z=wall_top, max_depth=depth, offset_x=0.0, offset_y=0.0)
        cyl_floor_z = cyl.bounding_box()[2]
        circ_floor_z = circ.bounding_box()[2]

        assert abs(cyl_floor_z - (wall_top - depth)) < 0.05
        assert abs(circ_floor_z - (wall_top - radius)) < 0.05
        assert cyl_floor_z < circ_floor_z - 1.0


class TestFilletedRectangleShape:
    def test_filleted_rectangle_radius_clamps_to_width_or_depth(self):
        assert abs(_filleted_rect_radius(width=10.0, pocket_depth=30.0) - (10.0 / 3.0)) < 1e-9
        assert _filleted_rect_radius(width=80.0, pocket_depth=30.0) == 15.0
        assert _filleted_rect_radius(width=-10.0, pocket_depth=30.0) == 0.0
        assert _filleted_rect_radius(width=10.0, pocket_depth=-30.0) == 0.0

    def test_filleted_rectangle_profile_is_ccw(self):
        profile = _rounded_bottom_rect_profile_pts(width=30.0, depth=20.0, fillet_r=5.0)
        assert _signed_area(profile) > 0
        assert _ensure_ccw(profile[::-1])[0].tolist() == profile[0].tolist()

    def test_filleted_rectangle_profile_zero_fillet_is_rectangular(self):
        profile = _rounded_bottom_rect_profile_pts(width=20.0, depth=10.0, fillet_r=0.0)
        assert _signed_area(profile) > 0
        assert profile.tolist() == [
            [10.0, 0.0],
            [10.0, 10.0],
            [-10.0, 10.0],
            [-10.0, 0.0],
        ]

    def test_filleted_rectangle_profile_handles_half_width_fillet(self):
        profile = _rounded_bottom_rect_profile_pts(width=20.0, depth=30.0, fillet_r=10.0)
        assert _signed_area(profile) > 0
        assert abs(profile[:, 0].min() + 10.0) < 1e-9
        assert abs(profile[:, 0].max() - 10.0) < 1e-9
        assert abs(profile[:, 1].min()) < 1e-9
        assert abs(profile[:, 1].max() - 30.0) < 1e-9

    def test_filleted_rectangle_profile_clamps_negative_dimensions(self):
        profile = _rounded_bottom_rect_profile_pts(width=-20.0, depth=-30.0, fillet_r=5.0)
        assert _signed_area(profile) > 0
        assert abs(profile[:, 0].min() + 0.005) < 1e-9
        assert abs(profile[:, 0].max() - 0.005) < 1e-9
        assert abs(profile[:, 1].min()) < 1e-9
        assert abs(profile[:, 1].max() - 0.01) < 1e-9

    def test_filleted_rectangle_profile_key_positions(self):
        profile = _rounded_bottom_rect_profile_pts(width=30.0, depth=20.0, fillet_r=5.0)
        assert profile[0].tolist() == [10.0, 0.0]
        assert _has_point(profile, 15.0, 5.0)
        assert _has_point(profile, 15.0, 20.0)
        assert _has_point(profile, -15.0, 20.0)
        assert _has_point(profile, -15.0, 5.0)
        assert abs(profile[-1][0] + 10.0) < 1e-9
        assert abs(profile[-1][1]) < 1e-9

    def test_filleted_rectangle_reaches_full_depth(self):
        wall_top = 30.0
        depth = 12.0
        poly = _scaled_poly_with_rectangle_hole("filleted_rectangle")
        config = BinParams(cutout_depth=depth)

        result = _make_finger_holes(
            [poly], config, wall_top_z=wall_top, max_depth=depth,
            offset_x=0.0, offset_y=0.0,
        )

        assert result is not None
        bb = result.bounding_box()
        expected_floor = wall_top - depth
        assert abs(bb[2] - expected_floor) < 0.05
        assert 39.5 < bb[3] - bb[0] < 40.5
        assert abs((bb[4] - bb[1]) - 18.0) < 0.005

    def test_filleted_rectangle_rotation_swaps_xy_extents(self):
        wall_top = 30.0
        depth = 12.0
        poly = _scaled_poly_with_rectangle_hole("filleted_rectangle", width=40.0, height=18.0, rotation=90.0)
        config = BinParams(cutout_depth=depth)

        result = _make_finger_holes(
            [poly], config, wall_top_z=wall_top, max_depth=depth,
            offset_x=0.0, offset_y=0.0,
        )

        assert result is not None
        bb = result.bounding_box()
        assert abs((bb[3] - bb[0]) - 18.0) < 0.05
        assert abs((bb[4] - bb[1]) - 40.0) < 0.05

    def test_filleted_rectangle_chamfer_cutter_built(self):
        poly = _scaled_poly_with_rectangle_hole("filleted_rectangle")
        config = BinParams(cutout_depth=15.0, cutout_chamfer=1.0)
        result = _make_finger_hole_chamfers(
            [poly], config, wall_top_z=33.0, chamfer_size=1.0,
            max_depth=15.0, offset_x=0.0, offset_y=0.0,
        )
        assert result is not None
