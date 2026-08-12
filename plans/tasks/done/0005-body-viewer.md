# Task 0005: Content-aware request body viewer

**Branch**: `feature/body-viewer`
**Depends on**: 0004 (highlighting theme inherits the palette; both edit the request detail view)
**Source**: talk-it-through 2026-07-25 · **User stories**: "I want to improve the request view so that
I can display more types of request bodies in a user-friendly way. I.e. if it's a JSON body I want to
display it nicely formatted."

## What to build

Replace the current body-rendering branch of the request detail view with a content-type dispatcher
that renders each common real-world body family in a readable form. The existing implementation is
broken in ways that must be fixed as part of this, not worked around:

- It calls `getBody().then(setState)` **during render** rather than in an effect — a self-perpetuating
  fetch/re-render loop.
- It renders a `Buffer` directly as a React child, which displays nothing.
- Its JSON branch does `JSON.stringify(buffer)`, producing a byte map like `{"0":123,"1":34,…}`.
- It matches `content-type` with substring regexes, so `application/vnd.api+json` falls through to
  nothing rendered at all.
- Unknown types render an empty panel with no indication anything was captured.

### Security invariant — do not weaken

The body endpoint deliberately serves captured content with `x-content-type-options: nosniff` and
`content-disposition: attachment` so that stored attacker-controlled content cannot execute on this
origin. See the architectural header's untrusted-body bullet. Therefore:

- Fetch bytes with `fetch`/XHR (unaffected by `attachment`) and render them as **React text
  children**, which React escapes.
- **Never** `dangerouslySetInnerHTML`, and **never** iframe or navigate to the body URL.
- `text/html` bodies are displayed as **source text only** — never rendered as markup.
- `<img src>` remains acceptable: sub-resource loads ignore both headers.

### Content families in scope

Research on real-world webhook traffic (see Source) found `application/json` dominant, with
`application/x-www-form-urlencoded` second, XML in use (Shopify), and vendor subtypes such as
`application/vnd.foo.commithook+json` common — so suffix matching is mandatory, not optional.

1. **Structured text** — JSON, XML, YAML, NDJSON/JSONL, pretty-printed with indentation. Must handle
   `+json` and `+xml` structured suffixes and parameters like `; charset=utf-8`.
2. **Form encodings** — `application/x-www-form-urlencoded` decoded to a key/value table. When a
   value is itself JSON, offer it pretty-printed: GitHub and Slack both send the entire payload
   form-encoded as a single `payload` parameter, which is otherwise an unreadable escaped blob.
3. **`multipart/form-data`** — split on the boundary from the content-type parameter; list each part
   with its name, filename, and content-type; render text parts as text and image parts inline.
4. **Binary and unknown** — byte size, a short hex/ASCII preview, and a download link. Covers
   `application/octet-stream`, PDFs, audio, video, and anything unrecognized. Images continue to
   render inline.

### Presentation

- Syntax highlighting via **highlight.js**, importing only the `json`, `xml`, `yaml`, and
  `javascript` languages rather than the full bundle. Its stylesheet must inherit task 0004's palette.
- Display is capped at roughly 256 KB with an explicit truncation marker plus a download link for the
  whole body — pretty-printing a megabyte of JSON into DOM nodes is what freezes a tab.
- An empty body (no `content-type`, or zero bytes) says so explicitly instead of rendering nothing.
- Malformed content that claims a structured type falls back to raw text with a note, rather than
  throwing.

## AFK tasks

- [x] Write a media-type parser (type, subtype, structured suffix, parameters) with tests, and
      dispatch on its output. No substring matching on the raw header.
- [x] ~~Move body fetching into a proper effect keyed on the request address, eliminating the
      render-phase fetch loop. Test that one mount issues one fetch.~~ **Done in task 0004** — the
      render-phase fetch was an unbounded request loop for JSON bodies, live on `main`, so it was
      fixed while the component was being restyled. `Request.tsx` fetches in a `useEffect` keyed on
      the request address, and `Request.test.tsx` asserts one mount issues one fetch.
- [x] Fetch the body as bytes and decode per the charset parameter, defaulting to UTF-8. **Note:**
      0004 added `holeService.getBodyBytes()` (`responseType: "arraybuffer"`) for the PDF download —
      reuse it rather than adding another. `getBody()` was also pinned to `responseType: "text"`
      with an identity transform in 0004, so axios no longer silently JSON-parses captured bodies.
- [x] Implement the structured-text renderer: JSON, XML, YAML, NDJSON, pretty-printed, with tests per
      format including malformed-input fallback.
- [x] Implement the form-encoded renderer with a key/value table, plus nested-JSON pretty-printing for
      values that parse as JSON. Test with a GitHub-style `payload=<json>` fixture.
- [x] Implement `multipart/form-data` boundary parsing and per-part rendering, with tests covering
      multiple parts, a file part with a filename, and a part whose own content-type is an image.
- [x] Implement the binary/unknown renderer: byte size, hex/ASCII preview, download link. Test that an
      unrecognized content-type renders this rather than nothing. **Note:** 0004 already built the
      download path — the bytes are fetched and handed over as an app-owned `application/octet-stream`
      blob URL with `<a download>`, never a link to the body endpoint (the PDF branch of
      `Request.tsx`). Reuse that shape here; do not re-derive it, and keep the cancellation guard
      that revokes a blob whose fetch lands after cleanup.
- [x] Keep inline image rendering working for `image/*`.
- [x] Wire in highlight.js with only the four languages registered, themed to match 0004's palette.
- [x] Implement the ~256 KB display cap with a truncation marker and a full-body download link; test
      the boundary.
- [x] Add an explicit empty-body state.
- [x] Add a test asserting no code path renders body content as markup — no
      `dangerouslySetInnerHTML`, no iframe, no navigation to the body URL — so the security invariant
      cannot silently regress.

## Human-in-the-loop tasks

- [x] [verify] Look at highlighted output for JSON, XML, and an HTML source body against the dark
      palette and confirm it is readable and not garish — colour harmony is a judgment no assertion
      can make. *(Verified by Nathan 2026-08-08: looks okay.)*

## Acceptance criteria

- [x] A JSON body renders pretty-printed and highlighted, including for `+json` vendor subtypes and
      with a `charset` parameter present.
- [x] A form-encoded body renders as a key/value table, and a GitHub/Slack-style `payload` parameter
      renders as formatted JSON.
- [x] A multipart body lists its parts with names, filenames, and content-types, rendering text and
      image parts appropriately.
- [x] An unrecognized or binary content-type renders size, a preview, and a download link — never an
      empty panel.
- [x] An HTML body is shown as escaped source and is never rendered as markup.
- [x] A body over the display cap shows a truncation marker and offers a full download.
- [x] Mounting the detail view issues exactly one body fetch; no render-phase side effects remain.
      *(Met in task 0004; keep it true.)*
- [x] `nosniff` and `content-disposition: attachment` on the body endpoint are unchanged.

## Implementation log

Built 2026-08-07 on `feature/body-viewer`. Key files: `src/utils/mediaType.ts` (parser +
`classifyBody` dispatcher + quote-aware `parseParameters`), `src/utils/prettyPrint.ts` (JSON /
NDJSON / XML formatters, all returning undefined on malformed input), `src/utils/multipart.ts`
(byte-level boundary parser, RFC-anchored delimiters, skipped-region count),
`src/utils/hexPreview.ts`, `src/utils/highlight.tsx` (hljs core + 4 languages; output converted
to React elements through a span whitelist — no markup injection anywhere),
`src/components/RequestBody.tsx` (the viewer), hljs theme in `src/index.css`, source-scan
tripwire in `src/components/bodySecurity.test.ts`. `getBody()` was removed from `services.ts`;
all body reads go through `getBodyBytes()` + `TextDecoder` per the charset parameter.

**Recorded deviations from the spec text:**

- **YAML gets highlighting but no reformatting and no malformed-input note.** Nearly any text is
  a valid YAML scalar (a prose paragraph parses fine), so a "didn't parse as YAML" note would
  essentially never fire, and validating would require a parser dependency (`js-yaml`) with no
  user-visible benefit. YAML is already line-oriented; highlighting is the value.
- **"No content-type" with non-zero bytes renders the binary view, not the empty-body state.**
  The spec's empty-body definition ("no content-type, or zero bytes") conflated the two; a body
  with bytes but no declared type is unknown content, and showing size + preview + download is
  strictly more honest than "empty". The empty state fires on zero bytes only. (An image-typed
  body that fails to load — empty, corrupt, or backend down — gets its own explicit "couldn't
  display" state via `<img onError>`.)
- **Multipart bodies skip the whole-body ~256 KB display cap.** An upload with one large file
  part should still list its parts rather than collapse to a truncated text dump, so the caps
  apply per part instead: each text part is capped at 256 KB with a truncation marker, parts are
  row-capped at 1,000 with an omission note and a whole-body download, and binary parts render a
  fixed-size hex preview plus their own download. Aggregate DOM size stays bounded by those two
  caps; the single-number byte cap is deliberately not enforced across parts.

**Review fixes applied (see `reviews/0005-body-viewer-review.md`, all 15 findings):** multipart
image parts are raster-only (png/jpeg/gif/webp/bmp/avif/ico) and their blobs — like every blob
the app makes — are typed `application/octet-stream`, never the attacker's declared type, so an
`image/svg+xml` part can't become a script-capable same-origin document; a failed body fetch
renders an explicit "couldn't load" state; binary bodies over the cap keep hex-preview + download
instead of a forced text decode, and the truncated-text prefix honors the charset; form pairs and
multipart parts are row-capped at 1,000 with an omission note and download; parse/format/highlight
work is memoized; `parseParameters` honors quoted semicolons and escaped quotes; multipart
delimiters are CRLF-anchored with unparseable regions surfaced, and empty-header parts kept;
`Request.tsx` gates the body viewer on the loaded record matching the route; the security scan
bans markup/navigation sinks app-wide and pins the body endpoint to services.ts + `<img src>`.
