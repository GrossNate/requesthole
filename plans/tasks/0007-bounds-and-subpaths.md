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

> **Already done in 0006, do not re-litigate:** `RequestBroadcaster` drops a hole's key when its
> last subscriber leaves. A stream can be opened for any six characters, so the emptied `Set`s it
> used to keep were one permanent Map entry per address anyone ever probed. Also investigated and
> found to be a non-issue: a socket destroyed before the events route attaches its `close` listener
> would leak a subscriber, but Fastify routes from inside the socket's own data handler, so the
> listener is always attached first — measured over 1000 connect-and-reset cycles, zero misses. No
> guard was added, since an unreachable branch cannot be tested and would be dead code. The caps,
> limiter, TTL and body limit below are still this task's.
>
> **Handed over from 0006's round-5 review:** the SSE stream carries captures but not deletions, so
> a request deleted in one tab can linger in another until that tab's next snapshot — and a stream
> that never drops never takes one. A delete frame on the stream is the fix; it is server-side work
> and it sits with the rest of this task's stream changes. Insert-time trimming and the TTL sweep
> below delete rows behind the client's back too, which makes it the same problem at a larger
> scale: those evictions want the same frame.

- [x] Broadcast a delete frame on the SSE stream when a request goes away — a user delete, an
      insert-time eviction, or a TTL sweep — and drop the row on the client when it arrives. Test
      that a viewer watching a hole loses the row without waiting for a snapshot. (Rationale in the
      note above: today only a snapshot can notice a deletion, and a stream that never drops never
      takes one.)
- [x] Add an index on `requests(hole_id)` in the schema initializer.
- [x] Implement the insert-time per-hole trim in the collect path, in the same transaction as the
      capture insert. Test that the (cap + 1)th capture evicts the oldest and that the count stays at
      the cap.
- [x] Implement the hourly TTL sweep, cascading to requests. Test the sweep deletes holes past the TTL
      and leaves newer ones, and that the timer is cleared on close.
- [x] Read all six knobs from the environment with the documented defaults; validate and fail fast on
      nonsense values.
- [x] Enable `trustProxy` and add `@fastify/rate-limit` on hole creation and the collect path.
- [x] Test that the limiter keys on the forwarded client IP, not the proxy's — two different
      `X-Forwarded-For` values must get independent budgets.
- [x] Implement the total-hole ceiling, refusing creation with an error status at the limit. Test the
      refusal and that an existing hole is never deleted to make room.
- [x] Make the body limit configurable and assert a 413 above it.
- [x] Widen the collect route to accept `/:hole_address/*`, storing the full path. Test capture at a
      sub-path, at a deep sub-path, and that the bare address still works.
- [x] Widen the nginx collect pattern and add the `^~` assets location above it. Extend
      `scripts/smoke-test.sh` with a sub-path capture check and keep its existing hashed-asset check,
      so an assets regression fails the smoke test.
- [x] Add the at-your-own-risk notice to the home page.
- [x] Amend the architectural header's collect-route bullet to reflect sub-path capture, and add the
      six new variables to the README's Configuration table alongside the deploy documentation.

## Human-in-the-loop tasks

None — every behavior here is assertable, and the nginx routing changes are covered by the smoke test.

## Acceptance criteria

- [x] Captures beyond the per-hole cap evict the oldest requests; the stored count never exceeds the
      cap.
- [x] Holes older than the TTL are deleted along with their requests; the timer stops on close.
- [x] `requests(hole_id)` is indexed.
- [x] Hole creation and capture are rate limited per client IP, and the limiter demonstrably keys on
      the forwarded IP rather than the proxy's.
- [x] At the hole ceiling, creation is refused and no existing hole is evicted.
- [x] A body over the configured limit is rejected with 413.
- [x] `POST /:hole_address/anything/here` is captured with its full path; the bare address still works;
      hashed frontend assets still load.
- [x] All six knobs are environment-configurable with the documented defaults and appear in the
      README's Configuration table.
- [x] The home page carries the at-your-own-risk notice.
- [x] The architectural header no longer claims bare-address-only capture.
- [x] `scripts/smoke-test.sh` covers sub-path capture and still passes end to end.

## Implementation log

**2026-09-12 — built on `feature/bounds-and-subpaths`.** All AFK items done via red-green cycles;
backend 60 tests, frontend 226 tests, both lint- and typecheck-clean; `scripts/smoke-test.sh`
passes 10/10 against the Docker stack, including the new sub-path check and the existing
hashed-asset check.

What was built, and where:

- `requesthole_backend/src/config.ts` — `loadConfig(overrides, env)`: the six knobs, override →
  env → default, strict positive-integer parsing that throws on anything else. `buildApp` takes
  `config?: ConfigOverrides` so tests set knobs without touching `process.env`.
- `src/db-init.ts` — `idx_requests_hole_id`.
- `src/routes/collect.ts` — one handler registered at `/:hole_address` and `/:hole_address/*`;
  insert + trim (`DELETE … RETURNING request_address`) in one `db.transaction`, inside the
  unique-address retry so a failed attempt rolls back whole. Evicted addresses are broadcast as
  delete frames after the capture frame. Per-route `config.rateLimit`.
- `src/retention.ts` — `fastify-plugin` decorating `sweepExpiredHoles()`; hourly `setInterval`,
  unref'd and cleared `onClose`. Lists doomed requests before the cascade so viewers hear.
- `src/routes/hole.ts` — `COUNT(*)` ceiling check before insert, bare `503` at the limit (matches
  the codebase's no-body error convention); per-route rate limit, 1 hour window.
- `src/routes/request.ts` — now a `routesWrapper(broadcaster)` factory like the others; delete uses
  `RETURNING` a correlated `hole_address` so the frame can be routed to the right hole.
- `src/RequestBroadcaster.ts` — `broadcastDelete(hole, request)` → `{event: "delete", data:
  {request_address}}`.
- `src/app.ts` — `trustProxy: true`, `bodyLimit: config.maxBodyBytes`, `@fastify/rate-limit`
  registered with `global: false`.
- Frontend: `useHoleStream` gains optional `onDelete`, wired via `addEventListener("delete")`;
  `Hole.tsx` factors the row drop into `dropRequest`, shared by the user delete and the stream
  frame (tombstone, navigate-away-if-open, list filter). All three EventSource test stubs gained
  `addEventListener`. `Home.tsx` carries the notice as a `role="note"` panel in the warning tint.
- `requesthole_frontend/nginx.conf` — `location ^~ /assets/` ahead of the widened
  `^/[a-zA-Z0-9]{6}(/.*)?$` collect regex. `scripts/smoke-test.sh` step 3b.
- README Configuration table (six rows + the threat-model paragraph), Deployment prose, Route
  design row; `compose.yml` commented defaults; PLAN.md Backend/Deployment bullets amended and a
  new **Resource bounds** bullet; `address-generator.ts` comment corrected (it also claimed
  bare-address-only).

Decisions made along the way (no `[decision]` items were open):

- Env variable names for the four unnamed knobs: `HOLE_CREATE_RATE_LIMIT`, `CAPTURE_RATE_LIMIT`,
  `MAX_HOLES`, `MAX_BODY_BYTES`.
- Ceiling refusal is `503` with no body, following the API's bare-status convention.
- Delete frames are a named SSE event rather than a discriminant on the default channel, matching
  the existing `stream-open`/`close` precedent and leaving the capture payload untouched.
- The sweep cadence test drives the interval with fake timers and reads through `app.db` rather
  than `inject`, because `inject` arms a timer of its own that survives `close`.

Worth a look in review: `trustProxy: true` (as specified) trusts every hop, so `request.ip`
is the *leftmost* `X-Forwarded-For` entry — which a client can set. `trustProxy: 1` would trust
only nginx and take the address nginx itself appended. Left as specified; flagged.
