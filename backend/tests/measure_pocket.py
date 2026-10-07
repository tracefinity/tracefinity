"""Measure the browser's downloaded fixture STL, independent of saved tool data."""

import json
import sys

import cv2
import numpy as np
import trimesh
from shapely.geometry import Polygon, box


def measure(path, clearance=1.0):
    mesh = trimesh.load(path, force="mesh")
    assert mesh.is_watertight, "downloaded bin must be watertight"
    # The browser creates a default 4u bin. This plane is below its lip and
    # above both the pocket floor and the base's magnet recesses.
    section = mesh.section(plane_origin=[0, 0, 25], plane_normal=[0, 0, 1])
    assert section is not None, "expected a cavity through z=25 mm"
    loops = sorted([Polygon(loop[:, :2]) for loop in section.discrete], key=lambda p: p.area)
    assert len(loops) == 2, "expected one exterior and one enclosed tool pocket"
    pocket = loops[0]
    dimensions = sorted(cv2.minAreaRect(np.array(pocket.exterior.coords, np.float32))[1])
    x0, y0, x1, y1 = pocket.bounds
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # Known 80 x 30 mm source, plus the requested clearance.
    half_length, half_width = 40, 15
    reference = box(cx - half_length - clearance, cy - half_width - clearance,
                    cx + half_length + clearance, cy + half_width + clearance)
    physical_tool = box(cx - half_length, cy - half_width, cx + half_length, cy + half_width)
    return {
        "dimensions_mm": dimensions,
        "boundary_error_mm": pocket.hausdorff_distance(reference),
        "contains_physical_tool": pocket.covers(physical_tool),
        "minimum_clearance_mm": pocket.boundary.distance(physical_tool),
    }


if __name__ == "__main__":
    print(json.dumps(measure(sys.argv[1], *(float(arg) for arg in sys.argv[2:]))))
