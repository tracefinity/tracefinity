"""Tests for tracer availability configuration."""

import pytest

from app.config import Settings


def test_default_local_tracers_exclude_gpu_only_birefnet_general():
    settings = Settings(_env_file=None)

    assert settings.available_tracers == ["isnet", "birefnet-lite", "inspyrenet"]
    assert "birefnet-general" not in settings.available_tracers


def test_birefnet_general_can_be_enabled_explicitly():
    settings = Settings(_env_file=None, tracers="birefnet-general,birefnet-lite,isnet")

    assert settings.available_tracers == ["birefnet-general", "birefnet-lite", "isnet"]


def test_cloud_key_still_prefers_gemini_when_tracers_unset():
    settings = Settings(_env_file=None, google_api_key="test-key")

    assert settings.available_tracers == ["gemini"]


def test_invalid_tracer_config_fails_fast():
    settings = Settings(_env_file=None, tracers="birefnet-lite,typo")

    with pytest.raises(ValueError, match="unsupported tracer"):
        settings.available_tracers
