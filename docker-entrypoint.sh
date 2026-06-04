#!/bin/sh
set -e

# writable directories the app needs at runtime
DIRS="/app/storage /app/storage/uploads /app/storage/processed /app/storage/outputs /tmp/nginx /tmp/supervisor /app/.u2net"

for dir in $DIRS; do
    mkdir -p "$dir" 2>/dev/null || echo "warning: cannot create $dir" >&2
done

# check storage is readable/writable by the running user.
# pre-rootless volumes may be owned by root:0 -- surface this clearly
# rather than letting stores silently fail at load time.
STORAGE_DIR="${STORAGE_PATH:-/app/storage}"
if [ -d "$STORAGE_DIR" ]; then
    if ! touch "$STORAGE_DIR/.write-check" 2>/dev/null; then
        echo "ERROR: storage directory $STORAGE_DIR is not writable by UID $(id -u)." >&2
        echo "If upgrading from a pre-rootless image, fix with:" >&2
        echo "  docker run --rm -v <your-volume>:/app/storage busybox chown -R 1000:1000 /app/storage" >&2
        exit 1
    fi
    rm -f "$STORAGE_DIR/.write-check"
fi

exec "$@"
