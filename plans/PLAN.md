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

- **Backend**: Node 24, Fastify 5, TypeScript. Routes under `/api/*`; a root-level collect route
  `fastify.all("/:hole_address")` captures any method to a single fixed 6-char alphanumeric path
  (bare address only, no sub-paths). SSE stream at `/api/hole/:hole_address/events`.
- **Frontend**: Vite + React 19 + Tailwind/daisyUI, built to static assets. Single-origin in
  production — `services.ts` sets `BASE_URL=""` for prod builds, so the app calls `/api/*` on its
  own origin. Client routes: `/`, `/view/:hole_address`, `/view/:hole_address/:request_address`.
- **Deployment** (task 0001, storage retired in 0002): prod-only Docker Compose, two services —
  `nginx` (sole published port, `${WEB_PORT:-8080}:80`, serves static frontend + reverse-proxies)
  and `backend` (internal, `backend:3000`), with a `data` volume at `/data` for the SQLite file.
  Nginx routing resolves single-origin traffic: `/api/*` → backend (SSE-safe: unbuffered, HTTP/1.1,
  long read timeout); `^/[a-zA-Z0-9]{6}$` → backend (collect capture); `/` → static + SPA fallback.
  Host dev loop (`npm run dev`) stays non-containerized. No secrets remain — the stack has no
  `.env.docker` or dotenvx; the backend's only config is a non-secret `DATABASE_PATH`.
- **Untrusted bodies**: captured request bodies are attacker-controlled and must never execute on
  this origin. The body endpoint serves them with `x-content-type-options: nosniff` and
  `content-disposition: attachment`; the viewer fetches bytes and renders them as escaped text, never
  via `dangerouslySetInnerHTML`, an iframe, or navigation to the body URL. `text/html` is shown as
  source. Inline `<img>` is fine — sub-resource loads ignore both headers.
- **Schema**: two tables — `holes` (`hole_address`, `created`) and `requests` (`request_address`,
  `hole_id` FK `ON DELETE CASCADE`, `created`, `method`, `request_path`, `query_params`, `headers`,
  `body`). `query_params`/`headers` stored as JSON text; `body` as binary.
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
- [>] 0005 · Content-aware request body viewer (after 0004) → tasks/0005-body-viewer.md
- [ ] 0006 · List/detail layout and durable live streaming (after 0005) → tasks/0006-list-detail-layout.md
- [ ] 0007 · Resource bounds, abuse control, and sub-path capture (after 0006) → tasks/0007-bounds-and-subpaths.md
- [ ] 0008 · General review of the finished application (after 0007) → tasks/0008-general-review.md
