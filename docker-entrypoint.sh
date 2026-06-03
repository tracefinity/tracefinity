#!/bin/sh
set -e

# writable directories the app needs at runtime
DIRS="/app/storage /app/storage/uploads /app/storage/processed /app/storage/outputs /tmp/nginx /tmp/supervisor /app/.u2net"

for dir in $DIRS; do
    mkdir -p "$dir" 2>/dev/null || echo "warning: cannot create $dir" >&2
done

exec "$@"
