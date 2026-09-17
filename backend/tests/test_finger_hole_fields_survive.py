"""Regression for #214: finger holes were rebuilt with hand-written argument
lists, so a field survived only where someone remembered to pass it. These
tests walk FingerHole.model_fields so a new field fails here, not in a bin."""

from types import UnionType
from typing import Literal, Union, get_args, get_origin

from app.api.routes import _translate_finger_holes
from app.models.schemas import BinConfig, BinModel, FingerHole, PlacedTool, Point, Polygon, Tool
from app.services.bin_service import sync_placed_tools
from app.services.polygon_scaler import PolygonScaler, ScaledFingerHole

SQUARE = [Point(x=0, y=0), Point(x=40, y=0), Point(x=40, y=40), Point(x=0, y=40)]

# FingerHole field -> ScaledFingerHole attribute, where the name differs
SCALED_NAMES = {"x": "x_mm", "y": "y_mm", "radius": "radius_mm", "width": "width_mm", "height": "height_mm"}


def _probe_values() -> dict:
    """one non-default value per field, so a dropped field is visible."""
    values = {}
    for name, field in FingerHole.model_fields.items():
        ann = field.annotation
        origin = get_origin(ann)
        args = get_args(ann)
        if origin is Literal:
            values[name] = next(a for a in args if a != field.default)
        elif ann is str or (origin in (Union, UnionType) and str in args):
            values[name] = f"{name}-probe"
        else:
            values[name] = 7.25 + len(values)
    return values


def _probe() -> FingerHole:
    return FingerHole(**_probe_values())


def _assert_same_except(out: FingerHole, exp: FingerHole, *moved: str):
    got, want = out.model_dump(), exp.model_dump()
    for name in want:
        if name in moved:
            continue
        assert got[name] == want[name], name


def test_scale_and_centre_keeps_every_field():
    fh = _probe()
    poly = Polygon(id="p", label="probe", points=SQUARE, finger_holes=[fh])

    _, holes, _ = PolygonScaler().scale_and_centre(poly, 1.0)

    assert len(holes) == 1
    _assert_same_except(holes[0], fh, "x", "y")


def test_translate_keeps_every_field():
    fh = _probe()

    (out,) = _translate_finger_holes([fh], 3.0, -4.0)

    _assert_same_except(out, fh, "x", "y")
    assert out.x == fh.x + 3.0
    assert out.y == fh.y - 4.0


def test_scaled_finger_hole_carries_every_field():
    fh = _probe()

    sfh = ScaledFingerHole.from_finger_hole(fh, 2.0)

    for name, value in fh.model_dump().items():
        attr = SCALED_NAMES.get(name, name)
        assert hasattr(sfh, attr), attr
        if name in ("x", "y"):
            assert getattr(sfh, attr) == value * 2.0
        else:
            assert getattr(sfh, attr) == value, name


def test_sync_carries_source_fields_and_placement_override():
    source_hole = _probe().model_copy(update={"depth_override": None})
    tool = Tool(id="t1", name="probe", points=SQUARE, finger_holes=[source_hole], interior_rings=[])
    placed = PlacedTool(
        id="pt1", tool_id="t1", name="probe",
        points=[Point(x=p.x + 100, y=p.y + 100) for p in SQUARE],
        finger_holes=[FingerHole(id=source_hole.id, x=1, y=1, depth_override=9.0)],
        interior_rings=[],
    )
    bin_data = BinModel(id="b1", bin_config=BinConfig(), placed_tools=[placed])

    class _Store:
        def get(self, key):
            return tool if key == "t1" else None

    sync_placed_tools(bin_data, _Store())

    (out,) = bin_data.placed_tools[0].finger_holes
    _assert_same_except(out, source_hole, "x", "y", "depth_override")
    assert out.depth_override == 9.0
