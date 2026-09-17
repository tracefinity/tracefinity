"""Regression for #223: the prompt sent to the dimension-accurate Gemini
models asked for one tool, while the contour tracer emits one polygon per
object. Prompt wording must not be keyed off the alignment set either."""

import app.services.ai_tracer as tracer_module
from app.services.ai_tracer import AITracer


def _prompt(model: str) -> str:
    return AITracer(model=model)._mask_prompt(640, 480).lower()


def test_pro_prompt_asks_for_every_object():
    p = _prompt("gemini-3-pro-image-preview")
    assert any(phrase in p for phrase in ("every tool", "every object", "each tool", "each object"))
    assert "640x480" in p


def test_default_local_model_gets_the_same_multi_object_prompt():
    assert _prompt("gemini-3.1-flash-image-preview") == _prompt("gemini-3-pro-image-preview")


def test_flash_2_5_gets_stencil_prompt():
    assert "stencil" in _prompt("gemini-2.5-flash-image")


def test_prompt_choice_does_not_depend_on_alignment_set(monkeypatch):
    monkeypatch.setattr(tracer_module, "_NEEDS_ALIGNMENT", {"gemini-3-pro-image-preview"})
    assert "stencil" not in _prompt("gemini-3-pro-image-preview")
