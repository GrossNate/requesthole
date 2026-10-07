# Task 0010: Resolve reviewed security and operations findings

**Branch**: `feature/reviewed-findings`
**Depends on**: 0008 (updates the merged application reviewed in task 0009)
**Source**: User-approved findings from `reviews/0009-general-review-findings.md` · **User stories**: "I want known dependency risks and operational/accessibility defects addressed."

## What to build

Resolve the four findings selected by the user from the general review: update vulnerable production dependencies within supported major versions, report service readiness in Compose, make the Holes menu trigger behave like a button for keyboard users, and remove the redundant per-capture info log.

## AFK tasks

- [x] Update affected production dependency ranges and lockfiles to patched compatible versions.
- [x] Add regression coverage for keyboard operation of the Holes menu trigger and implement its native button behavior.
- [x] Add regression coverage for Compose service health/readiness configuration and add backend/frontend healthchecks with readiness ordering.
- [x] Remove the per-capture info log and verify capture behavior remains intact.
- [x] Run relevant backend/frontend checks, Compose configuration validation, and production dependency audits.

## Acceptance criteria

- [x] Production-only dependency audits report no known advisories for either package.
- [x] Compose exposes backend and frontend health states, and frontend startup waits for a healthy backend.
- [x] The Holes menu trigger uses native button semantics and opens via keyboard activation.
- [x] Successful request captures do not emit the redundant "called collection route" info log.

## Implementation log

- 2026-10-07: Updated production dependency ranges and lockfiles; `npm audit --omit=dev` found 0 vulnerabilities in both packages. Added a validated single-hop Fastify proxy trust function restricted to Nginx's fixed address on a dedicated Compose network. Added backend/Nginx healthchecks with `service_healthy` ordering and a Compose configuration assertion script. Replaced the Holes faux button with a stateful native disclosure button, added Enter/Space and outside-click tests, and removed the generic per-capture info log with a logger regression test. After the approved review follow-ups, backend tests passed (424), frontend tests passed (354), both production builds passed, and the Compose readiness/proxy configuration check passed.
- 2026-10-07: The task review first found the outside-click and broad proxy-trust issues. Both were fixed with regression coverage; the review panel ran again and found no remaining issues. The project `/security-review` command was unavailable and this limitation is recorded in `reviews/0010-reviewed-findings-review.md`.
