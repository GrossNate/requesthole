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
Nginx to set up by hand. Beyond the published port and the `DATABASE_PATH` that
Compose sets for you, every setting is an optional resource bound with a
working default; see [Configuration](#configuration).

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
bare address and at a sub-path, the resource bounds (body limit, deleted-hole
404, dot-segment refusal, the `/api/` body cap), the SSE stream, the SPA
fallback, and persistence across a restart:

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
| `RETENTION_DAYS`         | backend             | `7`             | Holes older than this are deleted at startup and by an hourly sweep, along with their requests.                                                                                 |
| `MAX_REQUESTS_PER_HOLE`  | backend             | `100`           | Requests kept per hole. Each capture beyond the cap evicts that hole's oldest request.                                                                                          |
| `HOLE_CREATE_RATE_LIMIT` | backend             | `10`            | Hole creations allowed per client IP per hour; further ones get `429`.                                                                                                          |
| `CAPTURE_RATE_LIMIT`     | backend             | `60`            | Captures allowed per client IP per minute; further ones get `429`.                                                                                                              |
| `MAX_HOLES`              | backend             | `1000`          | Total holes the deployment will hold. At the ceiling, creation is refused with `503` — nothing is evicted to make room.                                                         |
| `MAX_HOLES_PER_IP`       | backend             | `20`            | Live holes one client may hold at once, IPv6 counted per /64. Beyond it, creation is refused with `429`, so filling `MAX_HOLES` takes many clients rather than one patient one. |
| `MAX_BODY_BYTES`         | backend             | `1048576`       | Largest request body a hole will capture; anything bigger is rejected with `413`.                                                                                               |
| `ALLOW_MEDIA`            | backend             | `false`         | Store and serve media and binary bodies. Off, RequestHole keeps text only and records what it dropped. See [Media and binary bodies](#media-and-binary-bodies).                 |

The backend knobs are all optional and apply to the running container: set them
under the `backend` service's `environment` in `compose.yml`, or pass them
through your shell. The numeric knobs must be positive integers, and
`ALLOW_MEDIA` must be `true`, `false`, `1` or `0` in any case; the backend
refuses to start on anything else, so a typo such as `ALLOW_MEDIA=yes` stops
the deploy instead of guessing. Rate limits key on the client address that Nginx
forwards in `X-Forwarded-For`, so one busy client cannot lock everyone else out.
Nginx sends only the peer address it saw, and the backend trusts exactly that
one hop, so a client cannot pick its own bucket by setting the header itself.
Nginx also leaves body size to the backend and streams bodies through
unbuffered, so `MAX_BODY_BYTES` is the one place the limit lives and an
oversized upload is cut off at the limit rather than spooled to disk first.
Nginx allows each client ten capture uploads in flight at once, and the backend
gives any request 30 seconds to arrive in full, so a slow upload cannot hold a
connection open indefinitely. The API routes take no bodies, so Nginx caps
anything sent to `/api/` at 16 KiB.

To count each client's share, the backend records the address that created
each hole. No route ever returns it, and the database copy is deleted along with
the hole. Client addresses still appear in the Nginx access log and the
backend's request log, and those are kept for as long as your log retention
keeps them.

Nginx has to face clients directly. If you put another proxy in front of this
stack, such as a TLS terminator or a load balancer, Nginx sees that proxy's
address for every visitor, and every per-client limit collapses into one bucket
that everyone shares. That includes the hole share, which is stored with each
hole: the 21st hole anyone creates would lock out hole creation for everyone
until holes are deleted or swept, restarts included. Tell Nginx to trust the
proxy's forwarded address with `set_real_ip_from` (your proxy's address) and
`real_ip_header X-Forwarded-For`, so `$remote_addr` is the real client again.

### Limits of the limits

These controls bound a stranger, not a determined, well-resourced one. The
edges below are deliberate trade-offs rather than defects. The first two can be
rebalanced with `MAX_HOLES_PER_IP` and `MAX_HOLES`; the last two are fixed in
`nginx.conf` and the backend, and need a code change to move.

- **"One client" means one IPv4 address or one IPv6 /64.** A home IPv6
  connection is usually delegated a /56, which holds 256 /64s. Spread across 50
  of them at the default share of 20, one subscriber can fill the default
  ceiling of 1000 holes in about two hours, after which everyone else's
  creations get `503` until holes expire. Lower `MAX_HOLES_PER_IP` or raise
  `MAX_HOLES` if that matters to you.
- **The hole share lasts as long as the holes do.** It counts live holes, not
  recent creations, so it frees up only as holes are deleted or swept. Behind
  a shared IPv4 address, such as carrier-grade NAT or an office network, one
  user who holds the whole share blocks their neighbours from creating holes
  for up to `RETENTION_DAYS`. Nobody can see whose holes count against the
  address, because the creator is never shown.
- **Nginx counts in-flight uploads per exact address.** For IPv6 that is each
  /128, so a client rotating addresses within its /64 gets past the cap of ten.
  The backend still bounds a /64 through `CAPTURE_RATE_LIMIT` and the 30-second
  request deadline, so the in-flight ceiling for a /64 is at most
  `CAPTURE_RATE_LIMIT` uploads, not ten.
- **The 30-second request deadline is fixed.** A body has to arrive within it,
  so raising `MAX_BODY_BYTES` also raises the upload speed a sender needs.
  At the default 1 MiB that is about 35 KB/s. At 50 MB it is about 1.7 MB/s,
  and slower senders get `408`.

This is a public, use-at-your-own-risk deployment model: there are no accounts,
every hole is listed on the home page, and anyone who knows an address can read
what was sent to it. The limits above bound what a stranger can consume; they
do not add access control.

### Media and binary bodies

RequestHole keeps text only unless you set `ALLOW_MEDIA=true`. Anything that
lets strangers upload images or video for free will be used to store content
you do not want on your disk, and showing that content in the viewer is worse
than storing it. So allowing media has to be a decision you make; it is never
the default.

**This changes earlier behaviour.** Before this setting existed, every body was
stored as sent, image bodies were shown inline, and binary bodies got a hex
preview and a download. Those previews now need `ALLOW_MEDIA=true`.

With media off, a body is kept only if it passes every check below. The first
failure drops it:

- **Content type.** The `Content-Type` is parsed strictly. A malformed value, a
  wildcard, a repeated header or parameter, or a charset that decodes as
  UTF-7, UTF-16 or UTF-32 drops the body. That includes aliases browsers
  read as UTF-16, such as `ucs-2` and `unicode`. A request with no `Content-Type` is treated as
  `text/plain`.
- **Encoding.** A compressed body (`Content-Encoding` other than `identity`, or
  a transfer coding other than `chunked`) is dropped, never decompressed.
- **Declared type.** `text/*`, `multipart/form-data`, and a list of text-based
  `application/*` types pass: JSON, XML, YAML, CSV, forms, JavaScript, GraphQL,
  JWTs and similar, plus any `+json`, `+xml`, `+yaml`, `+csv`, `+jwt`,
  `+sd-jwt` or `+jws` type. Images, audio, video, fonts, PDFs,
  `application/octet-stream`, and text formats that open with embedded images
  (RTF, vCard, iCalendar, uuencode) are dropped. HTML stays allowed.
- **Bytes.** The body must be valid UTF-8 with no control characters other than
  tab, line feed, carriage return and form feed.
- **File signature.** A body that starts like an RTF, SVG, XPM, XBM, Netpbm,
  vCard with a photo, uuencoded file or MIME message is dropped, whatever
  type it claims. PDF and PostScript headers count anywhere in the first
  1024 bytes, since that is where readers look for them. The SVG check skips
  the whole XML prolog (declaration, comments, doctype) however long it is,
  and accepts a namespace-prefixed root. A fixed limit would let padding hide
  the `<svg` behind it.
- **Multipart forms, part by part.** Each part gets the checks above. A
  dropped part keeps its headers and loses its content, so the form still
  shows every field. A part with `Content-Transfer-Encoding`, or one that is
  itself multipart, is dropped. The stored body is rebuilt from the parts, so
  any preamble or epilogue is discarded. Header blocks are stored as sent, so
  they must pass the byte check too. A multipart body that does not parse, that
  has a part header that is not text, or that never sends its closing
  boundary gets the whole-body byte and signature checks instead, so nothing
  in it is lost without a trace.

A dropped body is stored empty, with a description of what arrived: its size,
declared type and why it was dropped. The viewer shows that description in
place of the body and marks the row in the request list. While media is off it
never builds an image or a file download for anything, including when it
cannot reach `/api/config`, and it reads every body as UTF-8, the encoding
the byte check verified. The backend logs each drop as one line with the hole, the
request, the declared type, the size and the reason, and never any content.

With media off, the body endpoint serves every body as
`text/plain; charset=utf-8` with
`Cross-Origin-Resource-Policy: same-origin`, so no other site can embed it as
an image. It also runs the checks again when it serves a body. If you turn
media off after capturing with it on, the older binary bodies are answered
with an empty `200` and `x-requesthole-body-withheld: true` until the
retention sweep removes them.

### Limits of ALLOW_MEDIA

- **Encoded binary inside text passes.** Base64 (including `data:` URIs inside
  JSON or HTML), percent-encoded bytes in a form body, and `\u` escapes in JSON
  are all valid text. The viewer shows them only as text, never as an image,
  and `MAX_BODY_BYTES` bounds their size. Lower it if that matters to you.
- **No downloads with media off.** A text body longer than the viewer displays
  (256 KB, or 1000 form fields or parts) shows its beginning and says the rest
  is not shown. The full body is still available from the body endpoint.
- **Compressed bodies are dropped, not inspected.** A sender that gzips its
  webhooks loses the body; the description says it was compressed.
- **Some legitimate text is dropped.** A text type that is not on the list, SendGrid's
  "raw" inbound parse, and Mailgun's MIME forwarding are dropped with a
  description. The last two carry whole emails with base64 attachments. On a
  private instance, `ALLOW_MEDIA=true` is the way to keep them.

## Route design

| UI      | route                                  | purpose                                                      |
| :------ | :------------------------------------- | :----------------------------------------------------------- |
| GET     | `/`                                    | main - view all holes                                        |
| GET     | `/view/:hole_address`                  | view list of requests in a hole                              |
| GET     | `/view/:hole_address/:request_address` | the same list, with one request's detail alongside it        |
| &nbsp;  |                                        |
| **API** |                                        |
| GET     | `/api/`                                | list API reference? (not implemented)                        |
| GET     | `/api/holes`                           | get all holes info                                           |
| GET     | `/api/hole/:hole_address`              | get hole info                                                |
| POST    | `/api/hole`                            | create a new hole                                            |
| DELETE  | `/api/hole/:hole_address`              | delete a hole                                                |
| GET     | `/api/hole/:hole_address/requests`     | get all requests for a hole; `404` once the hole is gone     |
| GET     | `/api/hole/:hole_address/events`       | SSE stream: captures, `delete` and `hole-deleted` frames     |
| GET     | `/api/request/:request_address`        | get specific request                                         |
| GET     | `/api/request/:request_address/body`   | get a request's body; text only unless `ALLOW_MEDIA` is on   |
| DELETE  | `/api/request/:request_address`        | delete specific request                                      |
| GET     | `/api/config`                          | instance settings the viewer needs: `{ "allowMedia": bool }` |
| &nbsp;  |                                        |
| \*      | `/:hole_address`                       | hole endpoint to ingest HTTP requests                        |
| \*      | `/:hole_address/*`                     | the same hole; the full sub-path is stored with the request  |

A malformed bare address (`/abc12`) answers `400`, as it always has. An unknown
path with more than one segment (`/api/nope/x`) answers `404`: it reaches the
sub-path route only because nothing else matched, so it is a path that does not
exist rather than a bad address. Neither counts against the capture rate
limit. A path with a `.` or `..` segment, raw or percent-encoded, answers `404`
and is never captured.

A hole's requests endpoint answers `[]` for a hole with nothing in it and `404`
for a hole that has been deleted or swept, so a viewer that reconnects can tell
the two apart. The events stream carries three kinds of frame: an unnamed frame
for each capture, a `delete` frame when a request is deleted or evicted by the
per-hole cap, and one `hole-deleted` frame when the hole itself goes.
