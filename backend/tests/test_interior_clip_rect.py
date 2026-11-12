"""Keep bin auto-sizing aligned with the stock wall and stacking lip."""

import pytest

from app.services.bin_profiles import bin_interior_inset


@pytest.mark.parametrize(
    "wall, lip, expected",
    [(1.2, True, 2.6), (1.2, False, 1.2), (3.0, True, 3.0)],
)
def test_auto_size_reserves_the_larger_inset(wall, lip, expected):
    assert bin_interior_inset(wall, lip) == pytest.approx(expected)
