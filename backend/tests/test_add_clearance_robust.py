"""add_clearance must not silently skip clearance for awkward outlines.

The trigger: make_valid splitting the shape into disjoint pieces that stay
disjoint after buffering (e.g. an interior ring dragged outside the outline).
The old code fell back to the unbuffered original, printing with zero clearance.
"""
import pytest
from shapely.geometry import Polygon as SP

from app.services.polygon_scaler import PolygonScaler, ScaledPolygon


@pytest.fixture
def scaler():
    return PolygonScaler()


def test_orphan_interior_ring_does_not_skip_clearance(scaler):
    square = [(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]
    orphan = [(60.0, 60.0), (70.0, 60.0), (70.0, 70.0), (60.0, 70.0)]
    poly = ScaledPolygon("t", square, "t", interior_rings_mm=[orphan])

    result = scaler.add_clearance(poly, 1.0)
    out = SP(result.points_mm, holes=result.interior_rings_mm or [])

    assert out.is_valid, "result must be a valid polygon"
    # the main body must carry the requested clearance
    assert out.contains(SP(square).buffer(0.95))


def test_self_intersecting_outline_keeps_clearance(scaler):
    # bowtie with unequal lobes; buffering merges the touching pieces
    bowtie = [(0.0, 0.0), (60.0, 0.0), (0.0, 30.0), (20.0, 30.0)]
    poly = ScaledPolygon("t", bowtie, "t")

    result = scaler.add_clearance(poly, 1.0)
    out = SP(result.points_mm)

    assert out.is_valid
    # largest repaired lobe: triangle (0,0) (60,0) (15,22.5)
    lobe = SP([(0.0, 0.0), (60.0, 0.0), (15.0, 22.5)])
    assert out.buffer(0.05).contains(lobe.buffer(0.9))


def test_valid_polygon_buffered_normally(scaler):
    square = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]
    poly = ScaledPolygon("t", square, "t")

    result = scaler.add_clearance(poly, 1.0)
    out = SP(result.points_mm)

    assert out.contains(SP(square).buffer(0.95))
    # mitre join keeps corners sharp, so compare against a mitre-buffered bound
    assert out.within(SP(square).buffer(1.05, join_style=2))
