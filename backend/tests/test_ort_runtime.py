import sys
from types import SimpleNamespace

import pytest

from app.services import ort_runtime


def _fake_ort(providers):
    return SimpleNamespace(get_available_providers=lambda: providers)


@pytest.fixture(autouse=True)
def no_dll_preload(monkeypatch):
    monkeypatch.setattr(ort_runtime, "_add_nvidia_dll_dirs", lambda: None)
    monkeypatch.setattr(ort_runtime, "_preload_onnxruntime_cuda_dlls", lambda: None)


def test_invalid_provider_mode_raises(monkeypatch):
    monkeypatch.setenv("TRACEFINITY_ONNX_PROVIDER", "bogus")

    with pytest.raises(ValueError, match="auto, cuda, cpu"):
        ort_runtime.get_onnx_providers()


def test_cpu_mode_returns_cpu_provider_without_ort_import(monkeypatch):
    monkeypatch.setenv("TRACEFINITY_ONNX_PROVIDER", "cpu")

    assert ort_runtime.get_onnx_providers() == ["CPUExecutionProvider"]


def test_cpu_mode_rejected_for_gpu_required_tracer(monkeypatch):
    monkeypatch.setenv("TRACEFINITY_ONNX_PROVIDER", "cpu")

    with pytest.raises(RuntimeError, match="GPU-required"):
        ort_runtime.get_onnx_providers(require_gpu=True)


def test_auto_mode_uses_cpu_when_cuda_unavailable(monkeypatch):
    monkeypatch.delenv("TRACEFINITY_ONNX_PROVIDER", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        _fake_ort(["CPUExecutionProvider"]),
    )

    assert ort_runtime.get_onnx_providers() == ["CPUExecutionProvider"]


def test_auto_mode_uses_cuda_when_available(monkeypatch):
    monkeypatch.delenv("TRACEFINITY_ONNX_PROVIDER", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        _fake_ort(["CUDAExecutionProvider", "CPUExecutionProvider"]),
    )

    providers = ort_runtime.get_onnx_providers()

    assert providers[0][0] == "CUDAExecutionProvider"
    assert providers[1] == "CPUExecutionProvider"


def test_cuda_mode_requires_cuda_provider(monkeypatch):
    monkeypatch.setenv("TRACEFINITY_ONNX_PROVIDER", "cuda")
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        _fake_ort(["CPUExecutionProvider"]),
    )

    with pytest.raises(RuntimeError, match="CUDAExecutionProvider is not available"):
        ort_runtime.get_onnx_providers()
