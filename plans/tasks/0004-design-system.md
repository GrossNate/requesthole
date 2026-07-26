# Task 0004: Design system and UI defect fixes

**Branch**: `feature/design-system`
**Depends on**: none
**Source**: talk-it-through 2026-07-25 · **User stories**: "I want to polish the UI. I like the logo
I created, but the overall look should be more compelling."

## What to build

A deliberate visual identity for the app, plus the shared UI vocabulary later phases assemble from.
This phase is **layout-agnostic on purpose**: it establishes theme tokens, a type scale, spacing, and
small shared components, so that when task 0006 restructures the layout none of this work is thrown
away. It does not restructure any page.

The logo (`requesthole_frontend/public/favicon.png`, 192×192 RGBA with transparency) is the source of
the palette — violet/magenta accents on a near-black base. Today the only styling in the entire app
is `@plugin "daisyui" { themes: dark }` plus a hardcoded `data-theme="dark"`, so the logo reads as
deliberate and everything around it reads as stock daisyUI.

Three outright defects get fixed here too, because they sit in the components being restyled and
would otherwise look like styling omissions.

**Dark mode only.** `data-theme="dark"` stays hardcoded; no theme switcher, no light palette.

## AFK tasks

- [x] Define a custom daisyUI theme in `index.css` — colors sampled from the logo, on a near-black
      base. daisyUI themes are CSS variables, so this is one block, not per-component churn. Keep the
      theme name and variable set documented in a comment, since task 0005's syntax-highlighting
      theme inherits from it.
- [x] Establish a type scale and spacing rhythm, replacing the ad-hoc `text-xl` / `ps-3` / `p-3`
      usages currently scattered through the components.
- [x] Restyle the app shell: header/navbar, the logo–wordmark pairing (currently a bare `max-h-10`
      image next to plain text), breadcrumbs, and buttons.
- [x] Restyle the two tables (hole list, request list) for legibility — sensible column widths,
      monospace for addresses and paths, readable row density.
- [x] Build a reusable empty-state component and use it everywhere a list can be empty: no holes on
      the home page, no requests in a hole. The hole empty state must show the hole's full capture
      URL and tell the user to send a request to it.
- [x] Build a reusable copy-to-clipboard component with visible confirmation feedback, replacing the
      bare `⿻` glyph button. Write a test asserting it copies the intended string.
- [x] **Defect** — the copy button copies a relative path. `holeFullUrl` is built from `BASE_URL`,
      which is `""` in production, yielding `/abc123` — useless pasted into a webhook config. Derive
      an absolute URL from the browser's origin. Cover with a test.
- [x] **Defect** — the request list's "Params" column renders the request's `headers` field. Show the
      query params instead (or drop the column if the params belong elsewhere). Cover with a test.
- [x] **Defect** — both table header rows use `<td>` for header cells. Use `<th>` with proper scope.
      (Only the request list actually used `<td>`; the hole list's single `<th colSpan={2}>` was a
      caption, not column headers. Both now have real `<th scope="col">` columns, and the request
      detail page's header table got `scope="row"`.)
- [x] Add frontend test infrastructure if none exists (Vitest is already a backend dependency;
      the frontend currently has no test script and no tests), and wire a `test` script into
      `requesthole_frontend/package.json`.

## Human-in-the-loop tasks

- [ ] [verify] Look at the restyled app and judge whether it reads as more compelling — "compelling"
      is an aesthetic judgment no assertion can make. Check the logo/wordmark pairing, the palette
      against the logo, and legibility of the two tables.

## Acceptance criteria

- [x] The palette visibly derives from the logo; the app and the logo read as one design.
- [x] A type scale and spacing system exist and are used, rather than ad-hoc utility classes.
- [x] Every list has a designed empty state; the empty hole state shows the full capture URL.
- [x] The copy button copies an absolute, pasteable URL and confirms visibly that it copied.
- [x] The request list's "Params" column shows params, not headers.
- [x] Table header cells are `<th>`.
- [x] The frontend has a working test command, and the defect fixes are covered by tests.
- [x] No page layout was restructured — that is task 0006.

## Implementation log

**2026-07-25** — built on `feature/design-system`, one commit. 24 frontend tests, all green;
backend untouched and still green (23 tests).

**Decisions made**

- **Theme name.** The custom daisyUI theme is registered as `name: "dark"` with
  `themes: false` disabling the built-ins, so the hardcoded `data-theme="dark"` in `index.html`
  keeps working unchanged and no light palette is compiled. Extend the theme in `index.css`
  rather than adding a second one.
- **Palette source.** Colors were sampled from `public/favicon.png` by decoding the PNG directly
  (measured, not guessed). The measured ramp is recorded in the `index.css` header comment, so
  task 0005's syntax theme can derive from the same values. `notes.md`'s `#1d1130` turned out to
  sit inside the logo's dark-plum family and is now `--color-base-200`.
- **Tokens over utilities.** Type scale is six named `--text-*` steps (`text-caption` …
  `text-display`); spacing is four named steps (`tight`/`snug`/`gutter`/`section`). Components use
  those names, not `text-xl`/`p-3`. Four semantic classes carry repeated intent: `.address`,
  `.page-title`, `.section-label`, `.scroll-pane`.
- **Capture URL.** `holeCaptureUrl()` falls back to `window.location.origin` when `BASE_URL` is
  `""` (production), and prefers `BASE_URL` in dev — where the page is on `:5173` but capture only
  answers on the backend's `:3000`.
- **Types corrected.** `RequestObject.created` was typed `number` but is ISO-8601 text;
  `headersObject` is client-side only and is now optional.

**Key files**

- `requesthole_frontend/src/index.css` — the whole design system (theme, tokens, semantic classes)
- `requesthole_frontend/src/components/EmptyState.tsx`, `CopyButton.tsx`, `MethodBadge.tsx` — new
- `requesthole_frontend/src/utils/holeUrl.ts` — absolute capture URL
- `requesthole_frontend/src/utils/format.ts` — `formatQueryParams`, `formatTimestamp`
- `requesthole_frontend/vite.config.ts`, `src/test-setup.ts` — Vitest + jsdom + Testing Library
- `README.md` — testing section updated; the frontend now has a `npm test`

**Review round 2** — `task-review` ran a four-lens panel (Standards, Spec, Bug, Security) and
raised 18 findings. The user read the review and approved fixing all of them except one Spec nit
(the navbar's live hole count, kept as-is). What changed:

- **Body fetch moved out of render** (`Request.tsx`). The content-type dispatch called
  `getBody()` during render; for JSON bodies axios returned a fresh object each time, so React
  re-rendered and re-fetched without bound. Both fetches now sit in `useEffect`.
- **Sub-components hoisted** to module scope with explicit props, so they no longer remount on
  every parent render.
- **PDF no longer navigates to the body URL.** The untrusted-body rule forbids it outright. The
  bytes are fetched via a new `getBodyBytes()` and handed over as an `application/octet-stream`
  blob the app owns, so nothing can render inline.
- **Loading and failure are distinct from empty.** `Home` and `Hole` now carry a `LoadState`;
  previously the designed "nothing here" panel was both the first paint on every visit and the
  permanent result of a failed fetch, telling a user with holes that they had none.
- **Capture URL validates the address** (`holeUrl.ts` returns `null` for anything that is not a
  bare six-character token). Making the URL absolute is what turned an injected newline in the
  route into a second command on the clipboard; the page now refuses to render anything copyable.
- **One link per row** instead of four to the same destination; the row itself handles the click.
- **Copy confirmation announced from its own `role="status"` region**, so the label reverting on a
  timer is no longer announced as a second event.
- **`formatQueryParams`** renders structured values as JSON instead of `[object Object]`, and
  falls back to raw text for JSON that is not an object of pairs.
- **Timestamps keep the stored UTC value** in a `title` attribute, since reformatting into the
  viewer's zone shifts the wall-clock reading.
- **The query-params section on the request detail page was dropped** — scope creep; the spec
  scoped that defect to the request list's column.
- **`EmptyState` gained a `compact` variant**, now used by the navbar dropdown and the
  request-detail headers table, so every empty list goes through the one component.
- **Tests strengthened**: the timestamp test asserted only the absence of ISO text and passed even
  with the column emptied; the capture-URL assertions were self-referential; `MethodBadge` and
  `CopyButton`'s failure branch had no coverage at all. Suite went from 24 tests to 44.

**Deliberately not changed:** the navbar's hole-count indicator (user's call).

**Review round 3** — the panel re-ran against the fixed branch and raised 21 more findings, two of
them regressions the round-two fixes had introduced. The user approved fixing all 21. Security
returned clean, having re-verified the address validation and the blob download.

The two regressions, both mine:

- **A failed load was a dead end** (`Home.tsx`). The new `loadState === "failed"` branch ran before
  the empty branch and rendered a panel with no controls, while the header's create button was
  gated on `holes.length > 0`. Before the LoadState work that button rendered unconditionally. The
  failed state now carries "Try again" (wired to a new `reloadHoles` from `App`) and a create
  button.
- **Path clicks navigated twice** (`Hole.tsx`). The new row-level `onClick` fired after the link's
  own handler, pushing two identical history entries — Back appeared broken, and a modified click
  opened a tab *and* moved the current one. The row handler now bails when the click originated
  inside an anchor.

Also fixed:

- **`getBody` pinned to `responseType: "text"`** with an identity transform. axios was JSON-parsing
  any string body it could, so a captured `text/plain` body of `"hello"` lost its quotes. A request
  inspector has to show the bytes as sent. *(Pre-existing, not introduced here.)*
- **SSE no longer loses a race with the first fetch.** Both started in the same tick and the
  fetch's snapshot replaced the list wholesale, discarding anything that had already streamed in.
  Both paths now merge through `mergeRequests`, which is also dedupe by address.
  *(Pre-existing.)*
- **The view is keyed on the hole address**, so switching holes cannot paint the previous hole's
  rows under the new heading for a frame.
- **Address validation moved into the effect too.** The guard was render-only, so the effect had
  already fetched and opened an EventSource with the raw value — and `useParams` decodes, so
  `/view/a%2F..%2Fapi` normalised into a path the caller chose. `isAddress` now lives in
  `utils/address.ts` and gates `Request.tsx` as well, which had no validation at all.
- **`Request` got the same `LoadState`**; it previously claimed "No headers captured" while loading
  and permanently after a failed fetch.
- **The PDF blob effect got a cancellation guard.** StrictMode cleans up the first run before its
  fetch resolves, so every mount leaked one blob holding the whole file.
- Removed the unused `EmptyState` `icon` prop and the unused `--text-display` token.

Test work, prompted by the Standards lens mutation-testing the suite (16 mutations, 14 caught):

- The empty-state capture-URL assertion searched the whole document and passed with the URL deleted
  from the panel; it is now scoped with `within`.
- The absolute-URL match was ambiguous with the row's own `/abc123` path link; it is now anchored.
- `queryByRole("link", { name: /\/api\/request/ })` could not fail for any implementation — a
  *ByRole `name` matches the accessible name, never the href. It asserts the href now.
- Added coverage for the CopyButton timer reset, the dropdown's compact empty state, the params
  placeholder, `MethodBadge`, and the blob revoke.
- Moved the `URL` global stub teardown into `afterEach`.

Suite: 44 → 61 tests.

**Bookkeeping:** `plans/tasks/0005-body-viewer.md` had the render-phase fetch fix and the download
link as its own AFK items. Both are done; that file now records them as met in 0004 so they are
not built twice.
