#!/bin/sh
# tests for docker-entrypoint.sh PUID/PGID logic.
# run inside the docker image: docker run --rm --entrypoint sh <image> /app/tests/test_entrypoint.sh
set -e

PASS=0
FAIL=0
ENTRYPOINT="docker-entrypoint.sh"

# find entrypoint
if [ -f "/usr/local/bin/$ENTRYPOINT" ]; then
    ENTRYPOINT="/usr/local/bin/$ENTRYPOINT"
elif [ -f "./$ENTRYPOINT" ]; then
    ENTRYPOINT="./$ENTRYPOINT"
else
    echo "SKIP: $ENTRYPOINT not found (run inside docker image)"
    exit 0
fi

assert_eq() {
    desc="$1"; expected="$2"; actual="$3"
    if [ "$expected" = "$actual" ]; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc"
    else
        FAIL=$((FAIL + 1))
        echo "  FAIL: $desc (expected=$expected actual=$actual)"
    fi
}

# need root for usermod/groupmod tests
if [ "$(id -u)" -ne 0 ]; then
    echo "SKIP: must run as root to test PUID/PGID remapping"
    exit 0
fi

# need gosu
if ! command -v gosu >/dev/null 2>&1; then
    echo "SKIP: gosu not installed (run inside docker image)"
    exit 0
fi

# need the tracefinity user
if ! id tracefinity >/dev/null 2>&1; then
    echo "SKIP: tracefinity user not found (run inside docker image)"
    exit 0
fi

reset_user() {
    usermod -o -u 1000 tracefinity 2>/dev/null || true
    groupmod -o -g 1000 tracefinity 2>/dev/null || true
}

echo "=== test: default mode (no PUID/PGID) ==="
reset_user
unset PUID PGID

OUTPUT=$($ENTRYPOINT id -u 2>/dev/null)
assert_eq "default UID is 1000" "1000" "$OUTPUT"

OUTPUT=$($ENTRYPOINT id -g 2>/dev/null)
assert_eq "default GID is 1000" "1000" "$OUTPUT"

echo "=== test: PUID/PGID remapping ==="
reset_user
export PUID=99
export PGID=100

OUTPUT=$($ENTRYPOINT id -u 2>/dev/null)
assert_eq "remapped UID is 99" "99" "$OUTPUT"

OUTPUT=$($ENTRYPOINT id -g 2>/dev/null)
assert_eq "remapped GID is 100" "100" "$OUTPUT"

echo "=== test: storage ownership ==="
reset_user
TESTDIR=$(mktemp -d)
export STORAGE_PATH="$TESTDIR"
mkdir -p "$TESTDIR/uploads"
chown -R root:root "$TESTDIR"

export PUID=99
export PGID=100
$ENTRYPOINT true 2>/dev/null

OWNER=$(stat -c '%u:%g' "$TESTDIR" 2>/dev/null || stat -f '%u:%g' "$TESTDIR" 2>/dev/null)
assert_eq "storage chowned to 99:100" "99:100" "$OWNER"

echo "=== test: chown skipped when already correct ==="
# storage already 99:100 from previous test, run again
$ENTRYPOINT true 2>/dev/null
OWNER=$(stat -c '%u:%g' "$TESTDIR" 2>/dev/null || stat -f '%u:%g' "$TESTDIR" 2>/dev/null)
assert_eq "storage still 99:100 after no-op re-run" "99:100" "$OWNER"

rm -rf "$TESTDIR"
unset STORAGE_PATH PUID PGID

echo "=== test: idempotent remapping ==="
reset_user
export PUID=1000
export PGID=1000

OUTPUT=$($ENTRYPOINT id -u 2>/dev/null)
assert_eq "PUID=1000 stays 1000" "1000" "$OUTPUT"
unset PUID PGID

echo ""
echo "results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
