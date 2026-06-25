"""Fire webhook callbacks asynchronously when a bin is generated."""

from __future__ import annotations

import logging
import threading
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WEBHOOK_TIMEOUT = 30  # seconds


def fire_webhook(
    webhook_url: str,
    payload: dict[str, Any],
) -> None:
    """POST *payload* to *webhook_url* in a daemon background thread.

    Network errors and non-2xx responses are logged but never raised to the
    caller — the generate response is not delayed or blocked.
    """

    def _post() -> None:
        try:
            with httpx.Client(timeout=WEBHOOK_TIMEOUT) as client:
                resp = client.post(
                    webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                if resp.is_success:
                    logger.info(
                        "webhook delivered to %s (status %s)",
                        webhook_url,
                        resp.status_code,
                    )
                else:
                    logger.warning(
                        "webhook to %s returned %s: %s",
                        webhook_url,
                        resp.status_code,
                        resp.text[:500],
                    )
        except Exception:
            logger.exception("webhook to %s failed", webhook_url)

    t = threading.Thread(target=_post, daemon=True)
    t.start()
