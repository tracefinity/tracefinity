from __future__ import annotations

import logging
import os
import site
from pathlib import Path

logger = logging.getLogger(__name__)
_DLL_DIRS_ADDED = False
_DLL_DIR_HANDLES = []


def _add_nvidia_dll_dirs():
    """Make NVIDIA wheel DLLs visible to CUDA/cuDNN on Windows."""
    global _DLL_DIRS_ADDED
    if _DLL_DIRS_ADDED or os.name != "nt":
        return

    roots = [Path(p) for p in site.getsitepackages()]
    user_site = site.getusersitepackages()
    if user_site:
        roots.append(Path(user_site))

    for root in roots:
        nvidia_root = root / "nvidia"
        for rel in (
            ("cublas", "bin"),
            ("cuda_nvrtc", "bin"),
            ("cuda_runtime", "bin"),
            ("cudnn", "bin"),
            ("cufft", "bin"),
            ("curand", "bin"),
            ("nvjitlink", "bin"),
        ):
            dll_dir = nvidia_root.joinpath(*rel)
            if dll_dir.exists():
                _DLL_DIR_HANDLES.append(os.add_dll_directory(str(dll_dir)))
                os.environ["PATH"] = f"{dll_dir}{os.pathsep}{os.environ.get('PATH', '')}"
                logger.debug("added NVIDIA DLL directory: %s", dll_dir)

    _DLL_DIRS_ADDED = True


def _preload_onnxruntime_cuda_dlls():
    """Preload CUDA/cuDNN DLLs when onnxruntime-gpu provides the helper."""
    try:
        import onnxruntime as ort
    except ImportError:
        return

    preload = getattr(ort, "preload_dlls", None)
    if preload is None:
        return

    try:
        _add_nvidia_dll_dirs()
        # Empty string means "search NVIDIA CUDA/cuDNN site-packages first".
        preload(directory="")
    except Exception as exc:
        logger.warning("failed to preload ONNX Runtime CUDA DLLs: %s", exc)


def get_onnx_providers(require_gpu: bool = False):
    """Return ONNX Runtime providers for local segmentation models.

    TRACEFINITY_ONNX_PROVIDER controls selection:
    - auto: CUDA if available, otherwise CPU
    - cuda: require CUDAExecutionProvider
    - cpu: CPUExecutionProvider only
    """
    import onnxruntime as ort

    requested = os.getenv("TRACEFINITY_ONNX_PROVIDER", "auto").lower()
    if requested not in {"auto", "cuda", "cpu"}:
        raise ValueError("TRACEFINITY_ONNX_PROVIDER must be one of: auto, cuda, cpu")

    if requested == "cpu":
        return ["CPUExecutionProvider"]

    _add_nvidia_dll_dirs()
    _preload_onnxruntime_cuda_dlls()
    available = set(ort.get_available_providers())
    if "CUDAExecutionProvider" in available:
        logger.info("using ONNX Runtime CUDAExecutionProvider for local models")
        return [
            (
                "CUDAExecutionProvider",
                {
                    "device_id": 0,
                    "cudnn_conv_algo_search": "DEFAULT",
                    "cudnn_conv_use_max_workspace": "1",
                    "do_copy_in_default_stream": "1",
                },
            ),
            "CPUExecutionProvider",
        ]

    if requested == "cuda" or require_gpu:
        raise RuntimeError(
            "CUDAExecutionProvider is not available. Install onnxruntime-gpu[cuda,cudnn] "
            "and make sure your NVIDIA driver supports CUDA 12."
        )

    logger.info("using ONNX Runtime CPUExecutionProvider for local models")
    return ["CPUExecutionProvider"]
