import os
import sys
from pathlib import Path

from app.config import settings
from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon

# add moritzmhmk gridfinity library to path if configured
if settings.gridfinity_lib_path:
    sys.path.insert(0, settings.gridfinity_lib_path)
elif os.path.exists('/tmp/moritzmhmk-gf/src'):
    sys.path.insert(0, '/tmp/moritzmhmk-gf/src')

GF_GRID = 42.0
GF_HEIGHT_UNIT = 7.0

# magnet hole dimensions (gridfinity standard)
MAGNET_DIAMETER = 6.0
MAGNET_DEPTH = 2.4
MAGNET_INSET = 4.8  # from cell corner


class STLGenerator:
    def generate_bin(
        self,
        polygons: list[ScaledPolygon],
        config: GenerateRequest,
        output_path: str,
    ) -> None:
        """generate gridfinity bin with tool cutouts"""
        try:
            self._generate_with_gridfinity(polygons, config, output_path)
        except ImportError:
            self._generate_fallback(polygons, config, output_path)
        except Exception:
            self._generate_fallback(polygons, config, output_path)

    def _generate_with_gridfinity(
        self,
        polygons: list[ScaledPolygon],
        config: GenerateRequest,
        output_path: str,
    ) -> None:
        """generate using moritzmhmk gridfinity library"""
        import gridfinity as gf
        from build123d import (
            Box,
            BuildPart,
            BuildSketch,
            Cylinder,
            Location,
            Locations,
            Mode,
            Plane,
            Polygon as B123dPolygon,
            Sphere,
            add,
            extrude,
            export_stl,
        )

        # create grid array
        grid = [[True] * config.grid_x for _ in range(config.grid_y)]
        height = config.height_units * GF_HEIGHT_UNIT

        # create base bin
        stacking_lip = "default" if config.stacking_lip else None
        compartment = gf.Compartment(grid, height - GF_HEIGHT_UNIT) if not polygons else None

        bin_part = gf.Bin(
            grid=grid,
            height=height,
            compartment=compartment,
            stacking_lip=stacking_lip,
        )

        with BuildPart() as bp:
            add(bin_part)

            # magnet holes at corners of each grid cell (gridfinity standard: 6mm x 2.4mm)
            if config.magnets:
                from build123d import GridLocations, Align
                # magnet spacing: 26mm apart, 4 per cell
                with gf.utils.IrregularGridLocations(GF_GRID, GF_GRID, grid):
                    with GridLocations(26, 26, 2, 2):
                        Cylinder(
                            MAGNET_DIAMETER / 2,
                            MAGNET_DEPTH,
                            align=(Align.CENTER, Align.CENTER, Align.MIN),
                            mode=Mode.SUBTRACT
                        )

            # tool cutouts
            if polygons:
                # polygons are positioned in bin coordinate system (origin top-left)
                # STL has bin centered at (0,0), so offset by half bin dimensions
                bin_width = config.grid_x * GF_GRID
                bin_height = config.grid_y * GF_GRID
                offset_x = -bin_width / 2
                offset_y = -bin_height / 2

                bin_bb = bin_part.bounding_box()
                top_z = bin_bb.max.Z
                floor_z = 4.75 + GF_HEIGHT_UNIT
                max_depth = top_z - floor_z - 2
                pocket_depth = min(config.cutout_depth, max_depth)
                if pocket_depth < 5:
                    pocket_depth = 5

                for i, poly in enumerate(polygons):
                    shifted = [(p[0] + offset_x, p[1] + offset_y) for p in poly.points_mm]
                    shifted = list(reversed(shifted))

                    try:
                        with BuildSketch(Plane.XY.offset(top_z - pocket_depth)):
                            B123dPolygon(shifted, align=None)
                        extrude(amount=pocket_depth + 1, mode=Mode.SUBTRACT)
                    except Exception:
                        pass  # skip invalid polygons

                    for j, fh in enumerate(poly.finger_holes):
                        try:
                            fh_x = fh.x_mm + offset_x
                            fh_y = fh.y_mm + offset_y
                            shape = getattr(fh, 'shape', 'circle')
                            rotation = getattr(fh, 'rotation', 0.0)

                            if shape == 'circle':
                                with Locations([(fh_x, fh_y, top_z)]):
                                    Sphere(pocket_depth, mode=Mode.SUBTRACT)
                            elif shape == 'square':
                                size = fh.radius_mm * 2
                                with Locations([Location((fh_x, fh_y, top_z), (0, 0, rotation))]):
                                    Box(size, size, pocket_depth * 2, mode=Mode.SUBTRACT)
                            elif shape == 'rectangle':
                                w = fh.width_mm if fh.width_mm else fh.radius_mm * 2
                                h = fh.height_mm if fh.height_mm else fh.radius_mm * 2
                                with Locations([Location((fh_x, fh_y, top_z), (0, 0, rotation))]):
                                    Box(w, h, pocket_depth * 2, mode=Mode.SUBTRACT)
                        except Exception:
                            pass  # skip invalid cutouts

        export_stl(bp.part, output_path)

    def _generate_fallback(
        self,
        polygons: list[ScaledPolygon],
        config: GenerateRequest,
        output_path: str,
    ) -> None:
        """fallback: simple box"""
        import numpy as np
        from stl import mesh

        bin_x = config.grid_x * GF_GRID - 0.5
        bin_y = config.grid_y * GF_GRID - 0.5
        bin_z = config.height_units * GF_HEIGHT_UNIT + 5
        wall = 1.2
        floor_z = 5

        hx, hy = bin_x / 2, bin_y / 2
        ihx, ihy = hx - wall, hy - wall

        vertices = np.array([
            [-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0],
            [-hx, -hy, bin_z], [hx, -hy, bin_z],
            [hx, hy, bin_z], [-hx, hy, bin_z],
            [-ihx, -ihy, floor_z], [ihx, -ihy, floor_z],
            [ihx, ihy, floor_z], [-ihx, ihy, floor_z],
            [-ihx, -ihy, bin_z], [ihx, -ihy, bin_z],
            [ihx, ihy, bin_z], [-ihx, ihy, bin_z],
        ])

        faces = np.array([
            [0, 3, 1], [1, 3, 2],
            [0, 1, 5], [0, 5, 4],
            [1, 2, 6], [1, 6, 5],
            [2, 3, 7], [2, 7, 6],
            [3, 0, 4], [3, 4, 7],
            [4, 5, 13], [4, 13, 12],
            [5, 6, 14], [5, 14, 13],
            [6, 7, 15], [6, 15, 14],
            [7, 4, 12], [7, 12, 15],
            [12, 13, 9], [12, 9, 8],
            [13, 14, 10], [13, 10, 9],
            [14, 15, 11], [14, 11, 10],
            [15, 12, 8], [15, 8, 11],
            [8, 9, 10], [8, 10, 11],
        ])

        bin_mesh = mesh.Mesh(np.zeros(faces.shape[0], dtype=mesh.Mesh.dtype))
        for i, f in enumerate(faces):
            for j in range(3):
                bin_mesh.vectors[i][j] = vertices[f[j], :]

        bin_mesh.save(output_path)
