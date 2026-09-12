<img
  src="./favicon.png" 
  alt="RequestHole logo"
  width="192" />

# RequestHole

A place to capture, store, and examine your HTTP requests.

## Deployment

The only prerequisite is [Docker](https://docs.docker.com/get-docker/) with
Compose v2. You don't need Node on the host, and a default deploy needs no
configuration at all: no secrets, no separate database to provision, and no
Nginx to set up by hand. Beyond the published port, every setting is an
optional resource bound with a working default; see
[Configuration](#configuration).

From the repository root:

```sh
docker compose up --build --detach
```

Then open `http://localhost:8080`.

To publish on a different host port — port 80 for a public deploy — set
`WEB_PORT`. Compose reads it on every invocation rather than remembering it, so
the durable way is a `.env` file in the repository root, which Compose picks up
automatically:

```sh
echo 'WEB_PORT=80' > .env
docker compose up --build --detach
```

Passing it inline works too (`WEB_PORT=80 docker compose up --build --detach`),
but then every later `docker compose up` for that deployment needs it as well:
leave it off once and Compose recreates `nginx` back on 8080. Commands that
don't recreate containers — `down`, `logs`, `ps`, `stop` — don't care either way.

That builds two services:

- **`nginx`** — the Vite frontend, built to static assets and served by Nginx
  from the same image. This is the only published port. It also reverse-proxies
  `/api/*` and the six-character collect addresses, with any sub-path beneath
  them (`^/[a-zA-Z0-9]{6}(/.*)?$`), to the backend, so the whole app lives on
  one origin. The built `/assets/` directory is matched first, so a hashed
  asset name that happens to look like an address is never proxied.
- **`backend`** — Fastify, reachable only inside the Compose network at
  `backend:3000`. It stores everything in SQLite at `/data/requesthole.db` on
  the `data` volume, and creates its own tables on startup — there is no
  migration step. SQLite runs in WAL mode, so it writes `-wal` and `-shm`
  sidecars alongside that file; all three have to persist together, which is why
  `/data` is a directory volume rather than a single mounted file.

Captured data lives in that `data` volume and survives `docker compose down`.
Run `docker compose down -v` when you want to throw it away.

To exercise a deployment end to end — hole creation, request capture at the
bare address and at a sub-path, the SSE stream, the SPA fallback, and
persistence across a restart:

```sh
bash scripts/smoke-test.sh
```

It is not a read-only probe. It brings the stack up itself with `--build`, and
restarts it partway through to prove the data survives. Pass `--no-build` to
reuse a stack that's already running, or `--down` to stop the stack at the end
(that leaves the `data` volume alone).

If your deployment isn't on 8080, pass the port inline:

```sh
WEB_PORT=80 bash scripts/smoke-test.sh
```

The script reads `WEB_PORT` from its environment only — unlike Compose, it does
not read `.env`. Run it bare against an `.env`-configured deployment and it will
rebuild your stack on the `.env` port while probing 8080, then give up with
"origin never became ready".

## Development

The backend and frontend are two independent npm projects, not a workspace, so
install and run each from its own directory. Node 24 matches what the images
build with. Neither project needs an environment file in development.

In one terminal:

```sh
cd requesthole_backend && npm install && npm run dev
```

That serves the API on `http://localhost:3000` and writes its database to
`requesthole_backend/data/requesthole.db` (created on first run, and
gitignored).

In another:

```sh
cd requesthole_frontend && npm install && npm run dev
```

That serves the UI on `http://localhost:5173`. A dev build talks to the backend
cross-origin at `localhost:3000`, which the backend's CORS config allows; a
production build uses relative URLs and goes through Nginx instead.

Both projects test the same way — typecheck, then Vitest:

```sh
cd requesthole_backend  && npm test
cd requesthole_frontend && npm test
```

The backend suite runs against in-memory and temporary-file SQLite databases,
so it needs neither Docker nor a running server. The frontend suite runs in
jsdom with Testing Library; its tests sit next to the code they cover, as
`src/**/*.test.ts(x)`. Both projects lint, and both typecheck — the frontend
does it as the first half of its build:

```sh
(cd requesthole_backend  && npm run lint && npm run typecheck && npm test)
(cd requesthole_frontend && npm run lint && npm run build && npm test)
```

## Configuration

| Variable                 | Used by             | Default         | Purpose                                                                                                                                                                         |
| :----------------------- | :------------------ | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_PATH`          | backend             | none — required | Path to the SQLite file. Compose sets it to `/data/requesthole.db`; the dev script sets it to `./data/requesthole.db`.                                                          |
| `WEB_PORT`               | Compose, smoke test | `8080`          | Host port that the `nginx` service publishes.                                                                                                                                   |
| `RETENTION_DAYS`         | backend             | `7`             | Holes older than this are deleted by an hourly sweep, along with their requests.                                                                                                |
| `MAX_REQUESTS_PER_HOLE`  | backend             | `100`           | Requests kept per hole. Each capture beyond the cap evicts that hole's oldest request.                                                                                          |
| `HOLE_CREATE_RATE_LIMIT` | backend             | `10`            | Hole creations allowed per client IP per hour; further ones get `429`.                                                                                                          |
| `CAPTURE_RATE_LIMIT`     | backend             | `60`            | Captures allowed per client IP per minute; further ones get `429`.                                                                                                              |
| `MAX_HOLES`              | backend             | `1000`          | Total holes the deployment will hold. At the ceiling, creation is refused with `503` — nothing is evicted to make room.                                                         |
| `MAX_HOLES_PER_IP`       | backend             | `20`            | Live holes one client may hold at once, IPv6 counted per /64. Beyond it, creation is refused with `429`, so filling `MAX_HOLES` takes many clients rather than one patient one. |
| `MAX_BODY_BYTES`         | backend             | `1048576`       | Largest request body a hole will capture; anything bigger is rejected with `413`.                                                                                               |

The backend knobs are all optional and apply to the running container: set them
under the `backend` service's `environment` in `compose.yml`, or pass them
through your shell. Each must be a positive integer; the backend refuses to
start on anything else. Rate limits key on the client address that Nginx
forwards in `X-Forwarded-For`, so one busy client cannot lock everyone else out.
Nginx sends only the peer address it saw, and the backend trusts exactly that
one hop, so a client cannot pick its own bucket by setting the header itself.
Nginx also leaves body size to the backend and streams bodies through
unbuffered, so `MAX_BODY_BYTES` is the one place the limit lives and an
oversized upload is cut off at the limit rather than spooled to disk first.
Nginx allows each client ten capture uploads in flight at once, and the backend
gives any request 30 seconds to arrive in full, so a slow upload cannot hold a
connection open indefinitely.

To count each client's share, the backend records the address that created
each hole. No route ever returns it, and it is deleted along with the hole.

If you put another proxy in front of this stack, such as a TLS terminator or a
load balancer, Nginx sees that proxy's address for every visitor, and the
per-client limits collapse into one bucket that everyone shares. Tell Nginx to
trust the proxy's forwarded address with `set_real_ip_from` (your proxy's
address) and `real_ip_header X-Forwarded-For`, so `$remote_addr` is the real
client again.

This is a public, use-at-your-own-risk deployment model: there are no accounts,
every hole is listed on the home page, and anyone who knows an address can read
what was sent to it. The limits above bound what a stranger can consume; they
do not add access control.

## Route design

| UI      | route                                  | purpose                                                     |
| :------ | :------------------------------------- | :---------------------------------------------------------- |
| GET     | `/`                                    | main - view all holes                                       |
| GET     | `/view/:hole_address`                  | view list of requests in a hole                             |
| GET     | `/view/:hole_address/:request_address` | the same list, with one request's detail alongside it       |
| &nbsp;  |                                        |
| **API** |                                        |
| GET     | `/api/`                                | list API reference? (not implemented)                       |
| GET     | `/api/holes`                           | get all holes info                                          |
| GET     | `/api/hole/:hole_address`              | get hole info                                               |
| POST    | `/api/hole`                            | create a new hole                                           |
| DELETE  | `/api/hole/:hole_address`              | delete a hole                                               |
| GET     | `/api/hole/:hole_address/requests`     | get all requests for a hole                                 |
| GET     | `/api/hole/:hole_address/events`       | SSE stream of requests as they arrive                       |
| GET     | `/api/request/:request_address`        | get specific request                                        |
| GET     | `/api/request/:request_address/body`   | get a request's raw body                                    |
| DELETE  | `/api/request/:request_address`        | delete specific request                                     |
| &nbsp;  |                                        |
| \*      | `/:hole_address`                       | hole endpoint to ingest HTTP requests                       |
| \*      | `/:hole_address/*`                     | the same hole; the full sub-path is stored with the request |

A malformed bare address (`/abc12`) answers `400`, as it always has. An unknown
path with more than one segment (`/api/nope/x`) answers `404`: it reaches the
sub-path route only because nothing else matched, so it is a path that does not
exist rather than a bad address. Neither counts against the capture rate
limit.
