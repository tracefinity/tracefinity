import subprocess
import sys
from unittest.mock import patch

import pytest

from app.services import onnx_check


@pytest.fixture(autouse=True)
def reset_cache():
    """clear the cached result between tests."""
    onnx_check._onnx_available = None
    yield
    onnx_check._onnx_available = None


class TestCheckCpuAvx:
    def test_linux_with_avx(self, tmp_path):
        cpuinfo = tmp_path / "cpuinfo"
        cpuinfo.write_text(
            "processor\t: 0\n"
            "flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic avx avx2\n"
        )
        assert onnx_check._check_cpu_avx(str(cpuinfo)) is True

    def test_linux_without_avx(self, tmp_path):
        cpuinfo = tmp_path / "cpuinfo"
        cpuinfo.write_text(
            "processor\t: 0\n"
            "flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sse4_2\n"
        )
        assert onnx_check._check_cpu_avx(str(cpuinfo)) is False

    def test_linux_cpuinfo_missing(self):
        assert onnx_check._check_cpu_avx("/nonexistent/cpuinfo") is None

    def test_macos_with_avx(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout="machdep.cpu.features: FPU VME SSE SSE2 AVX AVX2\n",
            )
            assert onnx_check._check_cpu_avx_macos() is True

    def test_macos_without_avx(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout="machdep.cpu.features: FPU VME SSE SSE2 SSE4.2\n",
            )
            assert onnx_check._check_cpu_avx_macos() is False

    def test_macos_sysctl_fails(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            assert onnx_check._check_cpu_avx_macos() is None


class TestSubprocessProbe:
    def test_probe_succeeds(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
            )
            assert onnx_check._probe_onnx_subprocess() is True

    def test_probe_fails_sigill(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=-4,  # SIGILL on linux
            )
            assert onnx_check._probe_onnx_subprocess() is False

    def test_probe_fails_nonzero(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=1,
            )
            assert onnx_check._probe_onnx_subprocess() is False

    def test_probe_timeout(self):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="", timeout=10)):
            assert onnx_check._probe_onnx_subprocess() is False

    def test_probe_not_installed(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=1,
            )
            assert onnx_check._probe_onnx_subprocess() is False


class TestIsOnnxAvailable:
    def test_cached_after_first_call(self):
        with patch.object(onnx_check, "_check_cpu_avx", return_value=True):
            result1 = onnx_check.is_onnx_available()
            assert result1 is True

        # second call should use cache, not re-check
        with patch.object(onnx_check, "_check_cpu_avx", return_value=False):
            result2 = onnx_check.is_onnx_available()
            assert result2 is True  # still cached

    def test_avx_present_skips_subprocess(self):
        with patch.object(onnx_check, "_check_cpu_avx", return_value=True) as cpu_check, \
             patch.object(onnx_check, "_probe_onnx_subprocess") as probe:
            result = onnx_check.is_onnx_available()
            assert result is True
            cpu_check.assert_called_once()
            probe.assert_not_called()

    def test_no_avx_returns_false(self):
        with patch.object(onnx_check, "_check_cpu_avx", return_value=False):
            result = onnx_check.is_onnx_available()
            assert result is False

    def test_cpu_check_indeterminate_falls_back_to_probe(self):
        with patch.object(onnx_check, "_check_cpu_avx", return_value=None), \
             patch.object(onnx_check, "_check_cpu_avx_macos", return_value=None), \
             patch.object(onnx_check, "_probe_onnx_subprocess", return_value=True) as probe:
            result = onnx_check.is_onnx_available()
            assert result is True
            probe.assert_called_once()

    def test_cpu_check_indeterminate_probe_fails(self):
        with patch.object(onnx_check, "_check_cpu_avx", return_value=None), \
             patch.object(onnx_check, "_check_cpu_avx_macos", return_value=None), \
             patch.object(onnx_check, "_probe_onnx_subprocess", return_value=False):
            result = onnx_check.is_onnx_available()
            assert result is False
