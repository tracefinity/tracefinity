"""Read the real Rust generator's exported meshes for dimensional assertions."""

from pathlib import Path

import trimesh

from app.services.geometry_generator import GeometryGenerator


def render(polygons, config, path):
    path = Path(path)
    parts = GeometryGenerator().generate_bin(polygons, config, str(path), str(path.with_suffix(".3mf")))
    return trimesh.load_mesh(path), parts


def rings_at(mesh, z):
    section = mesh.section(plane_origin=(0, 0, z), plane_normal=(0, 0, 1))
    return [] if section is None else section.discrete
