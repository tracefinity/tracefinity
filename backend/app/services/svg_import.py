"""Parse a Shaper Trace (or generic) SVG into a tool outline in millimetres.

Shaper Trace exports carry real-world size on the root <svg>: ``width``/``height``
in physical units plus a ``viewBox`` in internal units, so every path coordinate
converts to millimetres exactly, with no photo tracing / calibration needed.

The largest closed path becomes the tool outline; any other closed path that is
large enough and sits inside the outline becomes an interior ring (hole).
"""
from __future__ import annotations

import re

# subdivisions per cubic/quadratic bezier segment when flattening to a polyline
BEZIER_STEPS = 10
# an interior path must be at least this fraction of the outline area to count as a hole
INTERIOR_MIN_FRAC = 0.03
# unit -> millimetre conversion (CSS px are 96 per inch)
_UNIT_MM = {"mm": 1.0, "cm": 10.0, "in": 25.4, "pt": 25.4 / 72.0, "pc": 25.4 / 6.0,
            "px": 25.4 / 96.0, "": 25.4 / 96.0}

_NUM = re.compile(r"-?\d*\.?\d+(?:[eE][-+]?\d+)?")
_LEN = re.compile(r"^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$", re.I)


class SvgImportError(ValueError):
    """Raised when an SVG cannot be interpreted as a tool outline."""


def _length_mm(value: str) -> float | None:
    m = _LEN.match(value or "")
    if not m:
        return None
    num, unit = float(m.group(1)), m.group(2).lower()
    if unit == "%" or unit not in _UNIT_MM:
        return None
    return num * _UNIT_MM[unit]


def _tokens(d: str):
    i, out = 0, []
    while i < len(d):
        c = d[i]
        if c.isalpha():
            out.append(c)
            i += 1
        elif c in " ,\t\n\r":
            i += 1
        else:
            m = _NUM.match(d, i)
            if not m:
                i += 1
                continue
            out.append(float(m.group()))
            i = m.end()
    return out


def _bezier3(p0, p1, p2, p3):
    pts = []
    for s in range(1, BEZIER_STEPS + 1):
        u = s / BEZIER_STEPS
        v = 1 - u
        pts.append((
            v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
            v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
        ))
    return pts


def _bezier2(p0, p1, p2):
    pts = []
    for s in range(1, BEZIER_STEPS + 1):
        u = s / BEZIER_STEPS
        v = 1 - u
        pts.append((
            v * v * p0[0] + 2 * v * u * p1[0] + u * u * p2[0],
            v * v * p0[1] + 2 * v * u * p1[1] + u * u * p2[1],
        ))
    return pts


def _flatten(d: str):
    """Flatten one path 'd' string into a list of (x, y) polylines (subpaths)."""
    toks = _tokens(d)
    subpaths, cur_pts = [], []
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    i, cmd = 0, None
    while i < len(toks):
        t = toks[i]
        if isinstance(t, str):
            cmd = t
            i += 1
            if cmd in ("Z", "z"):
                if cur_pts:
                    subpaths.append(cur_pts)
                    cur_pts = []
                cur = start
            continue
        rel = cmd.islower()
        base = cmd.upper()
        if base == "M":
            if cur_pts:
                subpaths.append(cur_pts)
            x, y = toks[i], toks[i + 1]
            i += 2
            cur = (cur[0] + x, cur[1] + y) if rel else (x, y)
            start = cur
            cur_pts = [cur]
            cmd = "l" if rel else "L"  # subsequent implicit lineto
        elif base == "L":
            x, y = toks[i], toks[i + 1]
            i += 2
            cur = (cur[0] + x, cur[1] + y) if rel else (x, y)
            cur_pts.append(cur)
        elif base == "H":
            x = toks[i]
            i += 1
            cur = (cur[0] + x, cur[1]) if rel else (x, cur[1])
            cur_pts.append(cur)
        elif base == "V":
            y = toks[i]
            i += 1
            cur = (cur[0], cur[1] + y) if rel else (cur[0], y)
            cur_pts.append(cur)
        elif base == "C":
            c = toks[i:i + 6]
            i += 6
            if rel:
                p1 = (cur[0] + c[0], cur[1] + c[1]); p2 = (cur[0] + c[2], cur[1] + c[3]); p3 = (cur[0] + c[4], cur[1] + c[5])
            else:
                p1 = (c[0], c[1]); p2 = (c[2], c[3]); p3 = (c[4], c[5])
            cur_pts.extend(_bezier3(cur, p1, p2, p3))
            cur = p3
        elif base == "Q":
            c = toks[i:i + 4]
            i += 4
            if rel:
                p1 = (cur[0] + c[0], cur[1] + c[1]); p2 = (cur[0] + c[2], cur[1] + c[3])
            else:
                p1 = (c[0], c[1]); p2 = (c[2], c[3])
            cur_pts.extend(_bezier2(cur, p1, p2))
            cur = p2
        else:
            # unsupported command (S/T/A) — skip its operands conservatively
            i += 1
    if cur_pts:
        subpaths.append(cur_pts)
    return subpaths


def _area(pts):
    a = 0.0
    n = len(pts)
    for j in range(n):
        x1, y1 = pts[j]
        x2, y2 = pts[(j + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _centroid(pts):
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)


def _point_in(poly, pt):
    x, y = pt
    inside = False
    n = len(poly)
    for j in range(n):
        xi, yi = poly[j]
        xj, yj = poly[(j - 1) % n]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
    return inside


def parse_svg_outline(svg_text: str):
    """Return (outline_mm, interior_rings_mm, meta).

    outline_mm and each ring are lists of (x, y) tuples in millimetres, with the
    viewBox top-left as origin. Raises SvgImportError on unusable input.
    """
    try:
        header = svg_text[: svg_text.index(">") + 1]
    except ValueError:
        raise SvgImportError("not a valid SVG document")

    vb_match = re.search(r'viewBox\s*=\s*"([^"]+)"', header)
    w_match = re.search(r'\bwidth\s*=\s*"([^"]+)"', header)
    h_match = re.search(r'\bheight\s*=\s*"([^"]+)"', header)

    if vb_match:
        vb = [float(x) for x in _NUM.findall(vb_match.group(1))]
        if len(vb) != 4 or vb[2] <= 0 or vb[3] <= 0:
            raise SvgImportError("SVG viewBox is malformed")
        w_mm = _length_mm(w_match.group(1)) if w_match else None
        h_mm = _length_mm(h_match.group(1)) if h_match else None
        if w_mm and h_mm:
            mm_per_unit = ((w_mm / vb[2]) + (h_mm / vb[3])) / 2.0
        elif w_mm:
            mm_per_unit = w_mm / vb[2]
        elif h_mm:
            mm_per_unit = h_mm / vb[3]
        else:
            # no physical size on the file — assume viewBox units are CSS px
            mm_per_unit = _UNIT_MM["px"]
        minx, miny = vb[0], vb[1]
    else:
        # no viewBox: treat width/height as the user-unit extent
        w_mm = _length_mm(w_match.group(1)) if w_match else None
        if not w_mm:
            raise SvgImportError("SVG has no viewBox or physical dimensions")
        mm_per_unit = _UNIT_MM["px"]
        minx = miny = 0.0

    paths = re.findall(r'<path\b[^>]*\bd\s*=\s*"([^"]+)"', svg_text)
    if not paths:
        raise SvgImportError("SVG contains no <path> elements")

    subpaths = []
    for d in paths:
        for sp in _flatten(d):
            if len(sp) >= 3:
                subpaths.append(sp)
    if not subpaths:
        raise SvgImportError("no usable closed outlines found in SVG")

    subpaths.sort(key=_area, reverse=True)
    outline = subpaths[0]
    a_out = _area(outline)
    rings = [
        sp for sp in subpaths[1:]
        if _area(sp) >= INTERIOR_MIN_FRAC * a_out and _point_in(outline, _centroid(sp))
    ]

    def to_mm(pts):
        return [((x - minx) * mm_per_unit, (y - miny) * mm_per_unit) for x, y in pts]

    outline_mm = to_mm(outline)
    rings_mm = [to_mm(r) for r in rings]
    xs = [p[0] for p in outline_mm]
    ys = [p[1] for p in outline_mm]
    meta = {
        "mm_per_unit": mm_per_unit,
        "width_mm": max(xs) - min(xs),
        "height_mm": max(ys) - min(ys),
        "path_count": len(subpaths),
        "hole_count": len(rings_mm),
    }
    return outline_mm, rings_mm, meta
