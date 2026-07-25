# Task 0007: Resource bounds, abuse control, and sub-path capture

**Branch**: `feature/bounds-and-subpaths`
**Depends on**: 0006 (the risk notice lands in the home view restyled by 0004 and restructured by
0006; sequencing keeps those edits off a stale branch)
**Source**: talk-it-through 2026-07-25 · **User stories**: operator-facing — a publicly deployed
RequestHole has to survive a stranger, and a hole has to capture the URLs people actually paste into
webhook configs.

## What to build

Everything that makes a public, unattended deploy survivable, plus the capture-fidelity fix that
belongs on the same code path.

Today nothing ever deletes data, nothing bounds hole creation or capture rate, and a request to a
sub-path of a hole address is silently swallowed by the SPA fallback.

**Threat model, decided:** public, use at your own risk. No accounts, no ownership, and the global
hole list stays. The controls here bound resource consumption; they do not add access control.

### Retention

- A per-hole cap on stored requests, enforced **at insert time** in the collect path: after each
  capture, one statement trims that hole's oldest rows beyond the cap, in the same transaction. This
  keeps the database bounded continuously rather than between sweeps.
- An age-based sweep on an hourly timer deletes holes older than the TTL. Their requests go with them
  via the existing `ON DELETE CASCADE` and the `foreign_keys=ON` pragma.
- `requests.hole_id` needs an index. SQLite does not index foreign keys automatically, and both the
  insert-time trim and the sweep filter on that column.
- The sweep timer must be cleared on server close, or the test suite will hang.

### Abuse control

- Rate limits via `@fastify/rate-limit`: hole creation and the collect path, keyed per client IP.
- **`trustProxy: true`** on the Fastify instance. The only route to the backend is through our own
  nginx, which already forwards `X-Forwarded-For`. Without this the limiter sees the nginx container's
  IP for every request and lumps all users into one bucket, so the first person to hit a limit locks
  out everybody. This needs its own test.
- A ceiling on total holes. At the ceiling, hole creation is refused with an error status rather than
  evicting an existing hole — nobody's live hole disappears underneath them, and the failure lands on
  the abuser rather than an innocent user.
- A configurable request body limit, defaulting to Fastify's current 1 MB, returning 413 above it.
- A short at-your-own-risk notice on the home page: holes are public, anyone can read captured
  requests, don't send real credentials. The global hole list makes this the honest thing to say.

### Sub-path capture

A hole must capture `/:hole_address/*`, not just the bare address, storing the full path in the
existing `request_path` column. Right now `POST /abc123/webhook` never reaches the backend — nginx
routes only the bare six-character pattern, so the sender gets the SPA's HTML with a 200 and nothing
is captured.

Widening the nginx pattern to allow an optional sub-path introduces a collision that must be handled:
`/assets/index-<hash>.js` matches a six-alphanumeric-character first segment, so built frontend assets
would be proxied to the backend and 404. Give the assets location precedence with nginx's `^~` prefix
modifier so a prefix match beats the regex outright.

No frontend work is needed — both the request list and the request detail already render
`request_path`.

This changes a durable decision: the architectural header currently commits to "bare address only, no
sub-paths". Amend that bullet as part of this task.

### Configuration

All knobs are optional environment variables with defaults, following the existing `DATABASE_PATH`
pattern, and all get rows in the README's Configuration table:

- `RETENTION_DAYS` — default 7
- `MAX_REQUESTS_PER_HOLE` — default 100
- hole-creation rate limit — default 10 per hour per IP
- capture rate limit — default 60 per minute per IP
- total hole ceiling — default 1000
- max body bytes — default 1 MB

## AFK tasks

- [ ] Add an index on `requests(hole_id)` in the schema initializer.
- [ ] Implement the insert-time per-hole trim in the collect path, in the same transaction as the
      capture insert. Test that the (cap + 1)th capture evicts the oldest and that the count stays at
      the cap.
- [ ] Implement the hourly TTL sweep, cascading to requests. Test the sweep deletes holes past the TTL
      and leaves newer ones, and that the timer is cleared on close.
- [ ] Read all six knobs from the environment with the documented defaults; validate and fail fast on
      nonsense values.
- [ ] Enable `trustProxy` and add `@fastify/rate-limit` on hole creation and the collect path.
- [ ] Test that the limiter keys on the forwarded client IP, not the proxy's — two different
      `X-Forwarded-For` values must get independent budgets.
- [ ] Implement the total-hole ceiling, refusing creation with an error status at the limit. Test the
      refusal and that an existing hole is never deleted to make room.
- [ ] Make the body limit configurable and assert a 413 above it.
- [ ] Widen the collect route to accept `/:hole_address/*`, storing the full path. Test capture at a
      sub-path, at a deep sub-path, and that the bare address still works.
- [ ] Widen the nginx collect pattern and add the `^~` assets location above it. Extend
      `scripts/smoke-test.sh` with a sub-path capture check and keep its existing hashed-asset check,
      so an assets regression fails the smoke test.
- [ ] Add the at-your-own-risk notice to the home page.
- [ ] Amend the architectural header's collect-route bullet to reflect sub-path capture, and add the
      six new variables to the README's Configuration table alongside the deploy documentation.

## Human-in-the-loop tasks

None — every behavior here is assertable, and the nginx routing changes are covered by the smoke test.

## Acceptance criteria

- [ ] Captures beyond the per-hole cap evict the oldest requests; the stored count never exceeds the
      cap.
- [ ] Holes older than the TTL are deleted along with their requests; the timer stops on close.
- [ ] `requests(hole_id)` is indexed.
- [ ] Hole creation and capture are rate limited per client IP, and the limiter demonstrably keys on
      the forwarded IP rather than the proxy's.
- [ ] At the hole ceiling, creation is refused and no existing hole is evicted.
- [ ] A body over the configured limit is rejected with 413.
- [ ] `POST /:hole_address/anything/here` is captured with its full path; the bare address still works;
      hashed frontend assets still load.
- [ ] All six knobs are environment-configurable with the documented defaults and appear in the
      README's Configuration table.
- [ ] The home page carries the at-your-own-risk notice.
- [ ] The architectural header no longer claims bare-address-only capture.
- [ ] `scripts/smoke-test.sh` covers sub-path capture and still passes end to end.
