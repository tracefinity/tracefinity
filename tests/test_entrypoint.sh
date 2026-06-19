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

# supervisor config tests run FIRST, before any entrypoint call mutates it
echo "=== test: supervisor config ships without user= directives ==="
SUPERVISOR_CONF="/etc/supervisor/conf.d/tracefinity.conf"
if [ -f "$SUPERVISOR_CONF" ]; then
    BEFORE_USER_COUNT=$(grep -c "^user=" "$SUPERVISOR_CONF" || true)
    assert_eq "no user= directives in shipped config" "0" "$BEFORE_USER_COUNT"
else
    echo "  SKIP: supervisor config not found"
fi

echo "=== test: entrypoint injects supervisor user directives when root ==="
if [ -f "$SUPERVISOR_CONF" ]; then
    reset_user
    unset PUID PGID
    TESTDIR=$(mktemp -d)
    export STORAGE_PATH="$TESTDIR"
    chown -R tracefinity:tracefinity "$TESTDIR"

    $ENTRYPOINT true 2>/dev/null

    for prog in nginx backend frontend; do
        HAS_USER=$(sed -n "/^\[program:$prog\]/,/^\[/p" "$SUPERVISOR_CONF" | grep -c "^user=tracefinity")
        assert_eq "[program:$prog] has user=tracefinity" "1" "$HAS_USER"
    done

    HAS_ROOT=$(sed -n '/^\[supervisord\]/,/^\[/p' "$SUPERVISOR_CONF" | grep -c "^user=root")
    assert_eq "[supervisord] has user=root" "1" "$HAS_ROOT"

    ROOT_COUNT=$(grep -c "^user=root" "$SUPERVISOR_CONF")
    assert_eq "user=root appears exactly once" "1" "$ROOT_COUNT"

    rm -rf "$TESTDIR"
    unset STORAGE_PATH
fi

echo "=== test: supervisor injection is idempotent ==="
if [ -f "$SUPERVISOR_CONF" ]; then
    reset_user
    unset PUID PGID
    TESTDIR=$(mktemp -d)
    export STORAGE_PATH="$TESTDIR"
    chown -R tracefinity:tracefinity "$TESTDIR"

    # run entrypoint again on already-injected config
    $ENTRYPOINT true 2>/dev/null

    ROOT_COUNT=$(grep -c "^user=root" "$SUPERVISOR_CONF")
    assert_eq "user=root still exactly once after re-run" "1" "$ROOT_COUNT"

    TRACEFINITY_COUNT=$(grep -c "^user=tracefinity" "$SUPERVISOR_CONF")
    assert_eq "user=tracefinity exactly 3 after re-run" "3" "$TRACEFINITY_COUNT"

    rm -rf "$TESTDIR"
    unset STORAGE_PATH
fi

echo "=== test: default mode (no PUID/PGID) ==="
reset_user
unset PUID PGID

OUTPUT=$(id -u tracefinity)
assert_eq "default tracefinity UID is 1000" "1000" "$OUTPUT"

OUTPUT=$(id -g tracefinity)
assert_eq "default tracefinity GID is 1000" "1000" "$OUTPUT"

echo "=== test: PUID/PGID remapping ==="
reset_user
export PUID=99
export PGID=100

$ENTRYPOINT true 2>/dev/null

OUTPUT=$(id -u tracefinity)
assert_eq "remapped UID is 99" "99" "$OUTPUT"

OUTPUT=$(id -g tracefinity)
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

$ENTRYPOINT true 2>/dev/null

OUTPUT=$(id -u tracefinity)
assert_eq "PUID=1000 stays 1000" "1000" "$OUTPUT"
unset PUID PGID

echo "=== test: gosu write-check uses target user ==="
reset_user
TESTDIR=$(mktemp -d)
export STORAGE_PATH="$TESTDIR"
chown -R tracefinity:tracefinity "$TESTDIR"
unset PUID PGID

$ENTRYPOINT true 2>/dev/null
assert_eq "write-check passed for tracefinity" "0" "$?"

rm -rf "$TESTDIR"
unset STORAGE_PATH

echo ""
echo "results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
