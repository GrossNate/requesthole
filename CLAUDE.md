# RequestHole

A request-inspection tool: create a "hole" (a short address), point any HTTP client at it, and
watch captured requests stream in live. Fastify + TypeScript backend, Vite/React frontend.

## Active plan

`plans/PLAN.md` — the single master plan (durable architectural header + ordered task pointers).
Task bodies live in `plans/tasks/`; finished tasks move to `plans/tasks/done/`. Add work with the
`to-plan` skill (it appends; never create a second plan). Implement with `implement-next-task`.
