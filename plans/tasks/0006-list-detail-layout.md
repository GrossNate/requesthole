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

- [ ] Restructure the hole view into a list/detail layout: the request list persists while a selected
      request's detail renders alongside it. Selecting a request updates the URL to the existing
      `/view/:hole_address/:request_address` route without unmounting the list.
- [ ] Keep deep links and hard refreshes working — landing directly on a request URL must render both
      the list and that request's detail.
- [ ] Make the layout responsive: on narrow viewports the panes collapse to a single column with
      navigation between list and detail. Test at a mobile width.
- [ ] Preserve the live tail across selection: a request arriving while the user reads another must
      appear in the list without disturbing the current selection or scroll position. Cover with a
      test that pushes an event while a detail is open.
- [ ] Replace the fire-once SSE connection with a reconnecting one: exponential backoff with a cap,
      and no reconnect storm on repeated failure. Test the backoff schedule and that the stream
      resumes after a transient failure.
- [ ] On reconnect, re-fetch the request list so captures that arrived while disconnected are not
      silently missing.
- [ ] Surface connection state in the UI — live, reconnecting, disconnected — so a dead tail is
      visibly dead.
- [ ] Clean up the connection on unmount and on hole change; assert no leaked EventSource.

## Human-in-the-loop tasks

- [ ] [verify] Use the split view against a live hole: send requests while reading one, confirm the
      list updates without stealing focus or jumping scroll, and confirm the mobile layout is usable
      on a real narrow viewport. Interaction feel and focus behavior are not things a test asserts
      convincingly.

## Acceptance criteria

- [ ] Reading a request no longer navigates away from the live request list.
- [ ] Requests arriving while a detail is open appear in the list without changing the selection or
      scroll position.
- [ ] Deep links to a specific request render list and detail together; refreshing one works.
- [ ] The layout is usable at mobile width.
- [ ] The SSE stream reconnects with backoff after a failure and re-syncs the list on reconnect.
- [ ] Connection state is visible; a disconnected tail cannot be mistaken for an idle hole.
- [ ] No EventSource leaks on unmount or hole change.
