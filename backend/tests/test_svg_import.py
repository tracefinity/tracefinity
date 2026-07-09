"""Tests for SVG import: the tool outline must come out at the SVG's real-world
size (from width/height + viewBox), with interior paths detected as holes."""
import math

import pytest

from app.services.svg_import import SvgImportError, parse_svg_outline


def _bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return max(xs) - min(xs), max(ys) - min(ys)


def test_mm_dimensions_from_width_height_viewbox():
    # 40mm x 80mm sheet, viewBox in arbitrary internal units
    svg = (
        '<svg viewBox="0 0 400 800" width="40mm" height="80mm">'
        '<path d="M0 0 L400 0 L400 800 L0 800 Z"/></svg>'
    )
    outline, rings, meta = parse_svg_outline(svg)
    w, h = _bbox(outline)
    assert math.isclose(w, 40.0, abs_tol=1e-6)
    assert math.isclose(h, 80.0, abs_tol=1e-6)
    assert rings == []
    assert math.isclose(meta["mm_per_unit"], 0.1, abs_tol=1e-9)


def test_interior_ring_detected_as_hole():
    # big outer square with a large centered inner square -> one hole
    svg = (
        '<svg viewBox="0 0 100 100" width="100mm" height="100mm">'
        '<path d="M0 0 L100 0 L100 100 L0 100 Z"/>'
        '<path d="M30 30 L70 30 L70 70 L30 70 Z"/></svg>'
    )
    outline, rings, meta = parse_svg_outline(svg)
    assert meta["hole_count"] == 1
    assert len(rings) == 1
    w, h = _bbox(outline)
    assert math.isclose(w, 100.0, abs_tol=1e-6)


def test_tiny_detail_paths_are_ignored():
    # a speck far below the interior threshold should not become a hole
    svg = (
        '<svg viewBox="0 0 100 100" width="100mm" height="100mm">'
        '<path d="M0 0 L100 0 L100 100 L0 100 Z"/>'
        '<path d="M50 50 L52 50 L52 52 L50 52 Z"/></svg>'
    )
    _, rings, meta = parse_svg_outline(svg)
    assert meta["hole_count"] == 0
    assert rings == []


def test_relative_commands_and_bezier():
    # relative moveto/lineto plus a cubic curve must still parse
    svg = (
        '<svg viewBox="0 0 10 10" width="10mm" height="10mm">'
        '<path d="m0 0 l10 0 c0 5 0 5 -10 10 z"/></svg>'
    )
    outline, _, _ = parse_svg_outline(svg)
    assert len(outline) >= 3


def test_no_physical_size_falls_back_to_px():
    # no width/height -> viewBox units treated as CSS px (96/inch)
    svg = '<svg viewBox="0 0 96 96"><path d="M0 0 L96 0 L96 96 L0 96 Z"/></svg>'
    outline, _, _ = parse_svg_outline(svg)
    w, h = _bbox(outline)
    assert math.isclose(w, 25.4, abs_tol=1e-6)  # 96px @ 96dpi = 1in = 25.4mm


def test_rejects_svg_without_paths():
    with pytest.raises(SvgImportError):
        parse_svg_outline('<svg viewBox="0 0 10 10" width="10mm" height="10mm"></svg>')


def test_rejects_non_svg():
    with pytest.raises(SvgImportError):
        parse_svg_outline("not an svg at all")
