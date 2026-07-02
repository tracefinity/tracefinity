"""Embossed text clipped to bin floor vs tool cutout floors."""

from pathlib import Path

from app.models.schemas import GenerateRequest, TextLabel
from app.services import stl_generator_manifold as sg
from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import GF_GRID, ManifoldSTLGenerator, _make_text_labels


def _config(**overrides) -> GenerateRequest:
    defaults = dict(
        grid_x=2,
        grid_y=2,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        bed_size=0,
        cutout_depth=20,
    )
    defaults.update(overrides)
    return GenerateRequest(**defaults)


def _left_cell_cutout() -> ScaledPolygon:
    return ScaledPolygon(
        "tool",
        [(4, 4), (38, 4), (38, 80), (4, 80)],
        "tool",
    )


def _config_grid_span() -> float:
    return 2 * GF_GRID


def _label_params():
    wall_top_z = 28.0
    span = _config_grid_span()
    offset_x = -span / 2
    offset_y = -span / 2
    max_depth = wall_top_z - 4.75 - 2
    return wall_top_z, offset_x, offset_y, max_depth


def test_emboss_fully_in_cutout_renders():
    config = _config(
        text_labels=[TextLabel(id="in", text="TOOL", x=21, y=42, emboss=True)],
    )
    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    _, embossed = _make_text_labels(
        config,
        wall_top_z,
        False,
        offset_x,
        offset_y,
        20,
        polygons=[_left_cell_cutout()],
        max_depth=max_depth,
    )
    assert embossed is not None and not embossed.is_empty()


def test_emboss_fully_on_surface_renders():
    config = _config(
        text_labels=[TextLabel(id="out", text="TOOL", x=63, y=42, emboss=True)],
    )
    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    _, embossed = _make_text_labels(
        config,
        wall_top_z,
        False,
        offset_x,
        offset_y,
        20,
        polygons=[_left_cell_cutout()],
        max_depth=max_depth,
    )
    assert embossed is not None and not embossed.is_empty()


def test_emboss_spanning_cutout_is_clipped(tmp_path: Path):
    generator = ManifoldSTLGenerator()
    cutout = _left_cell_cutout()
    base = _config()

    span_config = base.model_copy(
        update={"text_labels": [TextLabel(id="p", text="TOOLNAME", x=45, y=42, emboss=True)]}
    )
    _, text_span = generator.generate_bin(
        [cutout], span_config, str(tmp_path / "span.stl")
    )
    assert text_span is not None and not text_span.is_empty()

    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    tl = span_config.text_labels[0]
    cs = sg._text_to_cross_section(tl.text, tl.font_size)
    surf_clip = sg._make_surface_emboss_clip_volume(
        base, wall_top_z, tl.depth, offset_x, offset_y, [cutout], max_depth
    )
    surf_solid = sg._embossed_text_solid(
        cs, tl.depth, tl.rotation, tl.x + offset_x, -(tl.y + offset_y), wall_top_z
    )
    over_cutout = sg._intersect_emboss(surf_solid, surf_clip)
    full_at_wall = surf_solid.volume()
    allowed_at_wall = over_cutout.volume() if over_cutout else 0.0
    assert allowed_at_wall < full_at_wall * 0.95


def test_emboss_in_cutout_has_no_wall_surface_geometry():
    base = _config(
        text_labels=[TextLabel(id="c", text="TOOLNAME", x=21, y=42, emboss=True)],
    )
    cutout = _left_cell_cutout()
    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    tl = base.text_labels[0]
    cs = sg._text_to_cross_section(tl.text, tl.font_size)
    surf_clip = sg._make_surface_emboss_clip_volume(
        base, wall_top_z, tl.depth, offset_x, offset_y, [cutout], max_depth
    )
    surf_solid = sg._embossed_text_solid(
        cs, tl.depth, tl.rotation, tl.x + offset_x, -(tl.y + offset_y), wall_top_z
    )
    over_surface = sg._intersect_emboss(surf_solid, surf_clip)
    assert over_surface is None or over_surface.volume() < surf_solid.volume() * 0.05


def _disabled_cell_cutout() -> ScaledPolygon:
    """Vertical strip in disabled top-right cell (layout px)."""
    return ScaledPolygon(
        "tool",
        [(50, 4), (76, 4), (76, 80), (50, 80)],
        "tool",
    )


def _connect_config(**overrides) -> GenerateRequest:
    defaults = dict(
        grid_x=2,
        grid_y=2,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        bed_size=0,
        cutout_depth=20,
        partial_bins=True,
        partial_bins_values=[True, False, False, True],
        partial_bins_connect=True,
    )
    defaults.update(overrides)
    return GenerateRequest(**defaults)


def test_emboss_on_connect_plate_outside_cutout_in_disabled_cell():
    """Text spanning a disabled connect cell must emboss on the plate, not only in the cutout."""
    long_text = "test 123 test 123 test 123 test 123"
    config = _connect_config(
        text_labels=[TextLabel(id="span", text=long_text, x=63, y=42, emboss=True)],
    )
    cutout = _disabled_cell_cutout()
    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    tl = config.text_labels[0]
    cs = sg._text_to_cross_section(tl.text, tl.font_size)
    lx = tl.x + offset_x
    ly = -(tl.y + offset_y)
    plate_top = sg._connect_base_emboss_z()

    connect_clip = sg._make_connect_base_emboss_clip_volume(
        config, tl.depth, offset_x, offset_y, wall_top_z, max_depth, [cutout]
    )
    connect_solid = sg._embossed_text_solid(cs, tl.depth, tl.rotation, lx, ly, plate_top)
    connect_part = sg._intersect_emboss(connect_solid, connect_clip)

    cutout_clip = sg._make_cutout_emboss_clip_volume(
        cutout, config, wall_top_z, max_depth, tl.depth, offset_x, offset_y
    )
    cutout_floor = wall_top_z - 20
    cutout_solid = sg._embossed_text_solid(cs, tl.depth, tl.rotation, lx, ly, cutout_floor)
    cutout_part = sg._intersect_emboss(cutout_solid, cutout_clip)

    assert connect_part is not None and not connect_part.is_empty()
    assert cutout_part is not None and not cutout_part.is_empty()
    assert connect_part.volume() > cutout_part.volume() * 0.3


def test_recess_spanning_cutout_is_clipped(tmp_path: Path):
    generator = ManifoldSTLGenerator()
    cutout = _left_cell_cutout()
    base = _config()

    span_config = base.model_copy(
        update={"text_labels": [TextLabel(id="p", text="TOOLNAME", x=45, y=42, emboss=False)]}
    )
    recessed, _ = generator.generate_bin(
        [cutout], span_config, str(tmp_path / "span.stl")
    )
    assert recessed is not None and not recessed.is_empty()

    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    tl = span_config.text_labels[0]
    cs = sg._text_to_cross_section(tl.text, tl.font_size)
    lx = tl.x + offset_x
    ly = -(tl.y + offset_y)
    surf_clip = sg._make_surface_emboss_clip_volume(
        base, wall_top_z, tl.depth, offset_x, offset_y, [cutout], max_depth
    )
    surf_solid = sg._recessed_text_solid(cs, tl.depth, tl.rotation, lx, ly, wall_top_z)
    over_cutout = sg._intersect_emboss(surf_solid, surf_clip)
    full_at_wall = surf_solid.volume()
    allowed_at_wall = over_cutout.volume() if over_cutout else 0.0
    assert allowed_at_wall < full_at_wall * 0.95


def test_recess_on_connect_plate_outside_cutout_in_disabled_cell():
    long_text = "Test 123 test 456 test 678 test 123"
    config = _connect_config(
        text_labels=[TextLabel(id="span", text=long_text, x=63, y=42, emboss=False)],
    )
    cutout = _disabled_cell_cutout()
    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    tl = config.text_labels[0]
    cs = sg._text_to_cross_section(tl.text, tl.font_size)
    lx = tl.x + offset_x
    ly = -(tl.y + offset_y)
    plate_top = sg._connect_base_emboss_z()

    connect_clip = sg._make_connect_base_emboss_clip_volume(
        config, tl.depth, offset_x, offset_y, wall_top_z, max_depth, [cutout]
    )
    connect_solid = sg._recessed_text_solid(cs, tl.depth, tl.rotation, lx, ly, plate_top)
    connect_part = sg._intersect_emboss(connect_solid, connect_clip)

    cutout_clip = sg._make_cutout_emboss_clip_volume(
        cutout, config, wall_top_z, max_depth, tl.depth, offset_x, offset_y
    )
    cutout_floor = wall_top_z - 20
    cutout_solid = sg._recessed_text_solid(cs, tl.depth, tl.rotation, lx, ly, cutout_floor)
    cutout_part = sg._intersect_emboss(cutout_solid, cutout_clip)

    assert connect_part is not None and not connect_part.is_empty()
    assert cutout_part is not None and not cutout_part.is_empty()
    assert connect_part.volume() > cutout_part.volume() * 0.3


def test_shallow_cutout_in_disabled_connect_cell_uses_plate_not_pocket_floor():
    """Shallow pockets above the connect plate must not steal text from the plate surface."""
    config = _connect_config(
        cutout_depth=5,
        text_labels=[TextLabel(id="span", text="HELLO", x=63, y=21, emboss=False)],
    )
    cutout = _disabled_cell_cutout()
    wall_top_z, offset_x, offset_y, max_depth = _label_params()
    tl = config.text_labels[0]
    cs = sg._text_to_cross_section(tl.text, tl.font_size)
    lx = tl.x + offset_x
    ly = -(tl.y + offset_y)
    plate_top = sg._connect_base_emboss_z()

    connect_clip = sg._make_connect_base_emboss_clip_volume(
        config, tl.depth, offset_x, offset_y, wall_top_z, max_depth, [cutout]
    )
    connect_solid = sg._recessed_text_solid(cs, tl.depth, tl.rotation, lx, ly, plate_top)
    connect_part = sg._intersect_emboss(connect_solid, connect_clip)

    cutout_clip = sg._make_cutout_emboss_clip_volume(
        cutout, config, wall_top_z, max_depth, tl.depth, offset_x, offset_y
    )
    cutout_floor = wall_top_z - 5
    cutout_solid = sg._recessed_text_solid(cs, tl.depth, tl.rotation, lx, ly, cutout_floor)
    cutout_part = sg._intersect_emboss(cutout_solid, cutout_clip)

    assert connect_part is not None and not connect_part.is_empty()
    assert cutout_part is None or cutout_part.is_empty()
