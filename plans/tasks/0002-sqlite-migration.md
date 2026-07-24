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

- [ ] Swap dependencies (`better-sqlite3` in, `pg`/`@fastify/postgres` out).
- [ ] `fastify.db` plugin: open DB at `DATABASE_PATH`, set the four pragmas, run schema init.
- [ ] Translate the schema in `db-init.ts` (types, ISO-8601 `created` default, FK cascade); delete
      the dead `db-init.sql`.
- [ ] Rewrite every route query to native `better-sqlite3` (`.get`/`.all`/`.run`); remove the
      connect/release pattern; `$1` → `?`.
- [ ] Apply the four required fixes (`changes`, `RETURNING` via `.get()`, `JSON.stringify` on
      object binds, `z.date()` → `z.string()`).
- [ ] Update `compose.yml`: remove Postgres service/volume, add `/data` directory volume, set
      `DATABASE_PATH`. Update `.env.docker.example`.
- [ ] Retire dotenvx: clean dev scripts, delete `.env.keys` + encrypted `.env`, gitignore local
      `data/` DB files.
- [ ] Extend the task-0001 smoke-test to run against the SQLite stack, plus a persistence check:
      create a hole, `docker compose down` (without `-v`) then `up`, assert the hole still exists.

## Acceptance criteria

- [ ] App runs on SQLite with no Postgres service anywhere in the stack; `docker compose up --build`
      works with only `nginx` published.
- [ ] Every current behavior is unchanged: hole CRUD, request capture (incl. binary bodies), request
      viewing, live SSE updates, and the `RETURNING`-based create response.
- [ ] `ON DELETE CASCADE` works (deleting a hole removes its requests) — proving `foreign_keys=ON`.
- [ ] Data survives `docker compose down`/`up` via the `/data` volume (WAL sidecars included).
- [ ] No `pg`/dotenvx/`.env.keys` remain; the only backend config is non-secret `DATABASE_PATH`.
