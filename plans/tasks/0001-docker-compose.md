# Task 0001: Dockerize the stack (Compose: backend + Nginx/frontend + Postgres)

**Branch**: `feature/docker-compose`
**Depends on**: none
**Source**: talk-it-through 2026-07-22 · **User stories**: As the maintainer, I want the whole app
to run on one origin via `docker compose up` so deployment is a single command and the backend/DB
are not exposed to the host.

## What to build

A prod-only Docker Compose stack that runs RequestHole as three services on a single published
origin. Nginx serves the built frontend and reverse-proxies API + collect traffic to the backend;
the backend and Postgres are internal-only. The app must behave identically to today when reached
through Nginx: create/list/delete holes, capture requests at `/:hole_address`, view requests, and
receive live updates over SSE. This task stays on Postgres — SQLite is task 0002.

Durable decisions (topology, routing table, image strategy, secrets) are in the master plan
architectural header; this file distills what the implementer needs.

### Topology
- `nginx` — only service publishing a host port: `${WEB_PORT:-8080}:80` (deploy sets `WEB_PORT=80`).
  This service *is* the frontend image's final stage (static assets + routing config baked in).
- `backend` — Node/Fastify, internal-only, reachable as `http://backend:3000`.
- `requesthole-postgres` — internal-only. Drop the current `5432:5432` host mapping. Keep the
  `postgres-data` named volume.

### Nginx routing (`requesthole_frontend/nginx.conf`, copied into the image)
1. `location /api/` → `http://backend:3000`, with SSE-safe settings applied to the whole block:
   `proxy_http_version 1.1`, `proxy_buffering off`, `proxy_set_header Connection ""`, long/disabled
   `proxy_read_timeout`. (Covers the `/api/hole/:addr/events` stream.)
2. `location ~ "^/[a-zA-Z0-9]{6}$"` → `http://backend:3000`, all methods — the collect-capture
   resolver mirroring `fastify.all("/:hole_address")`. Bare address only.
3. `location /` → `try_files $uri $uri/ /index.html` — static assets + SPA fallback.

### Images
- **Backend** (`requesthole_backend/Dockerfile`, `.dockerignore`): base `node:24-slim` (chosen now
  to avoid `better-sqlite3` native-compile pain in task 0002). Multi-stage — build stage `npm ci` +
  `npm run build` (`tsc` → `dist/`); runtime stage runs its *own* `npm ci --omit=dev` and copies in
  `dist/` (do not copy `node_modules` across stages). Run `node dist/index.js`.
- **Frontend** (`requesthole_frontend/Dockerfile`, `.dockerignore`): multi-stage — build stage
  `node:24-slim` runs `npm ci` + `npm run build` (prod build → `BASE_URL=""`); final stage
  `nginx:alpine` copies `dist/` → `/usr/share/nginx/html` and `nginx.conf` →
  `/etc/nginx/conf.d/default.conf`.

### Secrets
- Gitignored `.env.docker` (NOT `.env` — avoids the dotenvx/Compose filename collision). Both
  `requesthole-postgres` and `backend` reference it via `env_file`. Holds `POSTGRES_USER`,
  `POSTGRES_PASSWORD`, `POSTGRES_DB`, and a ready-built
  `POSTGRES_URI=postgres://…@requesthole-postgres:5432/requesthole`. Add a committed
  `.env.docker.example` template. dotenvx and the host dev loop are untouched.

## AFK tasks

- [x] Change `fastify.listen({ port: 3000 })` → `fastify.listen({ port: 3000, host: "0.0.0.0" })`
      in `requesthole_backend/src/index.ts` (container reachability).
- [x] Backend `Dockerfile` + `.dockerignore` (`node_modules`, `dist`, `.env*`, `.git`) per the
      multi-stage `node:24-slim` spec above.
- [x] Frontend `Dockerfile` + `.dockerignore`, multi-staging into `nginx:alpine`.
- [x] `requesthole_frontend/nginx.conf` implementing the three-rule routing table.
- [x] Rework `compose.yml` into the three-service stack; drop the Postgres `5432:5432` host mapping;
      keep the `postgres-data` volume; wire `env_file: [.env.docker]`; publish only
      `nginx` on `${WEB_PORT:-8080}:80`.
- [x] Add `.env.docker` to `.gitignore`; add a committed `.env.docker.example`.
- [x] Smoke-test script: `docker compose up -d --build`, then assert against the Nginx origin —
      `POST /api/hole` → 201; `GET /api/holes` includes it; `POST /:address` (collect) → 200;
      `GET /` returns the SPA HTML; a hashed static asset loads; the SSE endpoint
      `/api/hole/:addr/events` streams an event when a request is captured (curl with a timeout).

## Human-in-the-loop tasks

- [x] [verify] Bring the stack up, open the app in a browser, create a hole, send it a request, and
      confirm the request appears live in the React UI via SSE — end-to-end browser rendering +
      EventSource behavior through Nginx can't be fully asserted by the curl smoke test.
      *Confirmed by the user 2026-07-22: a curl request to the hole address rendered live in the UI.*

## Acceptance criteria

- [x] `docker compose up --build` serves the entire app on `http://localhost:${WEB_PORT:-8080}`
      from a single origin.
- [x] Only `nginx` is reachable from the host; `backend` and `requesthole-postgres` are not
      published. *(Verified: `curl localhost:3000` refused; `nc localhost 5432` closed.)*
- [x] Every current behavior works through Nginx: hole CRUD, request capture at `/:hole_address`,
      request viewing, and live SSE updates. *(Smoke test 7/7; browser SSE render confirmed.)*
- [x] The collect route captures bare 6-char addresses; SPA deep links (`/view/...`) resolve on
      hard refresh; static assets load.
- [x] No secrets are committed; `.env.docker` is gitignored and `.env.docker.example` documents the
      required keys. dotenvx dev loop still works unchanged.

## Implementation log

**2026-07-22** — Built the three-service prod Compose stack on branch `feature/docker-compose`.

Key files:
- `requesthole_backend/Dockerfile` + `.dockerignore` — multi-stage `node:24-slim`; runtime stage
  runs its own `npm ci --omit=dev` and copies only `dist/`. `requesthole_backend/src/index.ts`
  binds `0.0.0.0`.
- `requesthole_frontend/Dockerfile` + `.dockerignore` — build → `nginx:alpine`.
  `requesthole_frontend/nginx.conf` — `/api/` proxy (SSE-safe: HTTP/1.1, `proxy_buffering off`,
  `Connection ""`, 24h read timeout), collect regex, SPA `try_files` fallback.
- `compose.yml` — `requesthole-postgres` (internal, healthcheck), `backend` (internal,
  `depends_on: service_healthy`), `nginx` (only host-published, `${WEB_PORT:-8080}:80`).
- `.env.docker.example` committed; `.env.docker` + `reviews/` gitignored.
- `scripts/smoke-test.sh` — 7 assertions through the Nginx origin.

Decisions / deviations:
- Added a Postgres healthcheck + `depends_on: service_healthy` and `restart: always` (startup
  hardening beyond the literal spec) — surfaced in review, kept deliberately.
- **User-approved mid-task fix** (task-review Bug finding): `generateAddress()` now left-pads to a
  fixed 6-char address (`ADDRESS_LENGTH = 6`); the three backend schemas
  (`hole.ts`/`collect.ts`/`request.ts`) and the nginx collect regex moved `{5,6}` → `{6}`; the
  smoke test's extraction was tightened to `{6}` to lock the contract. Plan/architecture docs
  reconciled to `{6}`.
- Review follow-up split out as **task 0003** (rewrite README for the Docker deploy workflow).
- Gotcha: a stale `postgres-data` volume from earlier dev caused a first-run auth failure (old creds
  baked in); `docker compose down -v` resets it. Irrelevant on a fresh deploy.

Review: `reviews/0001-docker-compose-review.md` — Security clean; remaining open findings are the
README (→ task 0003) and were doc-only.
