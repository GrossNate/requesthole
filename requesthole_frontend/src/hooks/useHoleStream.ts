import { useEffect, useRef, useState } from "react";
import holeService from "../services";
import { isAddress } from "../utils/address";

export type ConnectionState =
  "connecting" | "live" | "reconnecting" | "disconnected";

/**
 * Backoff between reconnection attempts: 1s, 2s, 4s … capped at 30s. No jitter
 * — one browser tab watches one hole, so there is no herd to spread out, and a
 * fixed schedule is one a test can pin down.
 */
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * How long a connection has to last before it counts as recovered and the
 * backoff starts over. Resetting on the open itself is what a server that
 * accepts the stream and drops it a moment later — crash-looping, or a proxy
 * timing it out — turns into a reconnect once a second forever.
 */
const STABLE_MS = 10_000;

/**
 * Consecutive failures before the stream stops calling itself "reconnecting"
 * and admits it is down. It keeps retrying either way; the distinction is what
 * the user is told about how stale the list in front of them might be.
 */
const FAILURES_BEFORE_DISCONNECTED = 3;

export type HoleStreamOptions = {
  /** The hole to follow. Anything that is not an address holds it closed. */
  holeAddress: string;
  onMessage: (data: string) => void;
  /**
   * Called every time the stream opens. Captures that landed while nothing was
   * subscribed reach no client, so the caller re-fetches its list here — after
   * the first open as well as later ones, since the caller's own initial query
   * goes out before the server has registered a subscriber.
   */
  onOpen: () => void;
};

export const useHoleStream = ({
  holeAddress,
  onMessage,
  onOpen,
}: HoleStreamOptions): ConnectionState => {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");

  // Held in refs so a caller's inline handlers cannot reopen the stream on
  // every render: the effect depends on the address alone. Assigned in an
  // effect rather than during render, so a render React discards cannot leave
  // its handler behind.
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
  });

  // The address comes off the route, so it is whatever a link said it was.
  // `useParams` decodes it, which turns "a%2F..%2Fapi" into a path the caller
  // chose. Validating here rather than at the call site keeps the check with
  // the code that builds the URL, where it cannot be forgotten.
  const connectable = isAddress(holeAddress);

  useEffect(() => {
    // Nothing is being attempted and nothing will recover, so "disconnected"
    // is the honest answer — and it has to be set on the way past, or the
    // previous hole's verdict stands for a stream that does not exist.
    if (!connectable) {
      setConnectionState("disconnected");
      return;
    }
    setConnectionState("connecting");

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;

    const connect = () => {
      // Held locally as well as in `source`, because the handlers below outlive
      // the assignment: `close()` stops future dispatches but not an error
      // already queued, so a handler can run when `source` has moved on.
      const mine = new EventSource(
        `${holeService.BASE_URL}/api/hole/${encodeURIComponent(holeAddress)}/events`,
      );
      source = mine;
      mine.onopen = () => {
        setConnectionState("live");
        onOpenRef.current();
        settle = setTimeout(() => {
          failures = 0;
        }, STABLE_MS);
      };
      mine.onmessage = (event) => onMessageRef.current(event.data);
      mine.onerror = () => {
        // Not the connection we are on. Either this source has already been
        // dealt with — a second error from one EventSource is still one failed
        // connection, not two — or it lost its place to a reconnect that is
        // working, and closing that one would take down a healthy stream.
        // Either way, one error per source is what the schedule is counted in.
        if (source !== mine) return;
        // The browser retries some failures on its own and gives up on others,
        // and the two are barely distinguishable from here. Closing on every
        // error and reopening on our own schedule is one policy instead of two.
        source = null;
        mine.close();
        clearTimeout(settle);
        if (stopped) return;
        setConnectionState(
          failures + 1 >= FAILURES_BEFORE_DISCONNECTED
            ? "disconnected"
            : "reconnecting",
        );
        const delay = Math.min(BASE_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
        failures += 1;
        retry = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(settle);
      source?.close();
    };
  }, [holeAddress, connectable]);

  return connectionState;
};
