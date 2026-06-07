from typing import Literal


GF_GRID = 42.0

PaperSize = Literal["a4", "letter", "a3", "tabloid"]

PAPER_SIZES: dict[PaperSize, tuple[float, float]] = {
    "a4": (210, 297),
    "letter": (215.9, 279.4),
    "a3": (297, 420),
    "tabloid": (279.4, 431.8),
}
