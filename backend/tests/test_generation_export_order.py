import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.config import ensure_user_dirs
from app.main import app
from app.models.schemas import BinConfig, BinModel, GenerateRequest, PlacedTool, Point, Polygon, Session
from app.services.generation_lock import generation_lock
from app.services.store_errors import StoreClosedError
from tests.measure_pocket import measure


@pytest.mark.parametrize("kind", ["bin", "session"])
def test_late_generation_cannot_replace_newer_geometry(tmp_path, monkeypatch, kind):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    monkeypatch.setattr(routes, "_stl_generation_semaphore", None)
    ensure_user_dirs(tmp_path / "default")
    sessions, _, bins = routes.get_stores("default")
    config = BinConfig(grid_x=3, grid_y=1, height_units=4, cutout_depth=20,
                       cutout_clearance=1, cutout_chamfer=0, magnets=False)
    points = [Point(x=x, y=y) for x, y in [(23, 6), (103, 6), (103, 36), (23, 36)]]
    bins.set("race", BinModel(id="race", bin_config=config, placed_tools=[PlacedTool(
        id="rectangle", tool_id="synthetic", name="80x30",
        points=points,
    )]))
    sessions.set("race", Session(id="race", scale_factor=1,
                                 polygons=[Polygon(id="rectangle", label="80x30", points=points)]))

    old_entered = threading.Event()
    release_old = threading.Event()
    newer_waiting = threading.Event()
    generate = routes.stl_generator.generate_bin

    def delayed(polygons, request, *args):
        if request.cutout_clearance == 1:
            old_entered.set()
            assert release_old.wait(5)
        return generate(polygons, request, *args)

    def observed_lock(user_path, entity_id):
        lock = generation_lock(user_path, entity_id)
        if old_entered.is_set():
            assert lock.locked(), "the first export must still own the lock"
            newer_waiting.set()
        return lock

    monkeypatch.setattr(routes, "generation_lock", observed_lock)
    monkeypatch.setattr(routes.stl_generator, "generate_bin", delayed)
    with TestClient(app) as client, ThreadPoolExecutor(2) as pool:
        def generate_request(params):
            if kind == "bin":
                return client.post("/api/bins/race/generate")
            return client.post("/api/sessions/race/generate", json=params.model_dump())

        old = pool.submit(generate_request, config)
        assert old_entered.wait(5)
        current = config.model_copy(update={"cutout_clearance": .1})
        assert client.put("/api/bins/race", json={"bin_config": current.model_dump()}).status_code == 200

        newer = pool.submit(generate_request, current)
        try:
            # Wait until the second request reaches the occupied lock, rather
            # than guessing how quickly its STL generation would finish.
            assert newer_waiting.wait(5)
            assert not newer.done()
        finally:
            release_old.set()
        assert old.result(timeout=5).status_code == 200
        assert newer.result(timeout=5).status_code == 200
        download = client.get("/api/files/bins/race/bin.stl" if kind == "bin" else "/api/files/race/bin.stl")
        assert download.status_code == 200
        path = tmp_path / "download.stl"
        path.write_bytes(download.content)

    measured = measure(path, .1)
    assert measured["dimensions_mm"] == pytest.approx([30.2, 80.2], abs=.05)
    assert measured["boundary_error_mm"] < .05


@pytest.mark.parametrize("kind", ["bin", "session"])
def test_queued_generation_keeps_the_store_deletion_guard(tmp_path, monkeypatch, kind):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes, "_store_cache", {})
    ensure_user_dirs(tmp_path / "default")
    stores = routes.get_stores("default")
    captured = threading.Event()

    def get_stores(user_id):
        captured.set()
        return stores

    monkeypatch.setattr(routes, "get_stores", get_stores)

    def run():
        if kind == "bin":
            return routes.generate_bin_stl(None, "race", "default")
        return routes.generate_stl(None, "race", GenerateRequest(), "default")

    with ThreadPoolExecutor(1) as pool:
        with generation_lock(tmp_path / "default", "race"):
            request = pool.submit(run)
            assert captured.wait(2)
            for store in stores:
                store.close()
            routes._store_cache.clear()
        with pytest.raises(StoreClosedError):
            request.result(timeout=2)


@pytest.mark.parametrize("other_user,other_entity", [("default", "other-bin"), ("other-user", "same-bin")])
def test_unrelated_exports_can_generate_concurrently(tmp_path, other_user, other_entity):
    def run():
        with generation_lock(tmp_path / other_user, other_entity):
            return "acquired"

    with ThreadPoolExecutor(1) as pool:
        with generation_lock(tmp_path / "default", "same-bin"):
            assert pool.submit(run).result(timeout=2) == "acquired"
