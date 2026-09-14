# Task 0008: Text-only bodies by default (ALLOW_MEDIA)

**Branch**: `feature/allow-media`
**Depends on**: 0007 (extends the capture path, config knobs, and body endpoint it hardened)
**Source**: talk-it-through 2026-09-14, plus a media-type research pass the same day (IANA media
types and structured-suffix registries, RFC 9110/7578/2046/8259/5545/6350, and the webhook docs of
Stripe, GitHub, Twilio, Slack, SNS, Pub/Sub, SendGrid, Mailgun, Salesforce, Microsoft Graph) ·
**User stories**: "Anytime you put a free-to-use application on the internet that enables uploading
of images or video, people may use it to store illegal content on your system. I need a
configuration option that prevents storage and retrieval of images, video, and any sort of arbitrary
binary data." · "Allowing media is always a conscious choice — never the default." · "Enabling them
to be displayed in the UI when someone is inspecting a request is 100x worse" than storing them.

## What to build

Today every captured body is stored byte for byte and served back from
`GET /api/request/:request_address/body` under the sender's own `content-type`, so any hole is a
free file host. This task makes RequestHole **text-only by default**: bodies that are media, binary,
or text formats that render images are dropped before they reach the database, never served, and
never displayed. A new knob, `ALLOW_MEDIA`, turns today's behaviour back on for operators who
consciously want it.

The protection is layered: a declared-type allowlist, a byte check, and a file-signature check at
capture; the same checks again at read time; inert serving; and a viewer that refuses to build
images at all while media is off. A **description** of anything dropped is stored, so the viewer can
say what arrived instead of showing an empty panel.

### The knob

- `ALLOW_MEDIA`, read once in the config module like the other knobs (override → env → default).
  Accepts `true`/`false`/`1`/`0`, case-insensitive. **Unset means `false`.** Any other value
  (`yes`, `on`, empty string) throws at startup — a typo must never silently yield a deploy other
  than the one the operator meant. The config override is `allowMedia: boolean`.
- When on, log one info line at startup: `ALLOW_MEDIA on: media and binary bodies are stored and
  served`.
- With `ALLOW_MEDIA` on, capture, storage, serving, and the viewer behave exactly as they do today.
  Everything below describes media **off**.

### The body filter (media off)

One pure function decides, for a body plus its request headers, what gets stored and what
description of dropped content is recorded. A body is kept only if it passes every step; the first
failure drops it.

1. **Content-type parsing — strict.** Parse per RFC 9110's token grammar; the frontend's lenient
   parser is not suitable (it accepts `text/plain, image/png`). Type, subtype, and parameter names
   are case-insensitive. Drop on:
   - a malformed value (no slash, empty or non-token type/subtype, non-token characters, trailing
     garbage), or a wildcard such as `*/*`;
   - more than one `Content-Type` header — check the raw headers, since Node keeps only the first;
   - a duplicated parameter (`charset=utf-8; charset=latin1`);
   - `charset` of `utf-7`, `utf-16*`, or `utf-32*`.
   A **missing** `Content-Type` is legitimate (Pub/Sub unwrapped push omits it) and is gated as
   `text/plain`; the description records it as absent.
2. **Encodings.** Drop if `Content-Encoding` is anything but absent, empty, or `identity`
   (`gzip, identity` drops). Drop if `Transfer-Encoding` names any coding besides `chunked` — Node
   decodes only chunked, so the bytes would still be compressed. Compressed bodies are never
   decompressed: that invites decompression bombs for an edge case.
3. **Declared-type allowlist.**
   - **Top-level gate first:** only `application/*`, `text/*`, and `multipart/form-data` pass.
     `image/`, `audio/`, `video/`, `font/`, `model/`, `haptics/`, `message/`, `example/`, every other
     `multipart/*`, and unknown top-level types drop. The gate runs before suffix rules because
     `video/lottie+json`, `model/gltf+json`, and `image/svg+xml` would otherwise match them.
   - **`text/*`:** allowed, except `text/rtf`, `text/vcard`, `text/x-vcard`, `text/directory`,
     `text/calendar`, `text/uuencode`, `text/x-uuencode` — formats standard applications open with
     embedded images decoded. `text/html` **stays allowed** (decided: renaming a download to `.html`
     is no more effort than decoding base64, which is an accepted limit).
   - **`application/` suffix rules:** `+json`, `+xml`, `+yaml`, `+csv`, `+jwt`, `+sd-jwt`, `+jws`.
     `+xml` excludes `application/smil+xml` and `application/dash+xml`; `application/xhtml+xml`
     stays allowed, like `text/html`.
   - **`application/` exact subtypes:** `json`, `x-json`, `x-www-form-urlencoded`, `xml`, `xml-dtd`,
     `xml-external-parsed-entity`, `ndjson`, `x-ndjson`, `jsonl`, `jsonlines`, `x-jsonlines`, `yaml`,
     `x-yaml`, `toml`, `x-toml`, `javascript`, `x-javascript`, `ecmascript`, `csp-report`, `graphql`,
     `sql`, `csv`, `jwt`, `jose`, `x-sh`, `x-shellscript`, `jsonpath`, `sparql-query`,
     `sparql-update`, `n-triples`, `n-quads`, `trig`, `x-amz-json-1.0`, `x-amz-json-1.1`.
   - Everything else under `application/` drops — including `pdf`, `postscript`, `rtf`, `mbox`,
     `octet-stream`, `protobuf`, and `json-seq` (its RS record separator fails the byte check anyway).
   - `multipart/form-data` requires a `boundary` parameter and goes to step 6.
4. **Byte check.** Strict UTF-8 (`TextDecoder('utf-8', { fatal: true })` or `buffer.isUtf8`:
   overlong forms, surrogates, and truncated sequences fail). No C0 control characters except tab,
   LF, CR, and form feed — `NUL` in particular fails. DEL, C1 controls, and a leading UTF-8 BOM are
   allowed. An empty body is kept and records nothing.
5. **Signature check.** Some image and document formats are pure ASCII and would pass steps 1–4
   under `text/plain`. After an optional BOM and leading whitespace, drop a body whose start matches:
   `%PDF-` (pdf) · `%!PS` (postscript) · `{\rtf` (rtf) · `<svg`, or `<?xml` / `<!DOCTYPE` / comments
   followed by `<svg` within the first 1 KB (svg) · `/* XPM */` (xpm) · `#define` … `_width` (xbm) ·
   `P1`/`P2`/`P3` then whitespace then digits (netpbm) · `BEGIN:VCARD` with a `PHOTO` property
   (vcard) · `begin ` plus a three-digit mode (uuencode) · `MIME-Version:` (mime — deliberately drops
   SendGrid "raw" and Mailgun MIME forwarding, which carry whole emails with base64 attachments).
   Signatures are anchored at the start; never scan the body for `data:image/`, which would
   contradict the accepted base64 limit and break real JSON.
6. **Multipart, part by part.** Port the frontend's byte-level RFC 2046 multipart parser to the
   backend, with its tests — the packages are separate, so port rather than share. Then:
   - **Fail closed:** if the body cannot be parsed (missing boundary, regions that are not valid
     parts), it gets the whole-body steps 4–5 instead, which drops any hidden binary.
   - Each part runs steps 1, 3, 4, 5 against its own headers. A part with no `Content-Type` is
     `text/plain` (RFC 7578). A part carrying `Content-Transfer-Encoding`, or whose type is itself
     `multipart/*`, drops — no recursive parsing.
   - A dropped part **keeps its headers and loses its content**, so the form's structure survives and
     the viewer can show the drop in place.
   - The stored body is **rebuilt** from the parts: preamble and epilogue are discarded (parsers
     ignore them, but a stored raw body would keep arbitrary bytes there). The stored `headers`
     column is untouched, so `content-length` may no longer match the stored body; that is expected.

### Storage and API

- New nullable `requests.body_dropped` TEXT column holding JSON, added with an idempotent
  `ALTER TABLE` on older databases (the pattern `holes.creator_ip` uses). `null` means nothing was
  dropped. Shapes:
  - whole body: `{"reason": "type"|"encoding"|"bytes"|"signature"|"malformed", "bytes": 48213,
    "contentType": "image/png" | null, "contentEncoding"?: "gzip", "signature"?: "svg"}`
  - multipart: `{"parts": [{"index": 2, "name": "avatar", "filename": "me.png",
    "contentType": "image/png", "bytes": 48213, "reason": "type", "signature"?: "..."}]}`
  Names, filenames, and types are sender-controlled text: stored as data, rendered escaped.
- `body_dropped` is part of the request metadata everywhere it appears: the SSE capture frame, the
  hole's request list, and `GET /api/request/:request_address`.
- Each drop logs one info line — hole address, request address, declared type, byte count, reason —
  and never any content, so an operator can see file-hosting attempts in the logs.
- **Read side:** `GET /api/request/:request_address/body` runs the same filter over the stored body.
  If the filter would drop or change it (rows captured while media was on), the response is an empty
  `200` with `x-requesthole-body-withheld: true`; add that header to the CORS `exposedHeaders` so the
  dev server's cross-origin viewer can read it. The retention sweep removes such rows within
  `RETENTION_DAYS`; no purge migration.
- **Inert serving:** with media off, every body is served as `text/plain; charset=utf-8`, never the
  sender's type, keeping `x-content-type-options: nosniff` and `content-disposition: attachment`, and
  adding `Cross-Origin-Resource-Policy: same-origin` (blocks cross-origin `<img>` hotlinking; SVG is
  ORB-safelisted today). With media on, serving is unchanged.
- New `GET /api/config` returning `{ "allowMedia": boolean }`.

### Viewer

- Fetch `/api/config` once. If it fails or returns anything malformed, behave as **media off** —
  a missing answer must be safe.
- With media off, never create an `<img>` or blob preview, for the body or any multipart part.
- Detail view: when `body_dropped` is set, show a notice describing it — e.g. "Media/binary data
  dropped: 47 KB, image/png", "dropped: compressed body (gzip), 3 KB", "dropped: looks like an SVG
  image". For multipart, show each dropped part's notice in that part's place (matched by `index`).
- When the body endpoint answers with `x-requesthole-body-withheld`, show "Media/binary data not
  shown on this instance" rather than an empty body.
- List view: a muted marker on rows with `body_dropped`, with the size and type in its accessible
  name.
- With media off, a kept body with **no** `content-type` renders as text (the backend has
  guaranteed it is text), not as the binary hex preview. With media on it stays binary.
- Give the frontend's `classifyBody` the same top-level gate as the backend, so `image/foo+json` is
  not classified as JSON.

### Documented limits (README, not engineered)

Encoded binary inside allowed text passes, and the viewer shows it only as text, never as an image:
base64 (including `data:` URIs in JSON or HTML), percent-encoded bytes in form bodies, and `\u`
escapes in JSON. `MAX_BODY_BYTES` bounds their size; an operator can lower it. Compressed bodies are
dropped, not inspected. Legitimate but unlisted text types (and SendGrid raw / Mailgun MIME) are
dropped with a description; `ALLOW_MEDIA` on a private instance is the escape hatch.

## AFK tasks

- [ ] Test first: config parsing for `ALLOW_MEDIA` — unset is false; the four accepted spellings in
      any case; `yes`/`on`/empty throw; the override is honoured and validated.
- [ ] Test first: the body filter as a pure function — one case per drop rule (malformed and
      wildcard types, duplicate `Content-Type`, duplicate parameter, each banned charset, each
      encoding case, each top-level type, each `text/*` exclusion, the `+xml` exclusions,
      representative allowlist hits including suffix types, `NUL`/control bytes/invalid UTF-8/BOM/
      empty body, every signature including the leading-whitespace and `<?xml … <svg` forms) and the
      description each produces.
- [ ] Port the multipart parser with its tests; test first the part-level rules: fail-closed on
      unparseable bodies, part-level drops keep headers, `Content-Transfer-Encoding` and nested
      multipart drop, preamble/epilogue discarded, rebuilt body re-parses to the same kept parts.
- [ ] Add `requests.body_dropped` with the idempotent migration; wire the filter into the capture
      transaction; include `body_dropped` in the SSE frame, the request list, and the single-request
      fetch; add the drop log line.
- [ ] Read side: withheld header on bodies the filter would change or drop; `text/plain` + CORP
      serving with media off; `x-requesthole-body-withheld` exposed through CORS; `GET /api/config`.
- [ ] Make the two existing binary round-trip tests (the octet-stream round-trip and the
      content-type preservation test) opt in with `allowMedia: true`, and add counterparts asserting
      the default drops and withholds.
- [ ] Viewer: config fetch with fail-closed default; no `<img>`/blob with media off; dropped-body and
      dropped-part notices; withheld notice; list marker with accessible name; untyped bodies as
      text with media off; `classifyBody` top-level gate — each with component tests.
- [ ] Run the viewer in the in-app browser against the dev stack, media off and on: capture a PNG, an
      SVG as `text/plain`, a gzip JSON, a mixed multipart form, and a plain JSON webhook; confirm the
      notices, the marker, and that no image renders with media off. Keyboard and screen-reader
      semantics of the new notices and marker checked in the accessibility tree.
- [ ] README: Configuration table row for `ALLOW_MEDIA`, a note that the default changed (image and
      hex previews are now opt-in), and a "Limits of ALLOW_MEDIA" subsection with the documented
      limits above. Commented `# ALLOW_MEDIA: "false"` in `compose.yml`'s knob block.
## Acceptance criteria

- [ ] With `ALLOW_MEDIA` unset, a PNG, a gzip body, an `application/pdf`, an SVG sent as
      `text/plain`, and an XBM sent as `text/plain` are each stored with an empty body and a
      `body_dropped` description; a JSON, form, `text/plain`, and HTML webhook is stored unchanged.
- [ ] A multipart form with text fields and an image file stores the text fields, keeps the file
      part's headers with no content, records the part in `body_dropped.parts`, and has no preamble
      or epilogue; an unparseable multipart body containing binary is dropped whole.
- [ ] With media off, the body endpoint serves kept bodies as `text/plain; charset=utf-8` with
      `nosniff`, `attachment`, and `Cross-Origin-Resource-Policy: same-origin`, and answers a
      pre-existing binary body with an empty 200 and `x-requesthole-body-withheld: true`.
- [ ] `ALLOW_MEDIA=yes` refuses to start; `ALLOW_MEDIA=true` restores today's behaviour exactly, and
      logs the startup line.
- [ ] `body_dropped` arrives in SSE frames, the request list, and the single-request fetch; each drop
      writes one log line containing no body content.
- [ ] The viewer never renders an image with media off or when `/api/config` fails, shows the
      dropped, dropped-part, and withheld notices, marks dropped rows in the list, and renders an
      untyped kept body as text.
- [ ] The README documents the knob, the default change, and the limits; `compose.yml` carries the
      commented knob.
- [ ] Backend and frontend test suites, lint, and typecheck pass.
