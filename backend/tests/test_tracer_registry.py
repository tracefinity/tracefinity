"""Tests for tracer registry ids, labels and classification."""

import pytest

from app.services.tracer_registry import (
    REMOTE_TRACERS,
    SUPPORTED_TRACERS,
    TRACER_LABELS,
    tracer_kind,
    validate_tracer_ids,
)


def test_remote_tracers_are_supported_and_labelled():
    assert {"replicate", "fal"} <= SUPPORTED_TRACERS
    assert REMOTE_TRACERS == frozenset({"replicate", "fal"})
    assert TRACER_LABELS["replicate"] == "Replicate"
    assert TRACER_LABELS["fal"] == "fal.ai"


def test_validate_accepts_remote_tracers():
    assert validate_tracer_ids(["replicate", "fal"]) == ["replicate", "fal"]


def test_validate_still_rejects_unknown():
    with pytest.raises(ValueError, match="unsupported tracer"):
        validate_tracer_ids(["replicate", "nope"])


def test_validate_rejects_mixed_valid_and_unknown():
    with pytest.raises(ValueError, match="unsupported tracer"):
        validate_tracer_ids(["isnet", "nope"])


def test_tracer_kind_classifies():
    assert tracer_kind("gemini") == "gemini"
    assert tracer_kind("replicate") == "remote"
    assert tracer_kind("fal") == "remote"
    assert tracer_kind("isnet") == "local"
    assert tracer_kind("inspyrenet") == "local"
