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
- **`trustProxy: 1`** on the Fastify instance (amended in review round 1; originally `true`). The only
  route to the backend is through our own nginx, which forwards `X-Forwarded-For`. Without proxy
  trust the limiter sees the nginx container's IP for every request and lumps all users into one
  bucket, so the first person to hit a limit locks out everybody. Exactly one hop, not every hop:
  trusting every hop makes the client's own leftmost `X-Forwarded-For` entry the key, a fresh bucket
  per request for anyone who sets the header. nginx sends `$remote_addr` alone for the same reason.
  This needs its own test.
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
  delete frames after the capture frame. Per-route `config.rateLimit`. *(Superseded in review round 1: one shared `fastify.rateLimit()`, now an `onRequest` hook.)*
- `src/retention.ts` — `fastify-plugin` decorating `sweepExpiredHoles()`; hourly `setInterval`,
  unref'd and cleared `onClose`. Lists doomed requests before the cascade so viewers hear.
- `src/routes/hole.ts` — `COUNT(*)` ceiling check before insert, bare `503` at the limit (matches
  the codebase's no-body error convention); per-route rate limit, 1 hour window.
- `src/routes/request.ts` — now a `routesWrapper(broadcaster)` factory like the others; delete uses
  `RETURNING` a correlated `hole_address` so the frame can be routed to the right hole.
- `src/RequestBroadcaster.ts` — `broadcastDelete(hole, request)` → `{event: "delete", data:
  {request_address}}`.
- `src/app.ts` — `trustProxy: true` *(superseded in review round 1: `trustProxy: 1`)*, `bodyLimit: config.maxBodyBytes`, `@fastify/rate-limit`
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

**Review round 1 (2026-09-12) — all eleven findings fixed on request.**

- `trustProxy: 1` instead of `true`, and nginx now sends `X-Forwarded-For $remote_addr` on both
  proxy locations, so a client-supplied entry never reaches the limiter. Test: a two-entry
  forwarded chain keys on the rightmost (nginx-written) address.
- One capture limiter built with `fastify.rateLimit()` and attached as a `preHandler` to both
  collect routes — one bucket across bare address and sub-paths (a per-route `config.rateLimit`
  gave each route its own store). Running after validation also means a stray path never eats
  capture budget.
- Collect routes carry an `errorHandler` mapping validation failures to a bare 404, so an
  unknown multi-segment path such as `/api/nope/x` reads as not found rather than a malformed
  address.
- `src/hole-removal.ts`: list-then-delete-then-broadcast, shared by `DELETE /api/hole/:addr`
  and the retention sweep. Hole delete now broadcasts every request it takes.
- Sweep runs once `onReady` as well as hourly; cutoff is computed once in JS and bound to both
  statements so the listing and the delete agree.
- nginx `client_max_body_size 0` on the collect location; `MAX_BODY_BYTES` is the only body
  limit. Assets-location comment states the 404-on-missing behaviour is deliberate.
- Config overrides go through the same positive-integer check as the environment.
- `test/helpers.ts` holds `createHole`/`listRequests`/`captureRequest`/`backdate`, imported by
  both backend suites. A wire-level test reads the `event: delete` frame off a real socket.
- Backend 71 tests, frontend 226; smoke test re-run against the rebuilt stack.

**Review round 2 (2026-09-12) — all ten findings fixed on request.**

- nginx `proxy_request_buffering off` on the collect location. Round 1's `client_max_body_size 0`
  had let nginx spool an unbounded body to disk before proxying; now the body streams through and
  the backend's 413 ends it. Smoke step 3c asserts a 2 MiB body gets the backend's JSON 413
  (`FST_ERR_CTP_BODY_TOO_LARGE`), not nginx's HTML one, and fails if nginx logs spooling a body to a
  temp file. Proven by re-enabling buffering: the 413 check still passed and only the spool check
  failed, so the spool check is what guards this regression.
- Capture limiter moved from `preHandler` to `onRequest`, before the body is read, with an inline
  address check (one `ADDRESS_PATTERN` shared with the schema) so non-address paths stay unmetered.
  Tests: an over-budget oversized body gets 429 not 413; an oversized body counts against the budget.
- The validation-to-404 mapping is scoped to the `/:hole_address/*` route only; a malformed bare
  address keeps its 400. README documents both.
- `prepareHoleRemoval` lists requests only for holes `RequestBroadcaster.isWatched`; unwatched holes
  cost one row each. The sweep and hole-delete tests now assert the frames a subscriber receives.
- Retention cutoff computed once per sweep in SQL; an out-of-range retention yields NULL, which
  matches no hole, instead of a `RangeError` from `Date#toISOString` at startup.
- Config knobs must be safe integers on both the env and override paths.
- Limiter tests advance a faked `Date` past each window and assert the budget refills.
- This file's Abuse-control bullet now says `trustProxy: 1`; a dropped verb in a comment fixed.

Decisions beyond the spec's letter, kept deliberately:

- The sweep also runs once at startup (`onReady`), because an interval alone resets on every boot
  and a process restarted more often than hourly would never sweep.
- `DELETE /api/hole/:addr` broadcasts a delete frame per request it takes: a fourth deletion source
  beyond the three the spec listed, sharing the sweep's code path, so a viewer in another tab does
  not keep rows for a hole that is gone.

**Review round 3 (2026-09-12) — all twelve findings fixed on request.** Two were decisions; the user
chose the recommended option for both.

- **Per-client hole share (decision).** `MAX_HOLES_PER_IP`, default 20: a client at its share gets a
  bare 429 before the global ceiling is consulted. Keyed by `normalizeIP` from `@fastify/rate-limit`,
  so IPv6 is grouped by /64 exactly as the rate limits group it. Needs `holes.creator_ip`, added to
  older databases by an idempotent `ALTER TABLE`; never returned by any route, swept with its hole.
  Chosen over a startup check on the knob arithmetic, which the documented defaults would fail.
- **Hole-gone state (decision).** A hole going (API delete or sweep) is one `hole-deleted` frame
  instead of a delete frame per request; `hole-removal.ts` is now a single `DELETE … RETURNING`, and
  `isWatched` is gone with the per-request listing. `GET /api/hole/:addr/requests` answers 404 for a
  missing hole, so a viewer that missed the frame finds out on its next snapshot. The frontend maps
  that 404 to `HoleGoneError` (in `src/errors.ts`, outside the mocked service module), and the view
  closes its stream, stops retrying, and shows "This hole no longer exists" with no badge and no
  capture URL. This replaces the spec's per-request frame for the sweep with a hole-level one: the
  viewer still loses every row without waiting for a snapshot, which was the point of that item.
- **Slow uploads.** Backend `requestTimeout: 30_000` (receipt only; SSE responses unaffected).
  nginx collect adds `limit_conn` 10 per client (status 429) and `client_body_timeout 10s`. The
  backend test asserts the configured deadline: Node enforces it on a 30s sweep, too slow to wait
  out in a test.
- Docs: PLAN.md records `proxy_request_buffering off`, the share, the frame, and the timeouts;
  README's intro no longer claims the port is the only setting, and it gains the share row, the
  creator-address note, and a warning about putting another proxy in front (`set_real_ip_from`).
  The `trustProxy` comments say nginx replaces the header. Superseded log bullets are marked.
- Tests: a malformed bare address is shown not to count against the capture budget. The address
  regex compiles once.

**Review round 4 (2026-09-12) — the user chose: fix the major and the straightforward findings,
document the trade-offs.**

- **Major: create refusals read as an outage.** `addHole` now maps 429 and 503 to
  `HoleLimitError` (`client-limit` / `full`, in `src/errors.ts`). `App` keeps a `createError` apart
  from `loadState`, so a refused or failed create leaves a loaded list alone; `Home` shows the
  message as a `role="alert"` beside the create button. Messages carry no numbers, since every
  limit is an operator setting.
- Trim evicts by `request_id` alone (arrival order), not wall-clock `created`: a clock stepping
  back could otherwise evict the capture just stored. Test backdates rows to the future.
- Dot segments: the collect `onRequest` hook refuses any `.`/`..` segment, raw or percent-encoded,
  with 404 before the limiter. Tested over a real socket, since `inject` normalizes paths. nginx
  `/api/` gets `client_max_body_size 16k` and `client_body_timeout 10s`; deliberately no
  `limit_conn` there, since every open hole view holds an SSE stream on `/api/`.
- Smoke test deletes its hole on exit, so repeated runs no longer eat the host's share; new checks
  for the dot-segment refusal and the `/api/` body cap.
- Tests added: share-before-ceiling precedence (429 over 503); a pending snapshot retry dropped when
  the hole goes; the snapshot-404 path closing the stream.
- Stale docs fixed: PLAN.md Backend bullet lists all three frames; `onDelete`/`dropRequest` and the
  retention comments match round 3; README route table notes the 404 and the frames.

Documented, not engineered (README "Limits of the limits", PLAN.md Resource bounds): "one client"
is one IPv4 or IPv6 /64, so a /56 holder can fill the ceiling in about two hours; the share counts
live holes, so behind shared IPv4 one user can block neighbours for up to the TTL; nginx's in-flight
cap is per exact address; the 30s request deadline is fixed against a configurable body cap; client
addresses persist in access and request logs; nginx must face clients directly, now spelled out
for the hole share too.

**Review round 5 (2026-09-12) — all twelve findings fixed on request.**

- **Encoded-slash gap.** `hasDotSegment` now decodes `%XX` escapes one at a time, then splits on `/`
  and `\`, so `..%2F` and `..%5C` are dot segments as nginx sees them. Byte-wise rather than
  `decodeURIComponent`, whose throw on a malformed escape would have needed a raw-path fallback that
  switched the check off. (Fastify already refuses malformed escapes with 400 before routing.) Socket
  tests cover `..%2Fapi`, `x%2F..%2F..%2Fapi`, `..%5Capi`, a malformed escape, an encoded slash that
  is not beside a dot, and that a refused path is not charged to the capture budget. Smoke 3e sends
  both the literal and the `..%2F` form.
- **Two 429s, two messages.** `HoleLimitError` reasons are now `share`, `rate-limit` and `full`. The
  hourly limiter's 429 carries `Retry-After`; the share refusal never does, and a backend test pins
  that contract. The page tells a client at its share to delete a hole, and a client at the hourly
  limit how long to wait. CORS exposes `retry-after`, since the dev server is cross-origin and a
  browser hides unexposed headers from the page.
- **Bounded client memory.** A tombstone is added only while a snapshot is pending, and all are
  cleared when it settles: a snapshot asked for after a deletion never carries the row. The same
  rule now bounds `streamedSince`, which also grew on a stream that never drops (pre-existing since
  task 0006, found while fixing this). Tests show a reissued address reappears once no snapshot
  predates its deletion.
- The create message clears on navigation and when a hole is deleted from the list.
- Docs: "Limits of the limits" says which trade-offs have a knob; PLAN.md's pointer covers the
  Configuration notes too; README intro accounts for `DATABASE_PATH`; the `RETENTION_DAYS` row
  mentions the startup sweep; the README smoke-test summary lists the resource-bound checks.
- Tests: the backend-down create test now asserts its alert. Smoke 3f posts its oversized body to
  `/api/holes`, which cannot create a hole if the cap ever regresses.

**Round 6 nits (2026-09-12) — fixed on request.** A targeted check of the round-5 commit verified all
twelve fixes and found three nits in them:

- `hasDotSegment` splits on `/` only. nginx on Linux does not treat `\` as a separator, so
  `..%5Capi` stays in the collect location as one segment and is a real capture; it had been
  wrongly refused. A socket test pins the capture.
- The create message is now `{ message, clearsOnDelete, page, seen }`. It renders only on the page
  the create started on. A refusal that lands while the reader is elsewhere waits until they return
  and see it, and leaving after seeing it retires it; nothing renders off its page, so nothing
  flashes. A delete clears it only for a share refusal, since deleting frees nothing against the
  hourly limit or the ceiling. Tests cover both.
