# Plan: RequestHole

> Source: talk-it-through sessions 2026-07-22 (Docker Compose move; Postgres → SQLite migration)

This is the project's master plan: a durable architectural header plus an ordered list of task
pointers. Each task is one feature on its own branch, ending in a PR. Task bodies live in
`plans/tasks/`; finished tasks move to `plans/tasks/done/`.

## Workflow

- New work is added by the `to-plan` skill: a self-contained task file under
  `plans/tasks/NNNN-<slug>.md` plus a pointer below. It appends; it never creates a second plan.
- `implement-next-task` takes the first eligible pointer (or an explicit task argument), builds it
  on its branch — AFK via `tdd`, `[decision]` via `talk-it-through`, `[verify]` paused for manual
  confirmation — runs `task-review`, then opens the PR after approval and flips the pointer to `[>]`.
- A pointer has four states: `[ ]` todo · `[~]` in progress (claimed) · `[>]` done, PR open,
  awaiting merge · `[x]` merged to `main`. `sync-main` flips `[>]→[x]` and moves the task file to
  `tasks/done/` once the PR merges.
- Pointers carry their direct prerequisites as an `(after NNNN, …)` suffix (none = no suffix). A
  task is selectable only once every ordinal in its `(after …)` list is **`[x]` (merged)**.

## Architectural decisions

Durable decisions that apply across all tasks.

- **Backend**: Node 24, Fastify 5, TypeScript. Routes under `/api/*`; root-level collect routes
  `fastify.all("/:hole_address")` and `fastify.all("/:hole_address/*")` capture any method to a
  fixed 6-char alphanumeric address and any sub-path beneath it (task 0007), storing the full URL
  in `request_path`; a path with a `.`/`..` segment is refused with 404. SSE stream at
  `/api/hole/:hole_address/events`, carrying capture frames, named `delete` frames (request delete,
  cap eviction), and one `hole-deleted` frame when the hole itself goes.
- **Frontend**: Vite + React 19 + Tailwind/daisyUI, built to static assets. Single-origin in
  production — `services.ts` sets `BASE_URL=""` for prod builds, so the app calls `/api/*` on its
  own origin. Client routes: `/`, `/view/:hole_address`, `/view/:hole_address/:request_address`.
- **Deployment** (task 0001, storage retired in 0002): prod-only Docker Compose, two services —
  `nginx` (sole published port, `${WEB_PORT:-8080}:80`, serves static frontend + reverse-proxies)
  and `backend` (internal, `backend:3000`), with a `data` volume at `/data` for the SQLite file.
  Nginx routing resolves single-origin traffic: `/api/*` → backend (SSE-safe: unbuffered, HTTP/1.1,
  long read timeout); `^~ /assets/` → static (declared first so hashed asset names are never
  mistaken for addresses); `^/[a-zA-Z0-9]{6}(/.*)?$` → backend (collect capture, sub-paths
  included); `/` → static + SPA fallback. Host dev loop (`npm run dev`) stays non-containerized.
  No secrets remain — the stack has no `.env.docker` or dotenvx; the backend's config is
  `DATABASE_PATH` plus the optional, non-secret bound knobs below.
- **Resource bounds** (task 0007): public, use-at-your-own-risk threat model — no accounts, no
  ownership, the global hole list stays; the controls bound consumption, not access. Per-hole cap
  (`MAX_REQUESTS_PER_HOLE`, 100) trimmed at insert time in the capture transaction; hourly TTL
  sweep (`RETENTION_DAYS`, 7) cascading to requests, timer cleared on close; `requests(hole_id)`
  indexed; the sweep also runs once at startup. `trustProxy: 1` (one hop, nginx's own
  `X-Forwarded-For: $remote_addr`, so a client cannot choose its bucket) and `@fastify/rate-limit`
  keyed on that IP (`HOLE_CREATE_RATE_LIMIT` 10/hour, `CAPTURE_RATE_LIMIT` 60/minute, one shared
  capture bucket across bare address and sub-paths); total ceiling `MAX_HOLES`
  (1000) refuses creation with a bare 503, never evicts; a per-client share of live holes
  (`MAX_HOLES_PER_IP`, 20, IPv6 per /64, keyed like the limiter) refuses with 429 first, so one
  patient client cannot fill the ceiling; `MAX_BODY_BYTES` (1 MB) → 413. Knobs are read once in
  `src/config.ts` (override → env → default) and fail fast on anything but a positive safe
  integer. Request deletes and insert-time evictions are broadcast as SSE `delete` frames; a hole
  going (API delete or sweep, shared in `src/hole-removal.ts`) is one `hole-deleted` frame, and
  `GET /api/hole/:addr/requests` answers 404 for a missing hole so a reconnecting viewer can tell
  gone from empty. Nginx collect sets `client_max_body_size 0` with `proxy_request_buffering off`,
  so bodies stream to the backend's 413 instead of spooling to nginx's disk and `MAX_BODY_BYTES` is
  the single body-size authority; `limit_conn` 10 per client and `client_body_timeout 10s` cap
  slow uploads, and the backend's `requestTimeout` (30s) bounds receipt of any request. `/api/`
  caps bodies at 16k (no route takes one) but has no connection cap, since SSE streams live there.
  The insert-time trim evicts by `request_id` (arrival), never by wall-clock `created`.
  Accepted trade-offs, documented in the README Configuration section (its "Limits of the limits"
  list, plus the notes on logs and on nginx facing clients) rather than engineered: "one
  client" is one IPv4 or IPv6 /64, so a /56 holder can fill the ceiling; the share counts live
  holes, so behind shared IPv4 it can block neighbours for up to the TTL; nginx's in-flight cap is
  per exact address; the 30s deadline is fixed against a configurable body cap; client addresses
  persist in access and request logs. Nginx must face clients directly.
- **Untrusted bodies**: captured request bodies are attacker-controlled and must never execute on
  this origin. The body endpoint serves them with `x-content-type-options: nosniff` and
  `content-disposition: attachment`; the viewer fetches bytes and renders them as escaped text, never
  via `dangerouslySetInnerHTML`, an iframe, or navigation to the body URL. `text/html` is shown as
  source. Inline `<img>` is fine — sub-resource loads ignore both headers.
- **Media gate** (task 0008): RequestHole is text-only by default. `ALLOW_MEDIA`
  (`true`/`false`/`1`/`0`, unset = false, anything else fails fast) is the conscious opt-in to storing
  and serving media and binary bodies. With it off, a body filter — strict content-type parse,
  encodings, declared-type allowlist behind a top-level gate, strict-UTF-8 byte check, anchored
  file-signature check, multipart part by part and fail-closed — drops disallowed content before
  storage and records a JSON description in the nullable `requests.body_dropped` column, carried in
  all request metadata. The body endpoint re-runs the filter at read time (empty 200 +
  `x-requesthole-body-withheld`) and serves kept bodies as `text/plain; charset=utf-8` with CORP
  `same-origin`. `GET /api/config` returns `{ allowMedia }`; the viewer treats a failed fetch as media
  off and never builds an `<img>` or blob while it is off. Encoded binary inside text (base64,
  percent-encoding, `\u` escapes) is an accepted, documented limit.
- **Schema**: two tables — `holes` (`hole_address`, `created`, `creator_ip` — task 0007, never
  returned by any route, added by an idempotent `ALTER TABLE` on older databases) and `requests` (`request_address`,
  `hole_id` FK `ON DELETE CASCADE`, `created`, `method`, `request_path`, `query_params`, `headers`,
  `body`, `body_dropped` — task 0008). `query_params`/`headers`/`body_dropped` stored as JSON text;
  `body` as binary.
- **Storage** (SQLite since task 0002): `better-sqlite3`, raw SQL, no ORM — one long-lived
  connection opened by a `fastify.db` plugin. Single-file DB at `DATABASE_PATH` (container
  `/data/requesthole.db`) on a directory volume (WAL sidecars); pragmas `foreign_keys=ON`,
  `busy_timeout=5000`, `journal_mode=WAL`, `synchronous=NORMAL`; `created` as ISO-8601 TEXT default.
  Address columns are `UNIQUE`; inserts retry on a collision. No secrets — dotenvx/`.env.keys`/
  encrypted `.env` are retired.

---

## Tasks

- [x] 0001 · Dockerize the stack (Compose: backend + Nginx/frontend + Postgres) → tasks/done/0001-docker-compose.md
- [x] 0002 · Migrate Postgres → SQLite (after 0001) → tasks/done/0002-sqlite-migration.md
- [x] 0003 · Rewrite README install/deploy for Docker Compose (after 0001) → tasks/done/0003-readme-docker-install.md
- [x] 0004 · Design system and UI defect fixes → tasks/done/0004-design-system.md
- [x] 0005 · Content-aware request body viewer (after 0004) → tasks/done/0005-body-viewer.md
- [x] 0006 · List/detail layout and durable live streaming (after 0005) → tasks/done/0006-list-detail-layout.md
- [x] 0007 · Resource bounds, abuse control, and sub-path capture (after 0006) → tasks/done/0007-bounds-and-subpaths.md
- [~] 0008 · Text-only bodies by default (ALLOW_MEDIA) (after 0007) → tasks/0008-allow-media.md
- [ ] 0009 · General review of the finished application (after 0008) → tasks/0009-general-review.md
