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

- [ ] Rewrite the README Installation/deployment section to the Docker flow: copy
      `.env.docker.example` → `.env.docker`, fill in `POSTGRES_USER` / `POSTGRES_PASSWORD` /
      `POSTGRES_DB` / `POSTGRES_URI`, then `docker compose up -d --build`; app at
      `http://localhost:${WEB_PORT:-8080}` (note `WEB_PORT=80` for a real deploy).
- [ ] Remove/relocate the stale dotenvx `.env.keys` / `dotenvx encrypt` / manual-Nginx prod steps.
      Keep the host dev loop (`npm run dev`, dotenvx dev-only) documented as the dev path.
- [ ] Cross-check every command and path in the rewritten section against the actual repo
      (`compose.yml`, `.env.docker.example`, service names, ports).

## Acceptance criteria

- [ ] A newcomer can deploy the stack following only the README, with no dotenvx and no manual Nginx.
- [ ] No instruction in the README contradicts the shipped `compose.yml` / `.env.docker` workflow.
- [ ] The dev workflow (host `npm run dev`) remains documented and correct.
