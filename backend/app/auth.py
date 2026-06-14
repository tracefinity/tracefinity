from __future__ import annotations

import re

from fastapi import HTTPException, Request

# only allow uuid-formatted user ids to prevent path traversal
_USER_ID_RE = re.compile(r"^[a-f0-9-]{36}$")


async def get_user_id(request: Request) -> str:
    raw = request.headers.get("x-user-id")
    if not raw:
        return "default"
    if not _USER_ID_RE.match(raw):
        raise HTTPException(status_code=400, detail="invalid user id format")
    return raw
