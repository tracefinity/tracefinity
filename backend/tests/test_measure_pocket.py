import pytest

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import ManifoldSTLGenerator
from tests.measure_pocket import measure


def test_physical_fit_check_rejects_cut_corners_even_when_dimensions_match(tmp_path):
    # An 80 x 30 mm pocket with 5 mm cut corners has the right overall size,
    # but the actual rectangular tool cannot fit inside it.
    points = [(-35, -15), (35, -15), (40, -10), (40, 10),
              (35, 15), (-35, 15), (-40, 10), (-40, -10)]
    polygon = ScaledPolygon("cut-corners", [(x + 63, y + 21) for x, y in points], "fixture")
    path = tmp_path / "cut-corners.stl"
    config = GenerateRequest(grid_x=3, grid_y=1, height_units=4, cutout_depth=20,
                             cutout_clearance=0, cutout_chamfer=0, magnets=False)
    ManifoldSTLGenerator().generate_bin([polygon], config, str(path))

    measured = measure(path, clearance=0)
    assert measured["dimensions_mm"] == pytest.approx([30, 80], abs=.001)
    assert not measured["contains_physical_tool"]
    assert measured["minimum_clearance_mm"] == 0
