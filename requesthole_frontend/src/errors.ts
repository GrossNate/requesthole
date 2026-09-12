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
