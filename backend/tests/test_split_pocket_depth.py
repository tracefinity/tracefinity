"""Measure full STL and ZIP pocket depths after edits and overlapping exports."""

import io
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

from app.api import routes
from app.config import ensure_user_dirs
from app.main import app
from app.models.schemas import BinConfig, BinModel, PlacedTool, Point, Polygon, Session
from app.services.generation_lock import generation_lock


def _pocket_depth(data, wall_top=28):
    mesh = trimesh.load(io.BytesIO(data), file_type="stl", force="mesh")
    assert mesh.is_watertight
    x, y = mesh.bounds.mean(axis=0)[:2]
    triangles = mesh.triangles[mesh.face_normals[:, 2] > .99]
    samples = np.column_stack((np.full(len(triangles), x), np.full(len(triangles), y), triangles[:, 0, 2]))
    barycentric = trimesh.triangles.points_to_barycentric(triangles, samples)
    heights = triangles[np.all(barycentric >= -1e-6, axis=1), 0, 2]
    assert len(heights)
    assert np.ptp(heights) < 1e-5
    return wall_top - heights[0]


def _assert_download_depths(client, kind, expected):
    prefix = "/api/files/bins/depth" if kind == "bin" else "/api/files/depth"
    full = client.get(f"{prefix}/bin.stl")
    assert full.status_code == 200
    assert _pocket_depth(full.content) == pytest.approx(expected, abs=.01)
    download = client.get(f"{prefix}/bin_parts.zip")
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert len(archive.namelist()) == 2
        for name in archive.namelist():
            assert _pocket_depth(archive.read(name)) == pytest.approx(expected, abs=.01), name


@pytest.fixture
def split_bin_config(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    monkeypatch.setattr(routes, "_stl_generation_semaphore", None)
    ensure_user_dirs(tmp_path / "default")
    sessions, _, bins = routes.get_stores("default")
    config = BinConfig(grid_x=4, grid_y=1, height_units=4, cutout_depth=17.45,
                       cutout_chamfer=0, cutout_clearance=0, magnets=False, bed_size=84)
    tool = PlacedTool(id="rectangle", tool_id="synthetic", name="Rectangle", points=[
        Point(x=x, y=y) for x, y in [(10, 10), (158, 10), (158, 32), (10, 32)]
    ])
    bins.set("depth", BinModel(id="depth", bin_config=config, placed_tools=[tool]))
    sessions.set("depth", Session(id="depth", scale_factor=1, polygons=[
        Polygon(id="rectangle", label="Rectangle", points=tool.points),
    ]))
    return config


@pytest.mark.parametrize("override", [False, True], ids=["bin-depth", "tool-depth"])
def test_split_zip_preserves_saved_depth_and_cached_downloads(split_bin_config, override):
    config = split_bin_config
    with TestClient(app) as client:
        tools = client.get("/api/bins/depth").json()["placed_tools"]
        for depth in (17.45, 12, 12):
            if override:
                tools[0]["depth_override"] = depth
                update = {"placed_tools": tools}
            else:
                config.cutout_depth = depth
                update = {"bin_config": config.model_dump()}
            saved = client.put("/api/bins/depth", json=update)
            assert saved.status_code == 200, saved.text
            generated = client.post("/api/bins/depth/generate")
            assert generated.status_code == 200, generated.text
            assert generated.json()["split_count"] > 1
            _assert_download_depths(client, "bin", depth)


@pytest.mark.parametrize("kind", ["bin", "session"])
def test_late_split_cannot_replace_zip_with_previous_depth(split_bin_config, monkeypatch, kind):
    config = split_bin_config
    old_splitting = threading.Event()
    release_old = threading.Event()
    newer_waiting = threading.Event()
    split = routes.stl_generator.export_split_parts

    def hold_old_split(body, text, request, *args):
        if request.cutout_depth == 17.45:
            old_splitting.set()
            assert release_old.wait(5)
        return split(body, text, request, *args)

    def observed_lock(user_path, entity_id):
        lock = generation_lock(user_path, entity_id)
        if old_splitting.is_set():
            assert lock.locked(), "the old export must own the lock until splitting finishes"
            newer_waiting.set()
        return lock

    monkeypatch.setattr(routes.stl_generator, "export_split_parts", hold_old_split)
    monkeypatch.setattr(routes, "generation_lock", observed_lock)
    with TestClient(app) as client, ThreadPoolExecutor(2) as pool:
        def generate(params):
            if kind == "bin":
                return client.post("/api/bins/depth/generate")
            return client.post("/api/sessions/depth/generate", json=params.model_dump())

        old = pool.submit(generate, config)
        assert old_splitting.wait(5)
        current = config.model_copy(update={"cutout_depth": 12})
        saved = client.put("/api/bins/depth", json={"bin_config": current.model_dump()})
        assert saved.status_code == 200, saved.text
        newer = pool.submit(generate, current)
        try:
            assert newer_waiting.wait(5)
            assert not newer.done()
        finally:
            release_old.set()
        assert old.result(timeout=5).status_code == 200
        assert newer.result(timeout=5).status_code == 200
        _assert_download_depths(client, kind, 12)
