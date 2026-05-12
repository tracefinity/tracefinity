from __future__ import annotations

DEFAULT_LOCAL_TRACERS = ["isnet", "birefnet-lite", "inspyrenet"]

REMBG_MODELS = {
    "birefnet-general": "birefnet-general",
    "birefnet-lite": "birefnet-general-lite",
    "isnet": "isnet-general-use",
}

LOCAL_MODEL_LABELS = {
    "inspyrenet": "InSPyReNet",
    "birefnet-general": "BiRefNet General",
    "birefnet-lite": "BiRefNet Lite",
    "isnet": "IS-Net",
}

GPU_REQUIRED_TRACERS = frozenset({"birefnet-general"})

TRACER_LABELS = {
    "gemini": "Gemini API",
    **LOCAL_MODEL_LABELS,
}

SUPPORTED_TRACERS = frozenset(TRACER_LABELS)


def validate_tracer_ids(tracers: list[str]) -> list[str]:
    unknown = [tracer for tracer in tracers if tracer not in SUPPORTED_TRACERS]
    if unknown:
        supported = ", ".join(sorted(SUPPORTED_TRACERS))
        invalid = ", ".join(unknown)
        raise ValueError(
            f"TRACERS contains unsupported tracer(s): {invalid}. "
            f"Supported tracers: {supported}"
        )
    return tracers
