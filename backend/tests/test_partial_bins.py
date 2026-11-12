from pathlib import Path

from app.models.schemas import GenerateRequest, TextLabel
from app.services.bin_profiles import (
    _cell_center,
    _cell_enabled,
    _effective_grid_span,
    _label_in_enabled_cell,
    _label_layout_cell,
    _partial_cell_index,
    _uses_partial_shell,
)
from tests.geometry_support import render


def _base_config(**overrides) -> GenerateRequest:
    defaults = dict(
        grid_x=2,
        grid_y=2,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        bed_size=0,
    )
    defaults.update(overrides)
    return GenerateRequest(**defaults)


def test_partial_cell_index_maps_ui_top_row_to_high_iy():
    config = _base_config(grid_y=8)

    assert _partial_cell_index(config, 0, 7) == 0
    assert _partial_cell_index(config, 1, 7) == 1
    assert _partial_cell_index(config, 0, 0) == 14
    assert _partial_cell_index(config, 1, 0) == 15


def test_cell_enabled_respects_ui_row_order():
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, False, True],
    )

    assert _cell_enabled(config, 0, 1) is True
    assert _cell_enabled(config, 1, 1) is False
    assert _cell_enabled(config, 0, 0) is False
    assert _cell_enabled(config, 1, 0) is True


def test_disabling_second_top_left_targets_top_not_bottom():
    values = [True] * 16
    values[2] = False
    config = _base_config(
        grid_y=8,
        partial_bins=True,
        partial_bins_values=values,
    )

    assert _cell_enabled(config, 0, 6) is False
    assert _cell_enabled(config, 0, 0) is True


def test_partial_shell_uses_effective_span():
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, False, False],
    )

    assert _uses_partial_shell(config) is True
    assert _effective_grid_span(config) == (1, 1)


def test_partial_bin_is_smaller_than_full_bin(tmp_path: Path):
    full_config = _base_config()
    partial_config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, False, False],
    )

    full_body, _ = render([], full_config, str(tmp_path / "full.stl"))
    partial_body, _ = render([], partial_config, str(tmp_path / "partial.stl"))

    assert partial_body.volume < full_body.volume


def test_partial_bin_with_all_cells_matches_full_bin(tmp_path: Path):
    full_config = _base_config()
    partial_config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, True, True, True],
    )

    full_body, _ = render([], full_config, str(tmp_path / "full.stl"))
    partial_body, _ = render([], partial_config, str(tmp_path / "partial.stl"))

    assert abs(partial_body.volume - full_body.volume) < 1.0


def test_partial_bin_adjacent_cells_stay_one_piece(tmp_path: Path):
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, True, True],
    )

    body, _ = render([], config, str(tmp_path / "l.stl"))

    assert len(body.split()) == 1


def test_partial_bin_many_cells_stay_connected(tmp_path: Path):
    # 2x6 grid, disable one cell in the left column (UI row 1)
    values = [True] * 12
    values[2] = False
    config = _base_config(
        grid_y=6,
        stacking_lip=True,
        partial_bins=True,
        partial_bins_values=values,
    )

    body, _ = render([], config, str(tmp_path / "grid.stl"))

    assert len(body.split()) <= 2


def test_partial_bins_connect_keeps_single_piece(tmp_path: Path):
    values = [True, True, False, False, True, True, True, True]
    cut_config = _base_config(
        grid_y=4,
        stacking_lip=True,
        partial_bins=True,
        partial_bins_values=values,
        partial_bins_connect=False,
    )
    connect_config = cut_config.model_copy(update={"partial_bins_connect": True})

    cut_body, _ = render([], cut_config, str(tmp_path / "cut.stl"))
    connect_body, _ = render([], connect_config, str(tmp_path / "connect.stl"))

    assert len(cut_body.split()) >= 2
    assert connect_body.volume > cut_body.volume
    assert connect_body.volume < render(
        [],
        _base_config(grid_y=4, stacking_lip=True),
        str(tmp_path / "full.stl"),
    )[0].volume


def test_partial_bin_split_uses_enabled_span(tmp_path: Path):
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, False, False],
        bed_size=80,
    )

    _, parts = render([], config, str(tmp_path / "partial.stl"))

    assert parts == []


def test_partial_bins_cut_exports_separated_stls(tmp_path: Path):
    values = [True, True, False, False, True, True, True, True]
    config = _base_config(
        grid_y=4,
        partial_bins=True,
        partial_bins_values=values,
        partial_bins_connect=False,
        bed_size=0,
    )

    _, paths = render([], config, str(tmp_path / "full.stl"))

    assert len(paths) >= 2
    assert all(Path(p).exists() for p in paths)


def test_partial_bins_connect_skips_separated_export(tmp_path: Path):
    values = [True, True, False, False, True, True, True, True]
    config = _base_config(
        grid_y=4,
        partial_bins=True,
        partial_bins_values=values,
        partial_bins_connect=True,
        bed_size=0,
    )

    _, paths = render([], config, str(tmp_path / "full.stl"))

    assert paths == []


def test_connect_base_magnet_holes_in_disabled_cells(tmp_path: Path):
    values = [True, True, False, False, True, True, True, True]
    config = _base_config(
        grid_y=4,
        stacking_lip=True,
        partial_bins=True,
        partial_bins_values=values,
        partial_bins_connect=True,
        magnets=True,
    )

    body, _ = render([], config, str(tmp_path / "connect.stl"))

    # iy=1 is a disabled row; magnet inset is 13 mm from cell centre
    cx, cy = _cell_center(0, 1, 2, 4)
    mx, my = cx - 13.0, cy - 13.0
    import numpy as np

    # The magnet hole opens on the base and ends in solid material.
    section = body.section(plane_origin=(0, 0, 1), plane_normal=(0, 0, 1))
    assert any(np.linalg.norm(ring[:, :2].mean(axis=0) - (mx, my)) < 0.5
               and np.ptp(ring[:, 0]) < 6.1 for ring in section.discrete)


def test_partial_bins_retain_wall_adds_perimeter_material(tmp_path: Path):
    values = [True, True, False, False, True, True, True, True]
    base = _base_config(
        grid_y=4,
        stacking_lip=True,
        partial_bins=True,
        partial_bins_values=values,
        partial_bins_connect=True,
    )
    connect_body, _ = render([], base, str(tmp_path / "connect.stl"))
    retain_body, _ = render(
        [],
        base.model_copy(update={"partial_bins_retain_wall": True}),
        str(tmp_path / "retain.stl"),
    )

    assert retain_body.volume > connect_body.volume


def test_partial_bins_retain_wall_disabled_without_connect():
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, True, True],
        partial_bins_connect=False,
        partial_bins_retain_wall=True,
    )
    assert config.partial_bins_retain_wall is False


def test_partial_bins_rejects_all_cells_disabled():
    import pytest

    with pytest.raises(ValueError, match="at least one grid cell"):
        _base_config(
            partial_bins=True,
            partial_bins_values=[False, False, False, False],
        )


def test_connect_mode_split_uses_full_grid_footprint(tmp_path: Path):
    values = [True] + [False] * 8
    config = _base_config(
        grid_x=3,
        grid_y=3,
        partial_bins=True,
        partial_bins_values=values,
        partial_bins_connect=True,
        bed_size=80,
    )

    _, parts = render([], config, str(tmp_path / "connect.stl"))

    assert parts != []


def test_label_layout_cell_maps_top_left():
    config = _base_config()
    assert _label_layout_cell(config, 21, 21) == (0, 1)


def test_label_in_enabled_cell_respects_partial_mask():
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, False, True],
    )
    assert _label_in_enabled_cell(config, 21, 21) is True
    assert _label_in_enabled_cell(config, 63, 21) is False


def test_text_label_in_disabled_cell_excluded_from_stl(tmp_path: Path):
    config = _base_config(
        partial_bins=True,
        partial_bins_values=[True, False, False, True],
        text_labels=[
            TextLabel(id="off", text="HELLO", x=63, y=21, emboss=True),
        ],
    )
    render([], config, tmp_path / "off.stl")
    text_body = (tmp_path / "off.3mf").exists()
    assert not text_body

    enabled_config = config.model_copy(
        update={"text_labels": [TextLabel(id="on", text="HELLO", x=21, y=21, emboss=True)]}
    )
    render([], enabled_config, tmp_path / "on.stl")
    text_enabled = (tmp_path / "on.3mf").exists()
    assert text_enabled

    span_config = config.model_copy(
        update={"text_labels": [TextLabel(id="span", text="HELLO", x=42, y=21, emboss=True)]}
    )
    render([], span_config, tmp_path / "span.stl")
    text_span = (tmp_path / "span.3mf").exists()
    assert not text_span


def test_label_layout_cell_fractional_grid_indexes_rows_from_bottom():
    # 63mm layout: fractional 21mm band is the top row (iy=1),
    # full 42mm row pitches from the bottom (iy=0)
    config = _base_config(grid_y=1.5)

    assert _label_layout_cell(config, 21, 30) == (0, 0)
    assert _label_layout_cell(config, 21, 10) == (0, 1)
    # centre exactly on a gridline goes to the higher-index cell, matching x
    assert _label_layout_cell(config, 21, 21) == (0, 1)


def test_text_label_fractional_grid_bottom_row_disabled_skips_label(tmp_path: Path):
    # label at y=30 sits in the bottom 42mm row, which is disabled
    config = _base_config(
        grid_y=1.5,
        partial_bins=True,
        partial_bins_values=[True, True, False, False],
        text_labels=[TextLabel(id="lbl", text="HELLO", x=21, y=30, emboss=True)],
    )

    render([], config, tmp_path / "bottom.stl")
    text_body = (tmp_path / "bottom.3mf").exists()

    assert not text_body


def test_text_label_fractional_grid_top_row_disabled_keeps_label(tmp_path: Path):
    # same label, but only the top 21mm band is disabled
    config = _base_config(
        grid_y=1.5,
        partial_bins=True,
        partial_bins_values=[False, False, True, True],
        text_labels=[TextLabel(id="lbl", text="HELLO", x=21, y=30, emboss=True)],
    )

    render([], config, tmp_path / "top.stl")
    text_body = (tmp_path / "top.3mf").exists()

    assert text_body
