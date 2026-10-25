"""The shipped deployment must not allow concurrent JSON-store writers (#155)."""

import configparser
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest
from uvicorn import Config
from uvicorn.main import main as uvicorn_cli

ROOT = Path(__file__).resolve().parents[2]


def test_container_worker_count_overrides_platform_default(monkeypatch):
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    dockerfile = (ROOT / "Dockerfile").read_text()
    supervisor = dockerfile.split("\n[supervisord]\n", 1)[1].split("\nSUPERVISOR_EOF", 1)[0]
    config = configparser.ConfigParser()
    config.read_string("[supervisord]\n" + supervisor)
    command = shlex.split(config["program:backend"]["command"])

    # Use Uvicorn's actual CLI parser and configuration precedence, without
    # importing the app or loading models. Removing the explicit flag makes
    # the platform's four-worker default win and this assertion fail.
    args = uvicorn_cli.make_context("uvicorn", command[1:]).params
    assert Config(args["app"], workers=args["workers"]).workers == 1


@pytest.mark.parametrize("replicas", [None, 0, 1, 2, 4])
def test_helm_prevents_multiple_writers(replicas):
    helm = shutil.which("helm")
    if not helm:
        pytest.skip("helm is required for chart rendering (installed in CI)")
    command = [helm, "template", "single-writer", str(ROOT / "chart")]
    if replicas is not None:
        command.extend(["--set", f"replicaCount={replicas}"])
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if replicas is not None and replicas > 1:
        assert result.returncode != 0
        assert "replicaCount" in result.stderr
        assert "#155" in result.stderr
    else:
        assert result.returncode == 0, result.stderr
        assert "type: Recreate" in result.stdout
        assert f"replicas: {1 if replicas is None else replicas}" in result.stdout
