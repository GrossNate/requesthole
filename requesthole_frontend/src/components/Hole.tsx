import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import holeService from "../services";
import { type RequestObject, type LoadState } from "../types";
import { useHoleStream, type ConnectionState } from "../hooks/useHoleStream";
import { formatQueryParams, formatTimestamp } from "../utils/format";
import { holeCaptureUrl } from "../utils/holeUrl";
import { isAddress } from "../utils/address";
import CopyButton from "./CopyButton";
import EmptyState from "./EmptyState";
import MethodBadge from "./MethodBadge";
import Request from "./Request";

/** Newest-wins merge that cannot produce two rows with the same address. */
const mergeRequests = (...groups: RequestObject[][]): RequestObject[] => {
  const byAddress = new Map<string, RequestObject>();
  for (const request of groups.flat()) {
    byAddress.set(request.request_address, request);
  }
  return [...byAddress.values()];
};

/**
 * Backoff for a snapshot that failed: 1s, 2s, 4s … capped at 30s, the same
 * schedule the stream reconnects on. Nothing else will ask — the stream only
 * requests a snapshot when it *opens*, so a connection that never drops never
 * retries, and what the failed snapshot was fetching is precisely the captures
 * no stream delivered.
 */
const SNAPSHOT_RETRY_MS = 1000;
const MAX_SNAPSHOT_RETRY_MS = 30_000;

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

const CONNECTION_STYLES: Record<ConnectionState, string> = {
  connecting: "badge-neutral",
  live: "badge-success",
  reconnecting: "badge-warning",
  disconnected: "badge-error",
};

// Five columns of monospace need about a laptop's width. Two things give that
// back: params leave entirely once the detail is alongside — the path cell
// carries the query string and the detail spells it out in full — and the
// timestamp waits for a screen wider than a phone. What is left is laid out
// fixed, because apportioning columns by content leaves the path, the one thing
// you scan for, with nothing.
const PARAMS_CELL = "hidden lg:table-cell";
const CREATED_CELL = "hidden sm:table-cell";

/**
 * One row of the request list.
 *
 * Memoised, and given callbacks that do not change between renders, because
 * every streamed capture sets the list state: without this, watching a chatty
 * hole re-renders every row on screen for each capture that arrives.
 */
const RequestRow = memo(function RequestRow({
  request,
  holeAddress,
  isSelected,
  shared,
  onOpen,
  onDelete,
}: {
  request: RequestObject;
  holeAddress: string;
  isSelected: boolean;
  shared: boolean;
  onOpen: (requestAddress: string) => void;
  onDelete: (requestAddress: string) => void;
}) {
  const params = formatQueryParams(request.query_params);
  const link = `/view/${holeAddress}/${request.request_address}`;
  // The row is clickable for the mouse; the path cell carries the one link, so
  // the keyboard gets a single stop per row rather than four identical ones.
  return (
    <tr
      onClick={(event) => {
        // The path cell's link navigates on its own. Without this the row
        // navigates too, pushing a second identical history entry and breaking
        // Back — and on a modified click it would open a tab *and* move the
        // current one.
        if ((event.target as HTMLElement).closest("a")) return;
        // Already open. Going there again pushes an entry identical to the one
        // already on top, so Back returns the reader to the request they are
        // looking at — twice, if they clicked twice.
        if (isSelected) return;
        onOpen(request.request_address);
      }}
      aria-current={isSelected ? "true" : undefined}
      className={`hover:bg-base-200/60 border-base-300 cursor-pointer ${
        isSelected
          ? "bg-primary/10 border-s-primary border-s-2"
          : "border-s-2 border-s-transparent"
      }`}
    >
      <td>
        <MethodBadge method={request.method} />
      </td>
      <td className="max-w-0">
        {/* No `replace` for the open row's own link: React Router already
            replaces rather than pushes when a <Link>'s target is the current
            location, so saying so here is a line no test can distinguish. The
            row handler below is where the duplicate entry actually came
            from. */}
        <Link
          to={link}
          className="address text-base-content block truncate hover:underline"
          title={request.request_path}
        >
          {request.request_path}
        </Link>
      </td>
      {shared ? null : (
        <td className={`address text-base-content/70 truncate ${PARAMS_CELL}`}>
          <span title={params}>{params || "—"}</span>
        </td>
      )}
      <td className={CREATED_CELL}>
        <span
          className="text-caption text-base-content/60 font-mono whitespace-nowrap"
          title={request.created}
        >
          {formatTimestamp(request.created)}
        </span>
      </td>
      <td className="text-right">
        <button
          type="button"
          className="btn btn-xs btn-ghost text-error"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(request.request_address);
          }}
        >
          delete
        </button>
      </td>
    </tr>
  );
});

/**
 * Whether the list in front of the user is still being fed. Everything but
 * "Live" means the captures on screen may already be out of date, which is
 * indistinguishable from an idle hole without something saying so.
 */
const ConnectionBadge = ({ state }: { state: ConnectionState }) => (
  <span
    role="status"
    className={`badge badge-sm ${CONNECTION_STYLES[state]} text-caption gap-tight font-medium`}
  >
    {state === "live" ? (
      <span
        aria-hidden="true"
        className="bg-success-content size-1.5 animate-pulse rounded-full"
      />
    ) : null}
    {CONNECTION_LABELS[state]}
  </span>
);

const HoleView = ({
  holeAddress,
  selectedAddress,
}: {
  holeAddress: string;
  selectedAddress: string | undefined;
}) => {
  const [holeRequests, setHoleRequests] = useState<RequestObject[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const navigate = useNavigate();
  const holeFullUrl = holeCaptureUrl(holeAddress);

  // The render below refuses a malformed address, but the effect runs first and
  // would otherwise put it straight into a request path — `useParams` decodes
  // it, so "a%2F..%2Fapi" becomes a traversal the caller chose.
  const addressIsValid = isAddress(holeAddress);

  // One snapshot at a time. The stream asks for a fresh one every time it
  // opens, and the first open normally lands while the mount's own snapshot is
  // still out — running both leaves two answers racing for the same list.
  const snapshotPending = useRef(false);

  // The request that arrives during one is queued, never dropped. It is asked
  // for because the asker knows something the snapshot in flight does not —
  // that a subscription has just started, and captures before it belong to no
  // stream — and dropping it also threw away the only retry a failed first
  // load ever gets.
  const resyncQueued = useRef(false);

  // Whether a snapshot has ever come back. A failed re-sync must not paint the
  // failure panel over rows that loaded fine, and "are there rows" is not the
  // same question — the answer can be legitimately empty.
  const everLoaded = useRef(false);

  // Captures the stream delivered since the current snapshot was requested.
  // The snapshot is authoritative about what the hole contains *as of when it
  // was taken*, which is how a request deleted in another tab finally leaves
  // this list — but it knows nothing about these, which are newer than it.
  const streamedSince = useRef<RequestObject[]>([]);

  // Deleting is the one thing the reader does that a snapshot can undo. A
  // request deleted while a snapshot was in flight is still in that snapshot's
  // rows, and merging them would put it back — clickable, and gone from the
  // backend. Discarded addresses are remembered for as long as this hole is on
  // screen so no snapshot can reintroduce one.
  const deleted = useRef(new Set<string>());

  // Read at resolve time, not capture time: a DELETE settles a render or two
  // after the handler that issued it was made, and by then the reader may have
  // opened something else.
  const selectedRef = useRef(selectedAddress);
  useEffect(() => {
    selectedRef.current = selectedAddress;
  });

  // Consecutive snapshot failures, and the retry they schedule. Reset by a
  // snapshot that comes back.
  const snapshotFailures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // A queued re-sync would otherwise fire from the settling `.finally` after
  // the view is gone, fetching a hole nobody is looking at — as would a retry
  // scheduled by the failure before it.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(retryTimer.current);
    };
  }, []);

  const loadRequests = useCallback(
    function run() {
      if (!addressIsValid) return;
      if (snapshotPending.current) {
        resyncQueued.current = true;
        return;
      }
      snapshotPending.current = true;
      // Whatever this call is — a retry, a re-sync, the reader's own button —
      // it supersedes the one the last failure scheduled.
      clearTimeout(retryTimer.current);
      streamedSince.current = [];
      // Only the first load gets to say "loading": a re-sync after a dropped
      // stream would otherwise replace rows the reader is looking at — which are
      // still perfectly good — with a spinner.
      setLoadState((previous) =>
        previous === "loaded" ? previous : "loading",
      );
      holeService
        .getRequests(holeAddress)
        .then((holeData) => {
          // Replace, not union: rows this snapshot omits are gone from the hole,
          // and a merge with what is already on screen could only ever add. What
          // survives alongside it is what arrived after it was asked for.
          const live = [...holeData, ...streamedSince.current].filter(
            (request) => !deleted.current.has(request.request_address),
          );
          // Spent: these captures are in the list now, and the next snapshot
          // postdates them, so holding them any longer would both exempt them
          // from its authority and keep a second copy of a list that only
          // grows on a stream that never drops.
          streamedSince.current = [];
          setHoleRequests(mergeRequests(live));
          everLoaded.current = true;
          snapshotFailures.current = 0;
          setLoadState("loaded");
        })
        .catch((error) => {
          console.error(error);
          // Rows already on screen survive a failed re-sync. They are the last
          // captures we know about and still worth reading; the connection badge
          // is what tells the reader they may now be stale. Replacing them with
          // the failure panel would also hide every capture still arriving on a
          // stream that has since come back.
          if (!everLoaded.current) setLoadState("failed");
          // Ask again on a backoff. A stream that stayed up will never ask on
          // this hole's behalf, so without this the gap the snapshot exists to
          // close stays open until the reader reloads the page — with the badge
          // reading Live over a list quietly missing captures.
          if (!mounted.current) return;
          const delay = Math.min(
            SNAPSHOT_RETRY_MS * 2 ** snapshotFailures.current,
            MAX_SNAPSHOT_RETRY_MS,
          );
          snapshotFailures.current += 1;
          retryTimer.current = setTimeout(() => {
            if (mounted.current) run();
          }, delay);
        })
        .finally(() => {
          snapshotPending.current = false;
          if (resyncQueued.current) {
            resyncQueued.current = false;
            if (mounted.current) run();
          }
        });
    },
    [holeAddress, addressIsValid],
  );

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const connectionState = useHoleStream({
    holeAddress,
    onMessage: useCallback((data: string) => {
      const captured = JSON.parse(data) as RequestObject;
      // The stream delivering this address is proof the backend has it now,
      // which is the very fact the tombstone was standing in for. Addresses
      // are reusable, so without this a reissued one would show up live and
      // then vanish at the next snapshot.
      deleted.current.delete(captured.request_address);
      // Kept aside as well as shown, so the snapshot that is currently out
      // cannot remove a capture that postdates it.
      streamedSince.current.push(captured);
      // Appended, not merged through a fresh Map of the whole list: this runs
      // once per capture on a hole that may be receiving them in bursts.
      setHoleRequests((prev) => {
        const existing = prev.findIndex(
          (request) => request.request_address === captured.request_address,
        );
        if (existing === -1) return [...prev, captured];
        const next = [...prev];
        next[existing] = captured;
        return next;
      });
    }, []),
    // Whatever landed while nothing was subscribed is on no stream anyone was
    // reading, so a snapshot is the only way those captures ever appear.
    onOpen: loadRequests,
  });

  // Stable across renders, so a streamed capture cannot invalidate every row's
  // props by minting fresh handlers.
  const openRequest = useCallback(
    (requestAddress: string) => {
      navigate(`/view/${holeAddress}/${requestAddress}`);
    },
    [navigate, holeAddress],
  );

  const deleteRequest = useCallback(
    (request_address: string) => {
      holeService
        .deleteRequest(request_address)
        .then((isDeleted) => {
          // The reader may have left this hole entirely while the DELETE was
          // out. Navigating then drags them back to the hole they left, and
          // `replace` destroys the history entry of the one they went to.
          if (!mounted.current) return;
          // A delete the backend refused — the request was already gone, or the
          // call failed — must not close the pane or leave a tombstone behind
          // for a row that is still there.
          if (isDeleted) {
            deleted.current.add(request_address);
            // The pane is showing the record that was just deleted, and the
            // URL points at it. Replace rather than push: Back should not
            // return to a request that no longer exists.
            if (request_address === selectedRef.current) {
              navigate(`/view/${holeAddress}`, { replace: true });
            }
            setHoleRequests((prevRequests) =>
              prevRequests.filter(
                (request) => request.request_address !== request_address,
              ),
            );
          }
        })
        .catch((error) => console.error(error));
    },
    [navigate, holeAddress],
  );

  const shared = Boolean(selectedAddress);

  const requestTable = () => (
    <div className="scroll-pane">
      <table className="table-pin-rows table w-full table-fixed">
        <thead>
          <tr className="bg-base-200 text-base-content/60">
            <th scope="col" className={shared ? "w-20" : "w-24"}>
              Method
            </th>
            <th scope="col">Path</th>
            {shared ? null : (
              <th scope="col" className={PARAMS_CELL}>
                Params
              </th>
            )}
            <th
              scope="col"
              className={`${CREATED_CELL} ${shared ? "w-44" : "w-48"}`}
            >
              Created
            </th>
            <th scope="col" className="w-20">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {holeRequests.map((request) => (
            <RequestRow
              key={request.request_address}
              request={request}
              holeAddress={holeAddress}
              isSelected={request.request_address === selectedAddress}
              shared={shared}
              onOpen={openRequest}
              onDelete={deleteRequest}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  const listing = () => {
    // Rows outrank the spinner for the same reason they outrank the failure
    // panel below: until a snapshot has ever succeeded, every re-sync returns
    // here, and captures the stream has already delivered are real.
    if (loadState === "loading" && holeRequests.length === 0) {
      return (
        <p className="text-body text-base-content/50" role="status">
          Loading requests…
        </p>
      );
    }
    // Rows outrank the panel. Whatever failed, captures we already have are
    // worth more than an explanation that a fetch did not work — and the badge
    // is what says whether the list is still being fed.
    if (loadState === "failed" && holeRequests.length === 0) {
      return (
        <EmptyState
          title="Couldn't load this hole's requests"
          description="The backend didn't answer. Check that it's running, then try again."
        >
          {/* The only other thing that asks for a snapshot is a stream that
              reopens, and a stream that never dropped never will — so a hole
              whose first load failed under a healthy stream would sit on this
              panel until the reader thought to reload the page. */}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => loadRequests()}
          >
            Try again
          </button>
        </EmptyState>
      );
    }
    if (holeRequests.length === 0) {
      return (
        <EmptyState
          title="No requests captured yet"
          description="Send any HTTP request to this hole's capture URL and it will appear here, live."
        >
          <code className="address text-secondary bg-base-300/50 px-snug py-tight rounded-field">
            {holeFullUrl}
          </code>
          <span className="text-caption text-base-content/50">
            Any method, any body — GET, POST, PUT, anything.
          </span>
        </EmptyState>
      );
    }
    return requestTable();
  };

  if (holeFullUrl === null) {
    return (
      <div className="gap-gutter flex h-full flex-col">
        <nav className="breadcrumbs text-caption py-0">
          <ul>
            <li>
              <Link to="/" className="text-base-content/60 hover:text-primary">
                All holes
              </Link>
            </li>
          </ul>
        </nav>
        <EmptyState
          title="That's not a valid hole address"
          description="A hole address is exactly six letters or digits. Check the link you followed."
        >
          <Link to="/" className="btn btn-sm btn-primary">
            Back to all holes
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="gap-gutter flex h-full flex-col">
      <nav className="breadcrumbs text-caption py-0">
        <ul>
          <li>
            <Link to="/" className="text-base-content/60 hover:text-primary">
              All holes
            </Link>
          </li>
          <li className={selectedAddress ? "" : "text-base-content/40"}>
            {selectedAddress ? (
              <Link
                to={`/view/${holeAddress}`}
                className="text-base-content/60 hover:text-primary"
              >
                <span>
                  Hole <span className="address">{holeAddress}</span>
                </span>
              </Link>
            ) : (
              <span>
                Hole <span className="address">{holeAddress}</span>
              </span>
            )}
          </li>
          {selectedAddress ? (
            <li className="text-base-content/40">
              <span>
                Request <span className="address">{selectedAddress}</span>
              </span>
            </li>
          ) : null}
        </ul>
      </nav>

      <div className="gap-snug flex flex-col">
        <div className="gap-snug flex flex-wrap items-center">
          <h1 className="page-title">
            Hole <span className="text-primary address">{holeAddress}</span>
          </h1>
          <ConnectionBadge state={connectionState} />
        </div>
        <div className="border-base-300 bg-base-200/50 gap-snug px-gutter py-tight rounded-box flex flex-wrap items-center border">
          <span className="section-label">Capture URL</span>
          <code className="address text-secondary grow overflow-x-auto">
            {holeFullUrl}
          </code>
          <CopyButton value={holeFullUrl} label="Copy URL" />
        </div>
      </div>

      {/* One column until a request is selected — an empty second column would
          just be the detail pane's silhouette with nothing in it. */}
      {/* `grid-cols-1` is not the default it looks like: an implicit column is
          sized to its content, and mono tables happily run wider than a phone.
          Every track here is explicitly allowed to shrink. */}
      <div
        className={`gap-gutter grid min-h-0 min-w-0 flex-1 grid-cols-1 ${
          selectedAddress ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" : ""
        }`}
      >
        {/* Two panes side by side from `lg` up; below it there is only room
            for one, so the selection decides which. */}
        <section
          aria-label="Captured requests"
          className={`min-h-0 min-w-0 flex-col ${
            selectedAddress ? "hidden lg:flex" : "flex"
          }`}
        >
          {listing()}
        </section>
        {selectedAddress ? (
          <section
            aria-label="Request detail"
            className="border-base-300 lg:ps-gutter gap-snug flex min-h-0 min-w-0 flex-col lg:border-s"
          >
            <Link
              to={`/view/${holeAddress}`}
              className="btn btn-sm btn-ghost text-body self-start lg:hidden"
            >
              ← All requests
            </Link>
            <Request />
          </section>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Keyed on the address so React discards the whole view when it changes. The
 * route reuses one instance otherwise, and the effect that clears the previous
 * hole's rows runs after paint — long enough to show one hole's captures under
 * another hole's heading.
 */
const Hole = () => {
  const { hole_address, request_address } = useParams();
  return (
    <HoleView
      key={hole_address}
      holeAddress={hole_address ?? ""}
      selectedAddress={request_address}
    />
  );
};

export default Hole;
