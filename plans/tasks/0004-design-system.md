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

- [ ] Define a custom daisyUI theme in `index.css` — colors sampled from the logo, on a near-black
      base. daisyUI themes are CSS variables, so this is one block, not per-component churn. Keep the
      theme name and variable set documented in a comment, since task 0005's syntax-highlighting
      theme inherits from it.
- [ ] Establish a type scale and spacing rhythm, replacing the ad-hoc `text-xl` / `ps-3` / `p-3`
      usages currently scattered through the components.
- [ ] Restyle the app shell: header/navbar, the logo–wordmark pairing (currently a bare `max-h-10`
      image next to plain text), breadcrumbs, and buttons.
- [ ] Restyle the two tables (hole list, request list) for legibility — sensible column widths,
      monospace for addresses and paths, readable row density.
- [ ] Build a reusable empty-state component and use it everywhere a list can be empty: no holes on
      the home page, no requests in a hole. The hole empty state must show the hole's full capture
      URL and tell the user to send a request to it.
- [ ] Build a reusable copy-to-clipboard component with visible confirmation feedback, replacing the
      bare `⿻` glyph button. Write a test asserting it copies the intended string.
- [ ] **Defect** — the copy button copies a relative path. `holeFullUrl` is built from `BASE_URL`,
      which is `""` in production, yielding `/abc123` — useless pasted into a webhook config. Derive
      an absolute URL from the browser's origin. Cover with a test.
- [ ] **Defect** — the request list's "Params" column renders the request's `headers` field. Show the
      query params instead (or drop the column if the params belong elsewhere). Cover with a test.
- [ ] **Defect** — both table header rows use `<td>` for header cells. Use `<th>` with proper scope.
- [ ] Add frontend test infrastructure if none exists (Vitest is already a backend dependency;
      the frontend currently has no test script and no tests), and wire a `test` script into
      `requesthole_frontend/package.json`.

## Human-in-the-loop tasks

- [ ] [verify] Look at the restyled app and judge whether it reads as more compelling — "compelling"
      is an aesthetic judgment no assertion can make. Check the logo/wordmark pairing, the palette
      against the logo, and legibility of the two tables.

## Acceptance criteria

- [ ] The palette visibly derives from the logo; the app and the logo read as one design.
- [ ] A type scale and spacing system exist and are used, rather than ad-hoc utility classes.
- [ ] Every list has a designed empty state; the empty hole state shows the full capture URL.
- [ ] The copy button copies an absolute, pasteable URL and confirms visibly that it copied.
- [ ] The request list's "Params" column shows params, not headers.
- [ ] Table header cells are `<th>`.
- [ ] The frontend has a working test command, and the defect fixes are covered by tests.
- [ ] No page layout was restructured — that is task 0006.
