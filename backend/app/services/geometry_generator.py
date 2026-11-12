"""Run the native geometry worker and package its tessellated materials."""

import json
import logging
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from app.config import settings
from app.services.geometry_inputs import build_job

logger = logging.getLogger(__name__)
STL_GEOMETRY_VERSION = 11


class GeometryError(ValueError):
    pass


class GeometryUnavailable(RuntimeError):
    pass


def _worker_path() -> Path:
    if settings.geometry_worker_path is not None:
        return settings.geometry_worker_path
    name = "tracefinity-geometry.exe" if sys.platform == "win32" else "tracefinity-geometry"
    return Path(__file__).resolve().parents[2] / "geometry" / "target" / "release" / name


def geometry_available() -> bool:
    return _worker_path().is_file()


class GeometryGenerator:
    def generate_bin(self, polygons, config, output_path, threemf_path):
        output = Path(output_path)
        with TemporaryDirectory(prefix="cad-", dir=output.parent) as directory:
            work = Path(directory)
            try:
                subprocess.run(
                    [str(_worker_path()), directory],
                    input=json.dumps(build_job(polygons, config), allow_nan=False),
                    text=True, capture_output=True, check=True, timeout=110,
                )
            except (FileNotFoundError, PermissionError) as exc:
                raise GeometryUnavailable("The Tracefinity geometry worker has not been built.") from exc
            except subprocess.TimeoutExpired as exc:
                raise GeometryError("Bin geometry took too long to generate.") from exc
            except subprocess.CalledProcessError as exc:
                logger.warning("native geometry failed: %s", exc.stderr.strip())
                raise GeometryError(f"Could not build bin geometry. {exc.stderr.strip()}") from exc

            (work / "bin.stl").replace(output)
            (work / "bin.step").replace(output.with_suffix(".step"))
            if (work / "insert.stl").is_file():
                for extension in ("stl", "step"):
                    (work / f"insert.{extension}").replace(output.with_name(f"{output.stem}_insert.{extension}"))

            part_paths = []
            for i, part in enumerate(sorted(work.glob("part*.stl")), start=1):
                path = output.with_name(f"{output.stem}_part{i}.stl")
                part.replace(path)
                part_paths.append(str(path))

            if (work / "labels.stl").is_file():
                self._write_3mf(work, Path(threemf_path))
        return part_paths

    @staticmethod
    def _write_3mf(work, destination):
        import trimesh

        scene = trimesh.Scene()
        for filename, name in (("material.stl", "bin"), ("labels.stl", "text")):
            scene.add_geometry(trimesh.load_mesh(work / filename), node_name=name, geom_name=name)
        destination.write_bytes(scene.export(file_type="3mf"))
