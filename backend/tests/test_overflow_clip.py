"""test that tool polygons extending beyond the bin wall are clipped
at the interior boundary, not punched through the wall."""

from pathlib import Path

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import (
    GF_GRID,
    ManifoldSTLGenerator,
)


def test_overflow_polygon_matches_clipped_equivalent(tmp_path: Path):
    """an oversized tool polygon should produce the same result as one
    that's been manually trimmed to the bin interior.

    we place a huge rectangle that overflows on all sides and compare
    its bin volume against a rectangle trimmed to just inside the walls.
    if clipping works, the two should produce identical geometry (same volume).
    if clipping is missing, the oversized polygon carves through the walls
    and removes more material, giving a smaller volume.
    """
    config = GenerateRequest(
        grid_x=1.5,
        grid_y=1.5,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        bed_size=0,
        wall_thickness=1.6,
    )
    bin_w = config.grid_x * GF_GRID
    bin_h = config.grid_y * GF_GRID

    # oversized polygon: extends 10mm beyond each edge
    overflow_poly = ScaledPolygon(
        id="overflow",
        points_mm=[
            (-10, -10),
            (bin_w + 10, -10),
            (bin_w + 10, bin_h + 10),
            (-10, bin_h + 10),
        ],
        label="overflow",
    )

    # manually clipped polygon: stays inside wall_thickness from each edge
    # (the interior boundary the clipping should enforce)
    wt = config.wall_thickness
    clipped_poly = ScaledPolygon(
        id="clipped",
        points_mm=[
            (wt, wt),
            (bin_w - wt, wt),
            (bin_w - wt, bin_h - wt),
            (wt, bin_h - wt),
        ],
        label="clipped",
    )

    gen = ManifoldSTLGenerator()

    body_overflow, _ = gen.generate_bin(
        [overflow_poly], config, str(tmp_path / "overflow.stl")
    )
    body_clipped, _ = gen.generate_bin(
        [clipped_poly], config, str(tmp_path / "clipped.stl")
    )
    body_empty, _ = gen.generate_bin(
        [], config, str(tmp_path / "empty.stl")
    )

    # both should remove material compared to the empty bin
    assert body_overflow.volume() < body_empty.volume()
    assert body_clipped.volume() < body_empty.volume()

    # the overflow and clipped bins should have the same volume
    # (within mesh tolerance) if clipping is working
    vol_diff = abs(body_overflow.volume() - body_clipped.volume())
    assert vol_diff < 1.0, (
        f"volume mismatch: overflow={body_overflow.volume():.1f} vs "
        f"clipped={body_clipped.volume():.1f}, diff={vol_diff:.1f}mm^3. "
        f"overflow polygon likely punching through walls."
    )
