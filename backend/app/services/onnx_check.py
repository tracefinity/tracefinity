"""detect whether onnxruntime can run on this CPU.

belt and braces: fast cpu flag check, then subprocess probe as fallback.
result is cached at startup so the check runs once.
"""
from __future__ import annotations

import logging
import platform
import subprocess
import sys

logger = logging.getLogger(__name__)

_onnx_available: bool | None = None


def _check_cpu_avx(cpuinfo_path: str = "/proc/cpuinfo") -> bool | None:
    """check /proc/cpuinfo for avx flag (linux only).

    returns True if avx found, False if flags line exists but no avx,
    None if the file can't be read (not linux, or no access).
    """
    try:
        with open(cpuinfo_path) as f:
            for line in f:
                if line.startswith("flags"):
                    flags = line.split(":", 1)[1].split()
                    return "avx" in flags
    except (OSError, IOError):
        return None
    return None


def _check_cpu_avx_macos() -> bool | None:
    """check sysctl for avx flag on macos.

    returns True/False/None same as _check_cpu_avx.
    """
    try:
        result = subprocess.run(
            ["sysctl", "machdep.cpu.features"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            features = result.stdout.upper().split(":", 1)
            if len(features) == 2:
                return "AVX" in features[1].split()
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass
    return None


def _probe_onnx_subprocess() -> bool:
    """spawn a child process that tries to import onnxruntime.

    catches SIGILL without killing the main process. this is the
    robust fallback for any onnx incompatibility beyond avx.
    """
    try:
        result = subprocess.run(
            [sys.executable, "-c",
             "import onnxruntime; onnxruntime.get_available_providers()"],
            capture_output=True, timeout=30,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def is_onnx_available() -> bool:
    """check if onnxruntime can safely run on this cpu.

    uses a two-tier strategy:
    1. cpu flag check (fast, no subprocess)
    2. subprocess probe (catches SIGILL without killing main process)

    result is cached after first call.
    """
    global _onnx_available
    if _onnx_available is not None:
        return _onnx_available

    # tier 1: cpu flag check
    avx = _check_cpu_avx()
    if avx is None and platform.system() == "Darwin":
        avx = _check_cpu_avx_macos()

    if avx is True:
        logger.debug("cpu avx support confirmed via flags")
        _onnx_available = True
        return True

    if avx is False:
        logger.warning(
            "ONNX runtime not available (no AVX support). "
            "Paper detection will use OpenCV-only mode. "
            "Tool tracing requires a remote provider (gemini/replicate/fal)."
        )
        _onnx_available = False
        return False

    # tier 2: cpu flags indeterminate, try subprocess probe
    logger.debug("cpu avx check indeterminate, probing onnxruntime via subprocess")
    available = _probe_onnx_subprocess()
    if not available:
        logger.warning(
            "ONNX runtime not available (subprocess probe failed). "
            "Paper detection will use OpenCV-only mode. "
            "Tool tracing requires a remote provider (gemini/replicate/fal)."
        )
    _onnx_available = available
    return available
