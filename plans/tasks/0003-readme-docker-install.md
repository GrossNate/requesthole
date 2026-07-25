# Task 0003: Rewrite README install/deploy for the Docker Compose workflow

**Branch**: `feature/readme-docker-install`
**Depends on**: 0001 (the Docker Compose stack must be the shipped deploy path)
**Source**: task-review of 0001 (Standards, major) — the README still documents the pre-Docker
dotenvx workflow, now contradicted by what task 0001 ships.

## What to build

Documentation only. Update `README.md` so its Installation / deployment instructions match the
stack task 0001 actually ships. No code changes.

The current README "Installation instructions" prescribe the old flow: manage `.env.keys`, run
`dotenvx encrypt`, "Set up Nginx or whatever you're using", and
`dotenvx run docker compose up -- --detach`. As of task 0001 that is wrong for production:

- Prod secrets live in a gitignored `.env.docker` (created from the committed `.env.docker.example`
  template), wired into the `backend` and `requesthole-postgres` services via `env_file`. dotenvx is
  now **dev-only**.
- Nginx is **baked into the frontend image** (three-service Compose stack) — no manual Nginx setup.
- The app is served on a single origin at `http://localhost:${WEB_PORT:-8080}`.

## AFK tasks

- [x] Rewrite the README Installation/deployment section to the Docker flow. **Amended:** this task
      file predates task 0002, so its literal instructions (copy `.env.docker.example`, fill in
      `POSTGRES_*`, three-service stack) describe a stack that no longer exists. Implemented against
      the durable `## Architectural decisions` header and the shipped files instead: two services,
      no secrets, no env file required, `docker compose up --build --detach`, app at
      `http://localhost:8080` with `WEB_PORT` for other ports.
- [x] Remove/relocate the stale dotenvx `.env.keys` / `dotenvx encrypt` / manual-Nginx prod steps.
      **Already done** by a task-0002 review fix (commit `f6fbb77`), which replaced the
      dotenvx/Postgres install text before this branch started. dotenvx is gone from the repo
      entirely — it is not a dependency or a script in either project, so there is no "dev-only
      dotenvx" path left to document. Host dev loop documented under `## Development`.
- [x] Cross-check every command and path in the rewritten section against the actual repo. Done
      twice: a factual sweep citing file:line for all 14 claim groups, plus execution of every
      documented command (see the implementation log).

## Acceptance criteria

- [x] A newcomer can deploy the stack following only the README, with no dotenvx and no manual Nginx.
- [x] No instruction in the README contradicts the shipped `compose.yml` workflow. (The criterion's
      `.env.docker` reference is void — that file does not exist post-0002.)
- [x] The dev workflow (host `npm run dev`) remains documented and correct — it is now documented
      for the first time; the pre-existing README had no dev section at all.

## Implementation log

**2026-07-24** — built on `feature/readme-docker-install`. Documentation only; no code changed.

### What was built

`README.md` — the 13-line `## Installation instructions` section became three sections:

- `## Deployment` — prerequisites (Docker + Compose v2 only, no Node on the host),
  `docker compose up --build --detach`, `http://localhost:8080`, `WEB_PORT` via a root `.env` (the
  durable way) or inline, what the two services are and do, WAL sidecars as the reason `/data` is a
  directory volume, `down` vs `down -v`, and `scripts/smoke-test.sh` with its `--no-build` / `--down`
  flags and its `WEB_PORT` caveat.
- `## Development` — the two-project (non-workspace) layout, backend dev loop on `:3000` with its
  auto-created gitignored DB, frontend dev loop on `:5173` and the cross-origin/CORS arrangement,
  `npm test`, and lint/typecheck for both projects.
- `## Configuration` — top-level table for `DATABASE_PATH` (backend, required, no default) and
  `WEB_PORT` (Compose and the smoke test, default 8080).

Also `## Route design`: added the two registered-but-undocumented routes
(`GET /api/hole/:hole_address/events`, `GET /api/request/:request_address/body`) and marked the
unimplemented `GET /api/` row as such.

`.gitignore` — added `.env`, because the README now tells readers to create one for `WEB_PORT`. It
holds no secret, but the port a given host publishes on shouldn't be committed.

### Key paths

- [README.md](../../README.md) — the whole change
- [.gitignore](../../.gitignore) — the new `.env` rule
- [reviews/0003-readme-docker-install-review.md](../../reviews/0003-readme-docker-install-review.md)
  — two-round review, 21 findings, 19 fixed, 2 accepted (branch-scoped, gitignored)

### Decisions made

- **Followed the architectural header over this task file.** The file's AFK bullets prescribe
  `.env.docker`, `POSTGRES_*`, and a three-service stack; task 0002 retired all of it. The shipped
  code wins.
- **Documented a root `.env` as the durable way to set `WEB_PORT`**, and gitignored it. Compose
  re-reads it on every invocation, which inline vars don't survive.
- **Documented the smoke test's `WEB_PORT` trap rather than changing the script.** `smoke-test.sh:26`
  assigns `WEB_PORT` without `export`, so Compose falls back to `.env` while the script's probe stays
  on 8080. Fixing the script is a code change and out of scope for a docs task; the README warns
  instead.
- **Widened scope twice, deliberately**: the dev/test/lint documentation (needed for acceptance
  criterion 3, which the old README could not meet) and the three Route design table rows.

### Verification

Every command the README documents was executed:

- backend `npm test` — 23 tests, 3 files, green; `npm run lint`, `npm run typecheck` — clean
- frontend `npm run lint`, `npm run build` — clean; the subshell paste-block runs from the repo root
- `bash scripts/smoke-test.sh --down` — 8/8; `WEB_PORT=8099 bash scripts/smoke-test.sh --down` — 8/8
  on 8099, proving the corrected inline-port instruction
- `docker compose config` — `published: "80"` with `WEB_PORT=80` in `.env`, `"8080"` without it
- backend `npm run dev` — served `:3000`, created `data/requesthole.db` plus WAL sidecars and schema
  on first start; frontend `npm run dev` — served `:5173`
