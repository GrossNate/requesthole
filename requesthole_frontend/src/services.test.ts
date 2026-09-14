import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { type AxiosProgressEvent } from "axios";
import holeService from "./services";
import { HoleGoneError, HoleLimitError } from "./errors";

vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// The config the snapshot went out with. `getRequests` never settles in these
// tests — a mocked axios ignores the abort — so what is asserted is the signal
// the caller armed, not the rejection the real adapter would raise from it.
const snapshotConfig = () => {
  const call = vi.mocked(axios.get).mock.calls[0];
  expect(call).toBeDefined();
  return call![1]!;
};

const progressed = (bytes: number) =>
  ({ loaded: bytes, bytes }) as AxiosProgressEvent;

describe("request snapshot", () => {
  // The hole view runs one snapshot at a time and queues any asked for while
  // one is out. A request that never settles therefore wedges the queue: the
  // stream reopens, asks for a re-sync, and nothing ever consumes it. Only a
  // deadline on the request itself can break that, since the caller has no
  // other way to know the answer is never coming.
  it("gives up on a snapshot that stops answering", () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

    void holeService.getRequests("abc123");
    const config = snapshotConfig();

    expect(config.signal?.aborted).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(config.signal?.aborted).toBe(true);
  });

  // The deadline is idle, not total. `/requests` is unpaginated and carries
  // every row's headers, so a whole-transfer budget would make a busy hole on
  // a slow link permanently unloadable — aborting at the same point on every
  // retry — rather than merely slow.
  it("keeps waiting while the answer is still arriving", () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

    void holeService.getRequests("abc123");
    const config = snapshotConfig();

    // Well past any total-transfer budget, but never idle for long.
    for (let elapsed = 0; elapsed < 120_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000);
      config.onDownloadProgress?.(progressed(elapsed));
    }
    expect(config.signal?.aborted).toBe(false);

    // And the clock still runs out once the bytes stop.
    vi.advanceTimersByTime(60_000);
    expect(config.signal?.aborted).toBe(true);
  });

  it("stops its clock once the snapshot has answered", async () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: [] });

    await holeService.getRequests("abc123");

    // A timer still armed would abort a controller nobody is watching and,
    // in a long-lived tab, one per snapshot ever taken.
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The addresses these take come off the route, so they are whatever a link
// said they were — `useParams` decodes them, which turns "a%2F..%2Fapi" into a
// path the visitor chose. Every caller validates today; the point of checking
// here is the caller that forgets tomorrow.
describe("address handling", () => {
  const crafted = "a/../api";

  it.for([
    ["getHole", () => holeService.getHole(crafted)],
    ["deleteHole", () => holeService.deleteHole(crafted)],
    ["getRequests", () => holeService.getRequests(crafted)],
    ["getRequest", () => holeService.getRequest(crafted)],
    ["deleteRequest", () => holeService.deleteRequest(crafted)],
    ["getBodyBytes", () => holeService.getBodyBytes(crafted)],
  ] as const)("issues no request at all from %s", async ([, call]) => {
    await expect(call()).rejects.toThrow(/address/i);

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });
});

describe("a hole that no longer exists", () => {
  // A deleted or swept hole answers 404 for its requests, where a hole with
  // nothing in it answers an empty list. The view needs to tell those apart,
  // and a generic failure would only be retried forever.
  it("reports a 404 snapshot as the hole being gone", async () => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 404 } });

    await expect(holeService.getRequests("abc123")).rejects.toBeInstanceOf(
      HoleGoneError,
    );
  });

  it("still reports any other failure as a plain failure", async () => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 500 } });

    const failure = holeService.getRequests("abc123");
    await expect(failure).rejects.toBeDefined();
    await expect(failure).rejects.not.toBeInstanceOf(HoleGoneError);
  });
});

describe("a hole creation the backend refuses", () => {
  // Two refusals answer 429. The hourly limiter names a wait in
  // Retry-After; the per-client share does not, since deleting a hole is
  // what frees it, not waiting.
  it("reports a 429 without a wait as the per-client share", async () => {
    vi.mocked(axios.post).mockRejectedValue({
      response: { status: 429, headers: {} },
    });

    const refused = holeService.addHole();
    await expect(refused).rejects.toBeInstanceOf(HoleLimitError);
    await expect(refused).rejects.toMatchObject({ reason: "share" });
  });

  it("reports a 429 with a wait as the hourly limit, keeping the wait", async () => {
    vi.mocked(axios.post).mockRejectedValue({
      response: { status: 429, headers: { "retry-after": "1800" } },
    });

    await expect(holeService.addHole()).rejects.toMatchObject({
      reason: "rate-limit",
      retryAfterSeconds: 1800,
    });
  });

  it("reports a 503 as the deployment being full", async () => {
    vi.mocked(axios.post).mockRejectedValue({ response: { status: 503 } });

    await expect(holeService.addHole()).rejects.toMatchObject({
      reason: "full",
    });
  });

  it("still reports any other failure as a plain failure", async () => {
    vi.mocked(axios.post).mockRejectedValue({ response: { status: 500 } });

    await expect(holeService.addHole()).rejects.not.toBeInstanceOf(
      HoleLimitError,
    );
  });
});
