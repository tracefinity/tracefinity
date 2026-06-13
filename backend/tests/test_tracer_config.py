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


def test_replicate_token_auto_selects_replicate():
    settings = Settings(_env_file=None, replicate_api_token="r8_x")
    assert settings.available_tracers == ["replicate"]


def test_fal_key_auto_selects_fal():
    settings = Settings(_env_file=None, fal_key="fal_x")
    assert settings.available_tracers == ["fal"]


def test_both_remote_tokens_list_both_replicate_first():
    settings = Settings(_env_file=None, replicate_api_token="r8_x", fal_key="fal_x")
    assert settings.available_tracers == ["replicate", "fal"]


def test_llm_key_beats_remote_token():
    settings = Settings(_env_file=None, google_api_key="g", replicate_api_token="r8_x")
    assert settings.available_tracers == ["gemini"]


def test_explicit_tracers_beats_remote_token():
    settings = Settings(_env_file=None, tracers="isnet", fal_key="fal_x")
    assert settings.available_tracers == ["isnet"]


def test_primary_is_saliency_true_for_remote_and_local_false_for_gemini():
    assert Settings(_env_file=None, replicate_api_token="r8_x").primary_is_saliency is True
    assert Settings(_env_file=None).primary_is_saliency is True
    assert Settings(_env_file=None, google_api_key="g").primary_is_saliency is False
