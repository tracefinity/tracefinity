"""Tests for the cylinder finger-hole shape."""
from app.models.schemas import BinParams
from app.services.polygon_scaler import ScaledFingerHole, ScaledPolygon
from app.services.stl_generator_manifold import (
    _make_finger_hole_chamfers,
    _make_finger_holes,
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


class TestCylinderShape:
    def test_cylinder_produces_cutter(self):
        poly = _scaled_poly_with_hole("cylinder")
        config = BinParams(cutout_depth=15.0)
        result = _make_finger_holes(
            [poly], config, wall_top_z=33.0, pocket_depth=15.0,
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
            [poly], config, wall_top_z=wall_top, pocket_depth=12.0,
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
            offset_x=0.0, offset_y=0.0,
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

        cyl = _make_finger_holes([cyl_poly], config, wall_top_z=wall_top, pocket_depth=depth, offset_x=0.0, offset_y=0.0)
        circ = _make_finger_holes([circ_poly], config, wall_top_z=wall_top, pocket_depth=depth, offset_x=0.0, offset_y=0.0)
        cyl_floor_z = cyl.bounding_box()[2]
        circ_floor_z = circ.bounding_box()[2]

        assert abs(cyl_floor_z - (wall_top - depth)) < 0.05
        assert abs(circ_floor_z - (wall_top - radius)) < 0.05
        assert cyl_floor_z < circ_floor_z - 1.0
