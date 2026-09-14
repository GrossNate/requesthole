/**
 * The hole a snapshot asked about does not exist: it was deleted, or swept
 * by retention. Distinct from a failed snapshot, which is worth retrying;
 * this one never will succeed. Lives outside `services.ts` so component
 * tests that mock the service module can still construct and match it.
 */
export class HoleGoneError extends Error {
  constructor() {
    super("This hole no longer exists.");
    this.name = "HoleGoneError";
  }
}

/**
 * The backend refused to create a hole on purpose, as opposed to failing.
 * Three refusals, and each needs different advice:
 * - `share` (429, no wait): this client holds its share of live holes.
 *   Deleting one frees a slot.
 * - `rate-limit` (429 with Retry-After): this client has created its hourly
 *   budget. Only waiting helps; `retryAfterSeconds` says how long.
 * - `full` (503): the deployment is at its hole ceiling.
 * None of them is an outage.
 */
export type HoleLimitReason = "share" | "rate-limit" | "full";

export class HoleLimitError extends Error {
  readonly reason: HoleLimitReason;
  readonly retryAfterSeconds: number | undefined;

  constructor(reason: HoleLimitReason, retryAfterSeconds?: number) {
    super(`Hole creation refused: ${reason}.`);
    this.name = "HoleLimitError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
