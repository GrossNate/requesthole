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
 * `client-limit` is a 429: this client is at its share of live holes or its
 * hourly budget. `full` is a 503: the deployment is at its hole ceiling. The
 * page words each differently, and neither is an outage.
 */
export class HoleLimitError extends Error {
  readonly reason: "client-limit" | "full";

  constructor(reason: "client-limit" | "full") {
    super(
      reason === "full"
        ? "This deployment is full."
        : "This client is at its hole limit.",
    );
    this.name = "HoleLimitError";
    this.reason = reason;
  }
}
