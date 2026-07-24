# Task 0002: Migrate Postgres → SQLite

**Branch**: `feature/sqlite-migration`
**Depends on**: 0001
**Source**: talk-it-through 2026-07-22 · **User stories**: As the maintainer, I want to drop the
Postgres container and run on a single embedded SQLite file so the stack has no separate database
service to operate. (Greenfield — no existing data to preserve.)

## What to build

Replace Postgres with SQLite (`better-sqlite3`, raw SQL, no ORM) end-to-end, then tear the Postgres
service out of the Compose stack from task 0001 and persist the SQLite file on a volume. The app
must behave identically to today. This is a native rewrite of the data layer — the `fastify.pg`
connect/query/release pattern is removed entirely, replaced by a small `fastify-plugin` that opens
one long-lived `better-sqlite3` connection and decorates `fastify.db`.

Durable decisions (driver, pragmas, schema translation, file/volume layout) are in the master plan
architectural header; this file distills what the implementer needs.

### Data layer
- Add `better-sqlite3` + `@types/better-sqlite3`; remove `pg`, `@fastify/postgres`, `@types/pg`.
- `fastify-plugin` opens the DB at `DATABASE_PATH` (container `/data/requesthole.db`), sets pragmas
  `foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=WAL`, `synchronous=NORMAL`, runs schema
  init, and decorates `fastify.db`.
- Rewrite all ~10 queries (across `routes/holes.ts`, `hole.ts`, `request.ts`, `collect.ts`) to
  native `better-sqlite3`: `.get()` (one row), `.all()` (many), `.run()` (writes). Drop
  `fastify.pg.connect()`/`try`/`finally`/`client.release()`. `$1` placeholders → `?`.

### Schema (`db-init.ts`)
- Identity PKs → `INTEGER PRIMARY KEY` (no `AUTOINCREMENT`). `text` → `TEXT`, `bytea` → `BLOB`,
  keep FK `ON DELETE CASCADE`.
- `created` → `TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` (ISO-8601, wire-compatible).
- Delete the dead `requesthole_backend/db-init.sql` (broken, unused duplicate).

### Required fixes that fall out of the driver swap
- DELETE routes' 204/404 check: `rowCount` → `.run().changes`.
- `INSERT ... RETURNING` in `hole.ts` works via `.get()` (better-sqlite3 bundles modern SQLite).
- `collect.ts` object binding: `request.params` / `request.headers` were auto-JSON-serialized by
  `pg`; better-sqlite3 throws on objects — `JSON.stringify()` them before binding. (`request.body`
  is a Buffer → binds to BLOB directly.)
- `schemas.ts`: `created: z.date()` → `z.string()`, or the SSE broadcast validation silently fails.

### Compose / deployment
- Remove the `requesthole-postgres` service and `postgres-data` volume from `compose.yml`.
- Add a data volume mounted at the `/data` **directory** (not a single file — WAL writes
  `.db` + `-wal` + `-shm` that must sit together and persist).
- Set `DATABASE_PATH=/data/requesthole.db` for the backend service; drop `POSTGRES_*` from
  `.env.docker` / `.env.docker.example`.
- Retire dotenvx now that no secrets remain: remove dotenvx from the dev scripts, delete
  `.env.keys` and the encrypted `.env` files, add non-secret `DATABASE_PATH` to dev config, and add
  local `data/` (`*.db`, `*.db-wal`, `*.db-shm`) to `.gitignore`.

## AFK tasks

- [x] Swap dependencies (`better-sqlite3` in, `pg`/`@fastify/postgres` out).
- [x] `fastify.db` plugin: open DB at `DATABASE_PATH`, set the four pragmas, run schema init.
- [x] Translate the schema in `db-init.ts` (types, ISO-8601 `created` default, FK cascade); delete
      the dead `db-init.sql`.
- [x] Rewrite every route query to native `better-sqlite3` (`.get`/`.all`/`.run`); remove the
      connect/release pattern; `$1` → `?`.
- [x] Apply the four required fixes (`changes`, `RETURNING` via `.get()`, `JSON.stringify` on
      object binds, `z.date()` → `z.string()`).
- [x] Update `compose.yml`: remove Postgres service/volume, add `/data` directory volume, set
      `DATABASE_PATH`. Update `.env.docker.example`. *(Decision: `.env.docker.example` was deleted
      rather than updated — with no secrets left, `DATABASE_PATH` is set inline in `compose.yml`
      and `env_file` is gone entirely.)*
- [x] Retire dotenvx: clean dev scripts, delete `.env.keys` + encrypted `.env` (root and
      `requesthole_backend/.env`), gitignore local `data/` DB files.
- [x] Extend the task-0001 smoke-test to run against the SQLite stack, plus a persistence check:
      create a hole, `docker compose down` (without `-v`) then `up`, assert the hole still exists.

## Acceptance criteria

- [x] App runs on SQLite with no Postgres service anywhere in the stack; `docker compose up --build`
      works with only `nginx` published. *(smoke test: 8/8 pass)*
- [x] Every current behavior is unchanged: hole CRUD, request capture (incl. binary bodies), request
      viewing, live SSE updates, and the `RETURNING`-based create response. *(14 vitest integration
      tests + smoke test)*
- [x] `ON DELETE CASCADE` works (deleting a hole removes its requests) — proving `foreign_keys=ON`.
      *(vitest: cascade test)*
- [x] Data survives `docker compose down`/`up` via the `/data` volume (WAL sidecars included).
      *(smoke test check 8)*
- [x] No `pg`/dotenvx/`.env.keys` remain; the only backend config is non-secret `DATABASE_PATH`.

## Implementation log (2026-07-23)

Built via TDD (new vitest harness — the backend had no test framework): `src/app.ts` `buildApp()`
factory extracted from `index.ts` so tests run `fastify.inject()` against a real better-sqlite3 DB
(`:memory:`/temp file); 14 integration tests in `test/app.test.ts` cover hole CRUD, capture (incl.
binary body round-trip + content-type), request viewing/deletion, SSE broadcast validation, FK
cascade, and file-backed persistence across restarts.

Key files: `src/db.ts` (new `fastify.db` plugin: `DATABASE_PATH`, four pragmas, schema init,
`mkdir -p` of the DB dir, `onClose`), `src/db-init.ts` (now a plain `initSchema(db)` with the
SQLite DDL), all four route files rewritten, `src/schemas.ts` (`created: z.string()`),
`compose.yml` (Postgres service/volume removed, `data:/data` volume, inline `DATABASE_PATH`),
`requesthole_backend/Dockerfile`, `scripts/smoke-test.sh` (persistence check, `.env.docker`
requirement dropped), `.gitignore`, `tsconfig.eslint.json` (typed lint for `test/`).

Decisions beyond the spec:
- **Deleted `.env.docker.example`** and all `env_file:` blocks — zero secrets remain;
  `DATABASE_PATH` lives inline in `compose.yml`. Smoke test no longer requires `.env.docker`.
- **`request.body ?? null` bind in `collect.ts`** — `pg` coerced `undefined` (bodyless methods) to
  NULL; better-sqlite3 throws on `undefined`.
- **Dockerfile: `node:24-trixie-slim` + build-stage-only python3/make/g++, `npm prune` + copy
  `node_modules`** — better-sqlite3 13 bundles linux prebuilds needing glibc ≥ 2.38 (bookworm has
  2.36 → `ERR_DLOPEN_FAILED`), and its binding loader prefers prebuilds over local builds, so the
  base had to move to trixie; its install script still runs `node-gyp rebuild` unconditionally,
  hence the toolchain in the build stage only.
- **db plugin creates the DB directory** (`mkdirSync recursive`) — better-sqlite3 won't create
  parent dirs; needed for the dev loop's `./data/requesthole.db` and first boot on a fresh volume.
- Local leftovers for the user: stopped orphan `requesthole-requesthole-postgres-1` container and
  `requesthole_postgres-data` volume (old Postgres data) — remove by hand when ready.
- **eslint glob** `dist/*` → `dist/**` (config change to ignore nested `dist/` output, needed once
  typed lint started resolving files) — flagged as an undocumented drive-by, noted here.

## Review-fix round (2026-07-23)

Task-review panel (Standards/Spec/Bug/Security) surfaced 12 findings; all fixed on this branch.
Four were defects ported verbatim from the Postgres version — the migration spec was "behave
identically," so they weren't regressions, but the review-fix pass corrected them since the lines
were already being rewritten here:

- **query_params stored route params, not the query string** (Bug+Standards major) — `collect.ts`
  now binds `JSON.stringify(request.query)`; the bent test that asserted `{hole_address}` now
  asserts the real query string. This is a deliberate behavior change from "today."
- **`/api/request/:addr/body` 500 on a bodyless capture** (Bug major) — null body now serves an
  empty Buffer.
- **Stored XSS via replayed Content-Type** (Security major) — the body route now always sends
  `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` and defaults an absent
  content-type to `application/octet-stream`. Direct navigation downloads instead of rendering, so
  a stored `<script>` can't execute on-origin; the viewer's inline `<img>` still renders (sub-
  resource loads ignore the disposition). Not a sandboxed origin (out of scope) but closes the
  execution vector.
- **No UNIQUE on address columns** (Bug minor) — both columns are now `UNIQUE`; new
  `utils/unique-insert.ts` retries the insert on a `SQLITE_CONSTRAINT_UNIQUE` collision (crc32-over-
  UUID addresses collide at the birthday bound, ~65k rows). Unit-tested in `test/unique-insert.test.ts`.

Also: deterministic `ORDER BY created, <pk>` on both listing routes (millisecond `created` ties);
a real listening-server SSE **delivery** test (the suite previously only spied on the broadcaster);
the capture test now asserts the stored artifact; `npm test`/`npm run typecheck` now run
`tsc -p tsconfig.eslint.json` so `test/` is type-checked (it immediately caught a bad type
annotation); README install section rewritten off dotenvx/`.env`; PLAN.md Deployment/Storage bullets
updated to reflect the completed migration. Final: 22 app tests + 4 helper tests green, lint + typecheck clean.

## Second review-fix round (2026-07-23)

A re-review panel over both commits returned **Security and Spec clean** (the security lens
verified the XSS fix is closed on every path) and four low-severity items, all fixed:

- **Prepared statements hoisted** (Bug nit) — every route now calls `fastify.db.prepare(...)` once
  at registration and reuses the statement, instead of rebuilding it per request on the hot capture
  path (`collect.ts`, `hole.ts`, `holes.ts`, `request.ts`).
- **End-to-end collision-retry test** (Standards minor) — `test/collision-retry.test.ts` mocks the
  address generator to force a genuine DB UNIQUE collision through `POST /api/hole` and asserts the
  route recovers with a distinct address (the helper's own unit test stays in `unique-insert.test.ts`).
- **SSE delivery test de-flaked** (Bug minor) — replaced the fixed 250ms settle with a poll-capture
  loop that retries the capture until a frame lands (or a deadline), removing the wall-clock race.
- **PDF download acknowledged** (Bug minor) — the inert-body comment now notes the PDF link
  downloads rather than renders (the intended security trade), and the frontend link is relabeled
  "Download PDF" (`requesthole_frontend/src/components/Request.tsx`).

Final: 23 tests across 3 files green (18 app + 4 helper + 1 collision), lint + typecheck clean,
Docker smoke test 8/8.
