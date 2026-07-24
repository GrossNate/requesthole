#!/usr/bin/env bash
#
# Smoke-test the Dockerized RequestHole stack through the Nginx origin.
#
# Brings the Compose stack up (build), then asserts — against the single
# published Nginx port — that every current behavior works end to end:
#   * POST /api/hole            -> 201, returns a fixed 6-char hole_address
#   * GET  /api/holes           -> includes the new address
#   * POST /:address  (collect) -> 200
#   * GET  /                    -> serves the SPA index.html
#   * a hashed static asset      -> loads with 200
#   * GET /api/hole/:addr/events -> streams a `data:` SSE event on capture
#   * compose down / up          -> holes survive a restart (the /data volume,
#                                   WAL sidecars included)
#
# Usage:
#   scripts/smoke-test.sh            # up --build, run checks, leave stack running
#   scripts/smoke-test.sh --down     # additionally `compose down` at the end
#   scripts/smoke-test.sh --no-build # skip the image rebuild (reuse running stack)
#
# Requires a running Docker daemon.
set -uo pipefail

cd "$(dirname "$0")/.."

WEB_PORT="${WEB_PORT:-8080}"
BASE="http://localhost:${WEB_PORT}"
DO_DOWN=0
DO_BUILD=1

for arg in "$@"; do
  case "$arg" in
    --down) DO_DOWN=1 ;;
    --no-build) DO_BUILD=0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

cleanup() {
  if [ "$DO_DOWN" -eq 1 ]; then
    echo "--- tearing down stack ---"
    docker compose down
  fi
}
trap cleanup EXIT

echo "=== bringing up the stack ==="
if [ "$DO_BUILD" -eq 1 ]; then
  docker compose up -d --build || { echo "compose up failed" >&2; exit 1; }
else
  docker compose up -d || { echo "compose up failed" >&2; exit 1; }
fi

echo "=== waiting for the Nginx origin at ${BASE} ==="
ready=0
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/holes" || true)
  if [ "$code" = "200" ]; then ready=1; break; fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "ERROR: origin never became ready (last GET /api/holes -> ${code:-none})" >&2
  docker compose ps
  exit 1
fi
echo "origin is up."

echo "=== running checks ==="

# 1) Create a hole -> 201 with a fixed 6-char address.
create_body=$(curl -s -w '\n%{http_code}' -X POST "${BASE}/api/hole")
create_code=$(printf '%s' "$create_body" | tail -n1)
create_json=$(printf '%s' "$create_body" | sed '$d')
addr=$(printf '%s' "$create_json" | sed -n 's/.*"hole_address":"\([a-zA-Z0-9]\{6\}\)".*/\1/p')
if [ "$create_code" = "201" ] && [ -n "$addr" ]; then
  pass "POST /api/hole -> 201 (address: ${addr})"
else
  fail "POST /api/hole -> ${create_code}, address='${addr}' (body: ${create_json})"
fi

# 2) The new address appears in GET /api/holes.
if [ -n "$addr" ]; then
  holes_json=$(curl -s "${BASE}/api/holes")
  if printf '%s' "$holes_json" | grep -q "\"$addr\""; then
    pass "GET /api/holes includes ${addr}"
  else
    fail "GET /api/holes missing ${addr} (body: ${holes_json})"
  fi
else
  fail "GET /api/holes — skipped, no address from step 1"
fi

# 3) Collect capture at the bare address -> 200.
if [ -n "$addr" ]; then
  collect_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/${addr}" \
    -H 'Content-Type: text/plain' --data 'smoke-test-body')
  if [ "$collect_code" = "200" ]; then
    pass "POST /${addr} (collect) -> 200"
  else
    fail "POST /${addr} (collect) -> ${collect_code}"
  fi
else
  fail "collect capture — skipped, no address"
fi

# 4) Root serves the SPA index.html.
root_html=$(curl -s "${BASE}/")
if printf '%s' "$root_html" | grep -qi '<div id="root"'; then
  pass "GET / serves the SPA (found #root)"
elif printf '%s' "$root_html" | grep -qi '<!doctype html>'; then
  pass "GET / serves HTML"
else
  fail "GET / did not return the SPA HTML"
fi

# 5) A hashed static asset referenced by index.html loads.
asset=$(printf '%s' "$root_html" | grep -oE '/assets/[A-Za-z0-9._-]+\.(js|css)' | head -n1)
if [ -n "$asset" ]; then
  asset_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${asset}")
  if [ "$asset_code" = "200" ]; then
    pass "static asset ${asset} -> 200"
  else
    fail "static asset ${asset} -> ${asset_code}"
  fi
else
  fail "no hashed /assets/* reference found in index.html"
fi

# 6) SPA deep link resolves on hard refresh (try_files fallback).
deep_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/view/${addr:-abcde}")
if [ "$deep_code" = "200" ]; then
  pass "GET /view/... (SPA deep link) -> 200"
else
  fail "GET /view/... -> ${deep_code}"
fi

# 7) SSE stream delivers an event when a request is captured.
if [ -n "$addr" ]; then
  sse_out=$(mktemp)
  curl -sN --max-time 8 "${BASE}/api/hole/${addr}/events" >"$sse_out" 2>/dev/null &
  sse_pid=$!
  sleep 2
  curl -s -o /dev/null -X POST "${BASE}/${addr}" -H 'Content-Type: text/plain' --data 'sse-probe'
  sleep 2
  kill "$sse_pid" 2>/dev/null || true
  wait "$sse_pid" 2>/dev/null || true
  if grep -q '^data:' "$sse_out"; then
    pass "SSE /api/hole/${addr}/events streamed a data event"
  else
    fail "SSE stream produced no data event (captured: $(tr '\n' ' ' <"$sse_out"))"
  fi
  rm -f "$sse_out"
else
  fail "SSE check — skipped, no address"
fi

# 8) Data survives a stack restart (SQLite /data volume, no -v so it persists).
if [ -n "$addr" ]; then
  echo "--- restarting stack to check persistence ---"
  docker compose down
  docker compose up -d
  restart_ready=0
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/holes" || true)
    if [ "$code" = "200" ]; then restart_ready=1; break; fi
    sleep 2
  done
  if [ "$restart_ready" -ne 1 ]; then
    fail "persistence — stack never came back after down/up"
  else
    holes_after=$(curl -s "${BASE}/api/holes")
    if printf '%s' "$holes_after" | grep -q "\"$addr\""; then
      pass "hole ${addr} survived docker compose down/up"
    else
      fail "hole ${addr} lost after down/up (body: ${holes_after})"
    fi
  fi
else
  fail "persistence check — skipped, no address"
fi

echo "=== summary: ${PASS} passed, ${FAIL} failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All smoke checks passed. Stack is running at ${BASE}"
