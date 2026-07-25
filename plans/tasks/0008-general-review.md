# Task 0008: General review of the finished application

**Branch**: `feature/general-review`
**Depends on**: 0007 (reviews the application with all preceding work merged)
**Source**: talk-it-through 2026-07-25 · **User stories**: "I want to do a final, general review that
looks for any other issues we should tackle."

## What to build

Not a feature — a findings document. One broad sweep across the whole application looking for issues
worth tackling that the preceding phases didn't address, ranked so the user can triage.

This task deliberately **produces a report and changes nothing else**. Findings become work only after
the user has read them and said which ones count. That is the same gate the project's review process
already uses: machine-generated findings are advisory until a human verifies them.

### Scope

Four lenses, all of them:

- **Code and correctness** — bugs, dead code, race conditions, error handling, type looseness, test
  coverage gaps, anything left over from earlier phases.
- **Security** — the public attack surface: input validation, the untrusted-body invariant, SSE,
  resource exhaustion beyond what task 0007 bounded, dependency vulnerabilities. The project has a
  `/security-review` for this; use it rather than reinventing it.
- **UX and accessibility** — keyboard navigation, focus management, contrast against the dark palette,
  screen-reader semantics, error and loading states. The markup had real problems before task 0004;
  confirm they're gone and look for the ones nobody has looked for yet.
- **Operations** — logging and observability, container healthchecks (Compose currently has a plain
  `depends_on` with no condition), backup and restore of the SQLite volume, dependency freshness, the
  absence of CI, and anything an operator would need at 3am.

### Deliverable

A single ranked findings document at `reviews/0008-general-review-findings.md`, each finding carrying:
what it is, where (`file:line`), why it matters, severity, and a suggested direction. Findings must be
verified against the code before being written down — a plausible-sounding finding that doesn't
reproduce wastes more time than it saves.

Known-and-accepted items are recorded as such rather than reported as defects, so the list stays
honest: no access control and a public global hole list are deliberate decisions, not findings.

## AFK tasks

- [ ] Run the code-and-correctness sweep across backend and frontend; verify each candidate finding
      against the code before recording it.
- [ ] Run the security sweep using the project's `/security-review`, covering the public surface and
      the dependency tree.
- [ ] Run the UX and accessibility sweep across all views at desktop and mobile widths.
- [ ] Run the operations sweep: logging, healthchecks, backup/restore, dependency freshness, CI
      absence.
- [ ] Write the ranked findings document, with a short section listing deliberate decisions that are
      explicitly not findings.
- [ ] Note explicitly anywhere coverage was bounded — a lens not fully run, a claim not verified — so a
      gap never reads as a clean bill of health.

## Human-in-the-loop tasks

- [ ] [decision] Triage the findings together and decide which become work — cannot be automated,
      since it's a judgment about what's worth building. Resolved via talk-it-through, with accepted
      findings then going through `to-plan` as new tasks.

## Acceptance criteria

- [ ] `reviews/0008-general-review-findings.md` exists, covering all four lenses, ranked by severity.
- [ ] Every finding cites a concrete location and a reason it matters, and was verified against the
      code rather than asserted.
- [ ] Deliberate decisions are listed as accepted rather than reported as defects.
- [ ] Any bounded coverage is stated outright.
- [ ] No production code was changed by this task.
- [ ] The user has read the findings and triaged them; accepted findings are filed as new tasks.
