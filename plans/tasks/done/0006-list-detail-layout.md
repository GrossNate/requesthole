# Task 0006: List/detail layout and durable live streaming

**Branch**: `feature/list-detail-layout`
**Depends on**: 0005 (assembles the design system from 0004 and the body viewer from 0005 into the
new layout; all three edit the same views)
**Source**: talk-it-through 2026-07-25 · **User stories**: "I want to polish the UI… the overall look
should be more compelling" — the structural half of that work.

## What to build

Restructure the hole view from a page-per-view flow into a persistent request list with the request
detail beside it, so captures continue streaming in while the user reads one. Today each view is a
separate full page: opening a request navigates away from the live list, which is the core
interaction of a request inspector.

This phase is assembly. The visual vocabulary comes from task 0004 and the body renderers from task
0005; this task changes structure and navigation, not palette or content rendering.

Client routes stay as they are — `/`, `/view/:hole_address`, `/view/:hole_address/:request_address` —
so links and refreshes keep working. The difference is that the third route now renders the detail
*within* the hole view's list rather than replacing it.

### Live streaming must survive a blip

The SSE stream currently closes permanently on its first error and never reopens, so the live tail
dies silently and the user has no idea they are looking at a stale list. This phase makes the stream
durable: reconnect with backoff, and make connection state visible in the UI so a disconnected tail is
never mistaken for an idle hole.

## AFK tasks

- [x] Restructure the hole view into a list/detail layout: the request list persists while a selected
      request's detail renders alongside it. Selecting a request updates the URL to the existing
      `/view/:hole_address/:request_address` route without unmounting the list.
- [x] Keep deep links and hard refreshes working — landing directly on a request URL must render both
      the list and that request's detail.
- [x] Make the layout responsive: on narrow viewports the panes collapse to a single column with
      navigation between list and detail. ~~Test at a mobile width.~~ **Amended during
      implementation:** the collapse is Tailwind breakpoint classes and jsdom has no layout, so no
      unit test can observe it — asserting the class strings instead pins styling rather than
      behaviour and passes on a genuinely broken layout, which is the trap task 0004 already
      recorded. The navigation the collapse depends on *is* tested (the way back to the list appears
      exactly when a request is open); the collapse itself was verified by hand at 375px in a real
      browser, along with a check that nothing overflows the viewport.
- [x] Preserve the live tail across selection: a request arriving while the user reads another must
      appear in the list without disturbing the current selection or scroll position. Cover with a
      test that pushes an event while a detail is open.
- [x] Replace the fire-once SSE connection with a reconnecting one: exponential backoff with a cap,
      and no reconnect storm on repeated failure. Test the backoff schedule and that the stream
      resumes after a transient failure.
- [x] On reconnect, re-fetch the request list so captures that arrived while disconnected are not
      silently missing.
- [x] Surface connection state in the UI — live, reconnecting, disconnected — so a dead tail is
      visibly dead.
- [x] Clean up the connection on unmount and on hole change; assert no leaked EventSource.

## Human-in-the-loop tasks

- [ ] [verify] Use the split view against a live hole: send requests while reading one, confirm the
      list updates without stealing focus or jumping scroll, and confirm the mobile layout is usable
      on a real narrow viewport. Interaction feel and focus behavior are not things a test asserts
      convincingly.

## Acceptance criteria

- [x] Reading a request no longer navigates away from the live request list.
- [x] Requests arriving while a detail is open appear in the list without changing the selection or
      scroll position.
- [x] Deep links to a specific request render list and detail together; refreshing one works.
- [ ] The layout is usable at mobile width. *(Checked by hand at 375px during implementation — one
      pane at a time, a working way back, nothing overflowing the viewport — but this one waits on
      the `[verify]` step below, since a real device is the only thing that settles it.)*
- [x] The SSE stream reconnects with backoff after a failure and re-syncs the list on reconnect.
- [x] Connection state is visible; a disconnected tail cannot be mistaken for an idle hole.
- [x] No EventSource leaks on unmount or hole change.

## Implementation log

**2026-08-08** — built on `feature/list-detail-layout`. 175 frontend tests and 24 backend tests
green; both projects lint and build clean.

**What was built**

- `requesthole_frontend/src/hooks/useHoleStream.ts` (new, with a 13-test suite) — the reconnecting
  SSE connection, extracted from `Hole` so the reconnect policy is testable on its own. Returns a
  `ConnectionState` of `connecting | live | reconnecting | disconnected`; takes `url` (null holds
  the stream closed), `onMessage`, and `onReconnect`, the last two held in refs so a caller's
  inline handler cannot reopen the stream on every render.
- `requesthole_frontend/src/components/Hole.tsx` — now owns the whole hole page: breadcrumbs,
  heading, capture URL, the request list, *and* the detail pane. Both `/view/:hole_address` and
  `/view/:hole_address/:request_address` render it (`App.tsx`), so selecting a request never
  unmounts the list. Adds the connection badge, the selected-row marker, and the responsive
  two-pane grid.
- `requesthole_frontend/src/components/Request.tsx` — reduced to the detail pane itself. Its
  breadcrumbs are gone (the hole owns them) and its `<h1>` became an `<h2>` under the hole's.
- `requesthole_backend/src/routes/hole.ts` — sends `event: open` the moment a client subscribes.

**Decisions made along the way**

- *Own the reconnect policy rather than share it with the browser.* EventSource retries some
  failures itself and abandons others, and the two are near-indistinguishable from script. Every
  error closes the source and reopens on our schedule: one policy instead of two.
- *Backoff 1s → 30s, no jitter.* One tab watches one hole, so there is no herd to spread out, and a
  fixed schedule is one a test can pin exactly.
- *"Disconnected" after three consecutive failures*, retrying at the cap forever. `reconnecting`
  reads as a blip worth waiting out; a sustained outage should say so, because the rows on screen
  are stale by then.
- *Re-sync does not re-enter the loading state.* A snapshot after a dropped stream would otherwise
  replace rows the reader is mid-scroll on with a spinner.
- *The backend had to flush SSE headers on connect.* Found by running the app: a browser's
  EventSource only fires `open` once headers arrive, and they were being held back until the first
  capture — so a perfectly healthy stream read as "Connecting…" forever, which defeats the whole
  connection indicator. One named frame on subscribe fixes it, and being named it never reaches the
  viewer's message handler.
- *The list sheds columns as it narrows.* Params leave once the detail is alongside (the path cell
  carries the query string and the detail spells it out); the timestamp waits for a screen wider
  than a phone; the table is `table-fixed` so the path column cannot be starved. Without this the
  split list truncated every path to "/0…" and scrolled sideways.

**Verified live in a browser** (not only in jsdom): split view with the selection held while a
capture streamed in; badge going Live → Disconnected when the backend died and back to Live on its
own once it returned; a capture sent during the outage appearing after the reconnect re-sync; and
the 375px layout collapsing to one pane with a working "← All requests" link.

### Round 2 — review findings applied

The review panel found two defects I had introduced, both in the same few lines, and both real:

- **A failed re-sync destroyed the list.** I guarded the *loading* path so a re-sync could not
  replace good rows with a spinner, then left the `catch` setting `failed` unconditionally. A
  snapshot that rejected after a reconnect swapped every row for the failure panel — and never
  recovered, because `listing()` checks `failed` before it ever reaches the rows, so captures still
  arriving on the healthy stream piled up behind it invisibly. The failure path now keeps rows that
  are already on screen; the connection badge is what says they may be stale.
- **A late snapshot resurrected a deleted request.** Making the fetch repeatable without an
  in-flight guard meant a snapshot taken before a delete could land after it and merge the row back
  — clickable, and gone from the backend. Two guards now: a generation counter so only the newest
  snapshot may write, and a set of discarded addresses that no snapshot can reintroduce.

Also applied: the backoff no longer resets on the open itself but on a connection that *lasts*
(`STABLE_MS`), so a server that accepts the stream and drops it immediately still backs off instead
of reconnecting once a second forever; `onReconnect` became `onOpen` and fires on every open,
closing the mount-time gap where a capture landing between the snapshot query and the server
registering a subscriber reached neither; the hook takes a `holeAddress` and validates it itself,
so the check lives with the code that builds the URL; handler refs are assigned in an effect rather
than during render; `RequestBroadcaster` drops a hole's key with its last subscriber, since a
stream can be opened for any six characters and emptied Sets were memory a stranger could grow;
the detail pane heading got its own `.pane-title` rather than borrowing the one-per-route
`.page-title`; the README route table describes the split view; and the changed files are
Prettier-clean.

Three test assertions were removed rather than kept: a `scrollTop` check that could not fail (jsdom
has no layout, so it only ever re-read what the test wrote) and two that pinned Tailwind class
strings. What replaced them tests navigation and structure; whether the panes actually collapse is
the `[verify]` step's job, which is where the repo already puts layout questions.

### Round 3 — the round-2 fixes had a defect of their own

Two round-2 changes were individually right and wrong together. `onOpen` firing on every open meant
the mount issued a snapshot and the first stream open immediately issued a second; the generation
counter then discarded the first one's answer. If the second failed, a list that had loaded
perfectly well was replaced by the failure panel, permanently. The snapshot handling was reworked
rather than patched:

- **One snapshot at a time** (`snapshotPending`). The stream still asks on every open, but an open
  that arrives while a snapshot is already out lets it finish instead of racing it. One request per
  mount instead of two, and no superseding.
- **The newest snapshot is authoritative for removals.** The old merge was a union, so a re-sync
  could only ever add rows — a request deleted in another tab stayed on screen forever and its
  detail pane 404ed. The snapshot now replaces the list, keeping alongside it only the captures the
  stream delivered after that snapshot was requested (`streamedSince`), which are newer than it.
- **`everLoaded` replaces the generation guard** for deciding whether a failure may show the failure
  panel. "Has a snapshot ever come back" is the actual question; "are there rows" is a different one,
  since a hole can be legitimately empty.
- **Deleting the open request closes the pane**, navigating back to the list with `replace` so Back
  does not return to a dead URL. The delete button and the detail pane never shared a screen before
  this task, so nothing had ever had to decide this.

Also: the stream reports `disconnected` rather than a stale `live` when the address is not an
address; the events route reclaims a subscriber whose socket died before the `close` listener could
attach; and `prettyPrint.test.ts`'s deliberately-quadratic test got an explicit timeout — its work
takes several seconds by design and the added tests pushed it past vitest's 5s default, so it was
failing as a timeout rather than on its behaviour.

**Verified live again:** a request deleted through the API from outside the browser disappeared from
the list on the next reconnect (16 rows → 15), which is the union-versus-replace fix working end to
end.

### Round 4 — the round-3 fix had one too

`snapshotPending` serialised snapshots by *dropping* the second request rather than deferring it,
and the request it dropped was almost always the one that mattered: the stream's first open lands
while the mount's snapshot is still out, so the open's re-sync — the whole point of which is to
cover captures that arrived before a subscriber existed — was thrown away every time. Worse, it was
also the only retry a failed first load ever got, so a mount whose fetch rejected sat on the failure
panel permanently with a live stream behind it. Two lenses found this independently.

- **The queued re-sync**: a request arriving during a snapshot sets a flag and runs when that
  snapshot settles. One at a time, none discarded.
- **Rows outrank the failure panel** (`failed && holeRequests.length === 0`). Whatever failed,
  captures we already have beat an explanation that a fetch did not work.
- **The delete handler reads the selection at resolve time**, not the one captured when the handler
  was made — otherwise a DELETE settling after the reader opened something else closed that pane,
  with `replace`, taking the history entry with it.
- **A streamed capture clears its own tombstone.** Addresses are reusable; the stream delivering one
  is proof the backend has it, which is the fact the tombstone stood in for.
- **The `socket.destroyed` guard added in round 3 was removed.** Measured over 1000
  connect-and-reset cycles it never fires — Fastify routes from inside the socket's own data
  handler, so the `close` listener is always attached first. An unreachable branch cannot be tested
  and is dead code; the reasoning is recorded in the route and in task 0007's carve-out note.

The `prettyPrint` timeout comment was corrected too: the cost is jsdom's `DOMParser` on 30 KB of
nesting, not the formatter, which bails at `MAX_FORMAT_DEPTH` almost immediately. 15s, not 30s, so a
real regression still fails.

### Round 5 — two behavioural regressions of the route split, and guards nothing tested

Round 4 looked like the severity curve flattening; it wasn't. Round 5's two majors were both
introduced by the split itself — behaviour that was impossible while each view owned its own route —
and three more were guards that shipped with no test, including `everLoaded`, which was round 2's
headline fix. All 22 findings are closed.

**The two defects**

- **A failed request fetch showed a spinner forever** (`Request.tsx`). The pane keeps the record it
  loaded last, so a request whose GET rejects while an earlier one is still in hand is *both*
  failed and stale — and staleness was read first. Open a request another tab has since deleted and
  the pane sat on "Loading request…" with nothing coming. When the pane was its own route it
  remounted with no record and the failure panel showed. Failure now outranks staleness. The
  review's other half of the fix — clearing the record in the `catch` — was deliberately not taken:
  with the branches in the right order it changes nothing observable, so it would be a line no test
  could distinguish, which is exactly what this round penalised elsewhere.
- **A delete could drag the reader back to a hole they had left** (`Hole.tsx`). The DELETE's `.then`
  navigated on `selectedRef` alone, and `selectedRef` stops updating once the view unmounts — so a
  delete issued in hole `aaaaaa` and settling after the reader followed a link to `bbbbbb`
  navigated back to `aaaaaa`, with `replace`, taking the new hole's history entry with it. The
  `.then` body is now guarded by the same `mounted` ref the queued re-sync uses. The existing test
  missed it because it changed selection *within* one hole.

**Guards that now have tests** — each verified by mutation: break the line, watch the named test go
red.

- The "Disconnected" badge is asserted as rendered UI (three consecutive failures), not only as a
  value `useHoleStream` returns. That is the acceptance criterion's actual subject.
- `everLoaded`: an empty hole whose re-sync rejects keeps "No requests captured yet". Every previous
  failed-re-sync test had rows on screen, where the separate `holeRequests.length === 0` guard
  masked it.
- The streamed-capture tombstone clearing, the `mounted` guard on the queued re-sync, and the
  "Connecting…" half of the connection badge (asserted before the open, so a badge hardcoded to
  "Live" no longer passes).
- The "rows outrank the failure panel" test now *reaches* the failed state — its first snapshot
  rejects — instead of asserting streamed-row merging under a comment claiming otherwise.

**Also fixed**

- *The snapshot deadline is idle, not total* (`services.ts`). `/requests` is unpaginated and carries
  every row's headers, so the round-4 `timeout` — which axios maps onto `XMLHttpRequest.timeout`,
  15s from `send()` regardless of progress — made a busy hole on a slow link permanently
  unloadable, aborting at the same point on every retry. An `AbortController` armed from
  `onDownloadProgress` keeps the wedge-breaking property without the ceiling, and it is testable:
  the old test asserted only that *a* timeout existed, which a 1 ms one would have satisfied.
- *The failure panel offers "Try again".* The only other thing that requests a snapshot is a stream
  that reopens, and a stream that never dropped never will — so a first load that failed under a
  healthy stream sat there until the reader thought to reload the page.
- *The service layer validates and encodes addresses itself.* Every call site does today; the point
  is the one that forgets, which is the failure this branch already had to fix once in
  `useHoleStream`.
- *`streamedSince` is emptied when its captures land in the list*, not only when the next snapshot
  starts — on a stream that never drops, that was a second copy of the whole list growing forever.
  No observable behaviour changes, so nothing tests it directly; the next snapshot was already
  authoritative either way. The related nit — a capture that streams in during a snapshot's flight
  and is deleted elsewhere before that snapshot resolves comes back — is *not* fixed, because it
  cannot be from here: a delete made in another tab is knowable only from a snapshot, and the
  window closes at the next one. The backend broadcasts captures but not deletions; giving the
  stream a delete frame is the real fix and it belongs with 0007's other server-side work.
- *The SSE header-flush frame is `stream-open`, not `open`*, which is EventSource's own built-in
  event type. The only thing keeping the collision inert was the frame carrying no `data`; add one
  for any reason and `onopen` fires twice per connection, queueing a second snapshot and arming a
  second settle timer.
- *`RequestBroadcaster.holeCount()` is gone.* It was production API that existed for one test; the
  test reaches for the private Map instead. The broadcast fixture is a whole typed row rather than
  a partial cast to `never`, and the test now asserts the serialised payload — the shape is the
  contract with the client that parses it.
- *Two tests that failed as timeouts under parallel load* had their fixtures cut rather than their
  allowances raised: the `prettyXml` deep-nesting case is 200 levels instead of 5,000 (still twice
  `MAX_FORMAT_DEPTH`, 3s → 12ms, explicit timeout dropped), and the row-cap test waits by counting
  rows instead of `findByRole(…, { name })`, which computes an accessible name for every element in
  a 1,000-row table (1.7s → 0.6s).
- *README churn reverted.* The Configuration table had been realigned by Prettier in a section this
  task does not touch; the route-table row that is in scope stays.

**One deviation recorded late**, at the review's request: `.pane-title` in `index.css` adds an entry
to the shared design-system layer, which belonged to 0004's remit. The need is structural — with
both panes on screen the page needs one loudest heading and the detail needs a step below it — but
it is a change to the visual vocabulary this task disclaimed, so it belongs in this list rather
than only in the CSS comment.

Still open, and outside the review's scope: the `[verify]` step (interaction feel on a real phone)
and the acceptance criterion that waits on it.

### Round 6 — the curve finally flattened, and the flaky suite got diagnosed

15 findings, no blockers, one major. Two of them were the unfixed halves of round-5 findings and two
were defects in tests round 5 wrote, which is the same pattern as every round before it — but at
minor severity rather than major. All 15 are closed.

**The major, and its sibling**

- **The backoff's `clearTimeout(settle)` had no test** (`useHoleStream.ts`). Deleting it left all
  206 tests green, because the flapping-server test only flapped four times: every delay was under
  `STABLE_MS`, so the orphaned settle timers that reset `failures` all fired after the test had
  stopped looking. The loop now runs to 16s and 30s, where one lands mid-wait, and the mutation
  fails it. Nothing about the source changed — the guard was right, the test was short.
- **The `if (stopped) return;` guard** on a post-teardown error had no test either. Closing a source
  does not un-queue an error it has already scheduled, so the handler can run after cleanup; without
  the guard it arms a retry that cleanup's own `clearTimeout` has already been and gone for. Now
  covered by unmounting and *then* firing the error.

**Behaviour**

- *Clicking the open request's row no longer stacks up history entries.* The row is a click target
  the whole way across and stays on screen once its request is open, so clicking it again is
  ordinary — and every one of those clicks pushed an entry identical to the one on top, so Back
  returned the reader to the request they were already reading. Confirmed in a real browser: three
  clicks on the open row, one Back, and the list is there. The link half needed nothing: React
  Router already replaces rather than pushes when a `<Link>`'s target is the current location, so
  `replace={isSelected}` was a line no test could distinguish and it is not in the code.
- *A failed snapshot now retries on a backoff* (1s → 30s, the stream's own schedule). The stream
  only asks for a snapshot when it *opens*, so a connection that never drops never asked again: the
  gap the snapshot existed to close — captures from before the subscription, deletions made
  elsewhere — stayed open until the reader reloaded, with the badge reading Live. The "Try again"
  button stays for the reader who does not want to wait, and now has a test that fails when it is
  wired to nothing.
- *A delete the backend refuses changes nothing.* Nothing covered `isDeleted === false`, so the
  tombstone and the pane-closing navigation were both gated on an unverified condition.
- *Streamed captures no longer rebuild the whole list.* Each one allocated a Map over every row and
  re-rendered every row, with a fresh delete closure per row per render — on the app's hot path, for
  the case the tool exists for. The row is now a memoised component with stable callbacks, and a
  capture appends rather than merging.

**The suite is green under load now, and it was not before.** Four full runs in parallel used to
surface failures in two different `Hole.test.tsx` tests; they pass four-up now. Three causes, all
in the tests:

- *Awaiting the wrong thing.* Four tests awaited the detail region or the detail's headers and then
  reached for a row. The region renders from the URL on the first paint and the headers come from a
  different fetch, so neither says anything about whether the list's snapshot has landed. They now
  await a row.
- *Timer restores at the end of the test body.* An assertion that threw in between left every later
  test in the file on a hijacked clock, turning one real failure into a cascade that buried it. One
  `afterEach` now does it.
- *Swapping timer implementations mid-test*, inside an `act` with promises in flight, in the
  resurrection test. It needed fake timers only to skip a reconnect delay that was not its subject;
  it now asks for the snapshot with an `onopen` and uses no timers at all.

**Also**

- Task 0007 gets a real checkbox for the SSE delete frame, not just the blockquote handing it over.
  Its own AFK list is its contract, and a note above the list is not on it.
- `prettyPrint.test.ts` regained the large-input case round 5's fixture cut removed, as the shape
  that is actually cheap to test: 30 KB wide rather than deep, which is formatted rather than
  refused and takes 95ms. The 200-level case still pins the depth bail.
- *The README is now Prettier-clean in full*, which settles a flip-flop rather than continuing it:
  round 5 reverted the Configuration table's realignment as unrelated churn, and round 6 flagged
  the result as two adjacent tables in different styles. One deliberate normalisation of a file this
  branch already edits ends it — the alternative was restoring rows that were not valid table
  markup. The same rule keeps the Prettier rewrap in `app.test.ts` that the Spec lens asked to
  revert: files this branch touches are left Prettier-clean, and that file gained a 55-line test.
- The listing-endpoint finding (`GET /api/holes` hands every address to anyone, and `crc32(uuidv4())`
  gives 2^32 of entropy rather than 62^6) is pre-existing, untouched here, and left alone. It is a
  question about whether holes are meant to be private at all, which is 0008's remit, not a defect
  in this branch.

### Round 7 — the majors

Round 7 found 8 findings after merging, 2 of them majors. Both are fixed; the minor and five nits
below them are not, and are listed at the end of this section so they are not lost.

- **One EventSource error handler, two ways to get it wrong** (`useHoleStream.ts`). The handler
  closed over the mutable `source` binding and re-armed `retry` without clearing it, and `close()`
  does not un-queue an error already dispatched — the premise this file already relies on for its
  `stopped` guard. So a second error from one source armed a second retry from a single handle,
  opening a stream that was then untracked: never closed, not closed on unmount either, and still
  handing every frame to the caller, with a subscriber the backend keeps for a hole nobody is
  watching. That is the leak the AFK bullet names outright. And an error arriving late from a
  source already replaced ran `close()` on whatever `source` pointed at by then — the healthy
  reconnect — dropping a working stream back into backoff. The fix is one idea rather than two
  patches: `connect` holds its own instance, the handler ignores anything that is not the current
  one, and handling an error clears `source`, so one source can cost exactly one failure and one
  retry. Three tests, each red when the guard is removed. Standards and Bug found this
  independently, in code six rounds had left alone.
- **The snapshot backoff was pinned only at its first step** (`Hole.tsx`). Round 6 added the retry
  and tested that it happens; nothing tested the schedule, so flattening it to a constant second,
  or dropping the reset after a success, kept all 213 tests green — a build that hammers a broken
  `/requests` once a second forever would have shipped. This is the exact finding round 6 raised
  against the stream's own backoff, against the code written in answer to it. The schedule is now
  pinned delay-by-delay the same way `useHoleStream.test.ts` pins the stream's — 1s, 2s, 4s … 30s,
  30s, each asserted one tick short and then on the tick — with a second test that a snapshot
  coming back starts the schedule over.

**Found while verifying, not fixed:** four concurrent full runs now surface three failures, all in
task 0005's body-viewer tests and none in the code this round touched. Two are timeouts —
`RequestBody.test.tsx`'s two cap tests idle at 0.68s and 0.41s and cross the 5s default under a
tenfold slowdown, which is the same class round 6 fixed in their sibling by dropping an
accessible-name query. The third is `Request.test.tsx`'s "fetching once", which failed on its call
count rather than a timeout and did not reproduce in six parallel runs of that file alone; it wants
the diagnose loop rather than a guess. The suite passed four-up at 213 tests last round and now
carries 218, so the added load is likely what tipped these over rather than anything about them
changing.

**Still open from round 7:** the untested `clearTimeout(retryTimer.current)` at the head of
`loadRequests` (minor), the redundant `!mounted.current` early return in the snapshot `catch`,
`streamedSince` still accumulating on a stream that never re-opens, `mergeRequests` left variadic
with one caller, this branch carrying 0005's post-merge bookkeeping, and the `[verify]` step.

### Rounds 8 and 9, and the close-out

Two more review rounds ran after the log above. Round 8 found 31, two of them majors, both the same
class every round since 5 has led with — a guard shipped with no test. Both were fixed: the
keyed-remount test now holds the second hole's snapshot in flight rather than resolving it empty (it
could not fail before, because a resolved snapshot cleared the stale rows with or without the key),
and `mergeRequests`' dedup gained the test it never had. Round 9 mutation-verified both hold, found
15 more, and its only major was about the record rather than the code: this log stopped at round 7.

The 44 findings those rounds left open are not lost — `reviews/list-detail-layout-review.md` carries
them all with their evidence, and PR #6's description lists the ones worth acting on. The two most
worth a look are `onopen` in `useHoleStream` missing the `source !== mine || stopped` guard that
`onerror` got in round 7, and the delete button's untested `stopPropagation()`.

**Closed out at `[x]` with the `[verify]` step still open** — a deliberate call, not an oversight.
The code merged in PR #6 (2026-08-12); interaction feel and the mobile layout on a real device were
never checked, and the acceptance criterion that waits on them stays unchecked above. Task 0007 was
unblocked on the strength of the merge rather than the verification.
