#!/bin/sh
set -e

# writable directories the app needs at runtime
DIRS="/app/storage /app/storage/uploads /app/storage/processed /app/storage/outputs /tmp/nginx /tmp/supervisor /app/.u2net"

for dir in $DIRS; do
    mkdir -p "$dir" 2>/dev/null || echo "warning: cannot create $dir" >&2
done

STORAGE_DIR="${STORAGE_PATH:-/app/storage}"

# when started with --user flag (non-root), skip remapping and run directly
if [ "$(id -u)" -ne 0 ]; then
    if [ -d "$STORAGE_DIR" ]; then
        if ! touch "$STORAGE_DIR/.write-check" 2>/dev/null; then
            echo "ERROR: storage directory $STORAGE_DIR is not writable by UID $(id -u)." >&2
            echo "If upgrading from a pre-rootless image, fix with:" >&2
            echo "  docker run --rm -v <your-volume>:/app/storage busybox chown -R $(id -u):$(id -g) /app/storage" >&2
            exit 1
        fi
        rm -f "$STORAGE_DIR/.write-check"
    fi
    exec "$@"
fi

# running as root -- remap tracefinity user/group if PUID/PGID are set.
# default: 1000:1000 (unchanged from image build).
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

CUR_UID=$(id -u tracefinity)
CUR_GID=$(id -g tracefinity)

if [ "$PGID" != "$CUR_GID" ]; then
    groupmod -o -g "$PGID" tracefinity
fi

if [ "$PUID" != "$CUR_UID" ]; then
    usermod -o -u "$PUID" tracefinity
fi

# chown storage only when ownership doesn't already match
if [ -d "$STORAGE_DIR" ]; then
    OWNER_UID=$(stat -c '%u' "$STORAGE_DIR" 2>/dev/null || stat -f '%u' "$STORAGE_DIR" 2>/dev/null)
    OWNER_GID=$(stat -c '%g' "$STORAGE_DIR" 2>/dev/null || stat -f '%g' "$STORAGE_DIR" 2>/dev/null)
    if [ "$OWNER_UID" != "$PUID" ] || [ "$OWNER_GID" != "$PGID" ]; then
        chown -R "$PUID:$PGID" "$STORAGE_DIR"
    fi
fi

# check storage is writable by the target user
if [ -d "$STORAGE_DIR" ]; then
    if ! gosu tracefinity touch "$STORAGE_DIR/.write-check" 2>/dev/null; then
        echo "ERROR: storage directory $STORAGE_DIR is not writable by UID $PUID." >&2
        echo "Fix with one of:" >&2
        echo "  docker run -e PUID=\$(id -u) -e PGID=\$(id -g) ..." >&2
        echo "  docker run --rm -v <your-volume>:/app/storage busybox chown -R $PUID:$PGID /app/storage" >&2
        exit 1
    fi
    rm -f "$STORAGE_DIR/.write-check"
fi

# drop to unprivileged user
exec gosu tracefinity "$@"
