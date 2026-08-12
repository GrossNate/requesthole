import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  act,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import type { RequestObject } from "../types";
import holeService from "../services";
import { formatTimestamp } from "../utils/format";
import Hole from "./Hole";

// Only the component's own `useNavigate` is redirected here — <Link> keeps its
// internal binding, so this distinguishes the row navigating from the link
// navigating.
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getRequests: vi.fn(),
    deleteRequest: vi.fn(),
    getRequest: vi.fn(),
    getBodyBytes: vi.fn(),
  },
}));

// jsdom has no EventSource. The stub records what was opened and hands the
// most recent instance back, so tests can push a message through the stream.
type StubEventSource = {
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};
const eventSourceUrls: string[] = [];
const openedSources: StubEventSource[] = [];
let lastEventSource: StubEventSource | null = null;

// A plain function, not an arrow: the component calls it with `new`. Returning
// an object makes that construction yield the stub.
function StubEventSource(url: string): StubEventSource {
  eventSourceUrls.push(url);
  lastEventSource = {
    onopen: null,
    onmessage: null,
    onerror: null,
    close: vi.fn(),
  };
  openedSources.push(lastEventSource);
  return lastEventSource;
}
vi.stubGlobal("EventSource", StubEventSource);

const capturedRequest = (
  overrides: Partial<RequestObject> = {},
): RequestObject => ({
  request_address: "req001",
  created: "2026-07-25T14:03:22.145Z",
  method: "POST",
  request_path: "/abc123",
  query_params: '{"probe":"1"}',
  headers: '{"user-agent":"curl/8.7.1"}',
  ...overrides,
});

// Both routes render the same view: selecting a request changes the URL
// without taking the list off screen, so tests mount the pair.
const renderHoleAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/view/:hole_address" element={<Hole />} />
        <Route path="/view/:hole_address/:request_address" element={<Hole />} />
      </Routes>
    </MemoryRouter>,
  );

const renderHole = () => renderHoleAt("/view/abc123");

beforeEach(() => {
  vi.clearAllMocks();
  eventSourceUrls.length = 0;
  openedSources.length = 0;
  lastEventSource = null;
  vi.mocked(holeService.getRequests).mockResolvedValue([]);
  vi.mocked(holeService.getRequest).mockResolvedValue(capturedRequest());
  vi.mocked(holeService.getBodyBytes).mockResolvedValue(new ArrayBuffer(0));
});

// Restored here rather than at the end of each test body: a failing assertion
// in between would otherwise leave every test after it running on a hijacked
// clock, turning one real failure into a cascade that buries it.
afterEach(() => {
  vi.useRealTimers();
});

describe("Hole request list", () => {
  it("shows a request's query parameters in the Params column, not its headers", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();

    expect(await screen.findByText("probe=1")).toBeVisible();
    expect(screen.queryByText(/user-agent/)).not.toBeInTheDocument();
  });

  // <td> in a <thead> gives assistive tech no column association at all.
  it("marks up its header row as column headers", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(["Method", "Path", "Params", "Created"]),
    );
  });

  it("renders the captured timestamp readably, keeping the exact value to hand", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    const shown = screen.getByText(formatTimestamp("2026-07-25T14:03:22.145Z"));
    expect(shown).toBeVisible();
    // Reformatting into the viewer's zone shifts the wall-clock reading, so the
    // stored UTC value stays reachable rather than being thrown away.
    expect(shown).toHaveAttribute("title", "2026-07-25T14:03:22.145Z");
    expect(
      screen.queryByText("2026-07-25T14:03:22.145Z"),
    ).not.toBeInTheDocument();
  });

  // Four cells each wrapping their own link made every row four tab stops and
  // four announcements of the same destination.
  it("gives each row a single link to the request", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    const rowLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/view/abc123/req001");
    expect(rowLinks).toHaveLength(1);
  });

  // The row handler and the link handler both navigated, so a click on the link
  // pushed two identical history entries and Back appeared broken. The link
  // does its own navigating; the row must stay out of the way.
  it("leaves navigation to the link when the link itself is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    await user.click(screen.getByRole("link", { name: "/abc123" }));

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("navigates itself when the row is clicked away from the link", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    await user.click(screen.getByText("POST"));

    expect(navigateSpy).toHaveBeenCalledExactlyOnceWith("/view/abc123/req001");
  });

  it("still shows a placeholder for a request that carried no params", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest({ query_params: "{}" }),
    ]);
    renderHole();

    expect(await screen.findByText("—")).toBeVisible();
  });
});

describe("Hole capture URL", () => {
  // BASE_URL is "" in production, which used to yield the bare path "/abc123".
  it("shows an absolute URL and copies that same URL", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();

    // Matched against the absolute shape, not just the same global the
    // component reads — and anchored, so the row's own "/abc123" path link
    // cannot satisfy it either.
    const shown = await screen.findByText(/^https?:\/\/[^/]+\/abc123$/);

    await user.click(screen.getByRole("button", { name: /copy/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(
      shown.textContent,
    );
  });

  // The address comes off the route, so a crafted link can carry anything.
  it("offers nothing to copy when the address is not a real hole address", async () => {
    render(
      <MemoryRouter initialEntries={["/view/abc%0Acurl%20evil.sh%7Csh"]}>
        <Routes>
          <Route path="/view/:hole_address" element={<Hole />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/not a valid hole address/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();
  });

  // useParams decodes the segment, so "/view/a%2F..%2Fapi" becomes "a/../api"
  // and the browser would normalise the SSE URL into a path the caller chose.
  it("issues no requests at all for an address it has rejected", async () => {
    render(
      <MemoryRouter initialEntries={["/view/a%2F..%2Fapi"]}>
        <Routes>
          <Route path="/view/:hole_address" element={<Hole />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/not a valid hole address/i);

    expect(holeService.getRequests).not.toHaveBeenCalled();
    expect(eventSourceUrls).toEqual([]);
  });
});

describe("Hole live stream", () => {
  // The fetch and the stream start in the same tick. A capture landing first
  // was wiped out by the fetch's snapshot, which predated it.
  it("keeps a streamed request that arrives before the first fetch resolves", async () => {
    let resolveRequests: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValue(
      new Promise((resolve) => {
        resolveRequests = resolve;
      }),
    );
    renderHole();

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(
          capturedRequest({ request_address: "live01", method: "PATCH" }),
        ),
      } as MessageEvent);
    });
    resolveRequests([]);

    expect(await screen.findByText("PATCH")).toBeVisible();
  });

  it("does not duplicate a request present in both the fetch and the stream", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(capturedRequest()),
      } as MessageEvent);
    });

    expect(screen.getAllByText("probe=1")).toHaveLength(1);
  });

  // The dedup above runs in the stream's own handler, which sees the list it is
  // appending to. This one is the other collision: a capture that arrives while
  // a snapshot is in flight is shown *and* held aside, so when that snapshot
  // comes back carrying the same capture, the list it is rebuilt from holds the
  // address twice over.
  it("does not duplicate a request the stream delivered while the fetch was in flight", async () => {
    let resolveRequests: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValue(
      new Promise((resolve) => {
        resolveRequests = resolve;
      }),
    );
    renderHole();

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(capturedRequest()),
      } as MessageEvent);
    });
    await act(async () => {
      resolveRequests([capturedRequest()]);
    });

    expect(screen.getAllByText("probe=1")).toHaveLength(1);
  });

  // The route reuses one Hole instance across addresses, so state outlived the
  // address it belonged to for a frame.
  it("does not show one hole's requests under another hole's heading", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest({ request_path: "/aaaaaa" }),
    ]);
    render(
      <MemoryRouter initialEntries={["/view/aaaaaa"]}>
        <Link to="/view/bbbbbb">switch hole</Link>
        <Routes>
          <Route path="/view/:hole_address" element={<Hole />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("/aaaaaa");

    // The second hole's snapshot is left in flight, because the frame before it
    // lands is the only one the bug lives in: let it resolve and the rows it
    // brings replace the stale ones either way, so the assertions below would
    // pass with the keying removed.
    vi.mocked(holeService.getRequests).mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole("link", { name: "switch hole" }));

    expect(screen.queryByText("/aaaaaa")).not.toBeInTheDocument();
    expect(screen.getByText(/loading requests/i)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "bbbbbb",
    );
  });
});

describe("Hole list and detail", () => {
  // The whole point of the split: reading a request used to replace the live
  // list with a page of its own.
  it("shows a selected request's detail without taking the list off screen", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHoleAt("/view/abc123/req001");

    const row = await screen.findByRole("link", { name: "/abc123" });
    const list = screen.getByRole("region", { name: "Captured requests" });
    expect(list).toContainElement(row);
    expect(
      await screen.findByRole("rowheader", { name: "user-agent" }),
    ).toBeVisible();
  });

  // A capture landing while the user reads another one must not yank the page
  // out from under them. Scroll position itself is not observable here — jsdom
  // has no layout — so what this pins is the thing that preserves it: the
  // scroll container is the same element afterwards, never torn down and
  // rebuilt. Whether the scroll *feels* undisturbed is the [verify] step's job.
  it("keeps the reader's place when a capture arrives mid-read", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHoleAt("/view/abc123/req001");
    await screen.findByRole("rowheader", { name: "user-agent" });
    await screen.findByRole("link", { name: "/abc123" });

    const list = screen.getByRole("region", { name: "Captured requests" });
    const scroller = within(list).getByRole("table").parentElement!;

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(
          capturedRequest({ request_address: "live01", method: "PATCH" }),
        ),
      } as MessageEvent);
    });

    expect(within(list).getByText("PATCH")).toBeVisible();
    expect(within(list).getByRole("table").parentElement).toBe(scroller);
    expect(
      screen.getByRole("region", { name: "Request detail" }),
    ).toBeInTheDocument();
    // A refetch here would mean the detail remounted — the reader's pane was
    // torn down and rebuilt behind a "Loading request…" flash.
    expect(holeService.getRequest).toHaveBeenCalledTimes(1);
  });

  // With both panes on screen the list has to say which row the detail belongs
  // to, or the pairing is left to the reader's memory.
  it("marks the open request's row as the current one", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      capturedRequest({ request_address: "req002", request_path: "/other" }),
    ]);
    renderHoleAt("/view/abc123/req002");
    await screen.findByText("/other");

    const list = screen.getByRole("region", { name: "Captured requests" });
    const current = within(list)
      .getAllByRole("row")
      .filter((row) => row.getAttribute("aria-current") === "true");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("/other");
  });

  // Both views used to draw their own trail. Side by side that is two of them,
  // stacked, disagreeing about where the reader is.
  it("carries one breadcrumb trail, ending at the open request", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHoleAt("/view/abc123/req001");
    await screen.findByRole("rowheader", { name: "user-agent" });

    const trails = screen.getAllByRole("navigation");
    expect(trails).toHaveLength(1);
    expect(trails[0]).toHaveTextContent("req001");
    expect(
      within(trails[0]).getByRole("link", { name: /all holes/i }),
    ).toBeVisible();
    // The hole segment is the way back to the unsplit list on a narrow screen.
    expect(
      within(trails[0]).getByRole("link", { name: /abc123/ }),
    ).toHaveAttribute("href", "/view/abc123");
  });

  // Sharing the width with the detail leaves the list about a third of the
  // page. Carrying all five columns into that made every path read "/0…" and
  // pushed a horizontal scrollbar under the rows. Params go: the path cell
  // already carries the query string, and the detail spells it out in full.
  it("sheds the params column when the list shares the width", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHoleAt("/view/abc123/req001");
    await screen.findByRole("link", { name: "/abc123" });

    const list = screen.getByRole("region", { name: "Captured requests" });
    const columns = within(list)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);

    expect(columns).toEqual(
      expect.arrayContaining(["Method", "Path", "Created"]),
    );
    expect(columns).not.toContain("Params");
  });

  // Two panes on one page means one page heading, not two competing ones.
  it("keeps the hole as the page heading and the request beneath it", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHoleAt("/view/abc123/req001");
    await screen.findByRole("rowheader", { name: "user-agent" });

    const [pageHeading, ...rest] = screen.getAllByRole("heading", { level: 1 });
    expect(pageHeading).toHaveTextContent("abc123");
    expect(rest).toEqual([]);
    expect(
      screen.getByRole("heading", { level: 2, name: "/abc123" }),
    ).toBeVisible();
  });
});

describe("Hole stream lifecycle", () => {
  it("holds exactly one stream open, dropping it when the view goes away", async () => {
    const { unmount } = renderHole();
    await screen.findByText(/no requests/i);

    expect(openedSources).toHaveLength(1);
    unmount();

    expect(openedSources[0].close).toHaveBeenCalled();
  });

  // The old code leaked here only by luck: the keyed remount closed the source
  // on the way out. The stream is the hole's, so it has to go with it.
  it("drops the old hole's stream when the address changes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/view/aaaaaa"]}>
        <Link to="/view/bbbbbb">switch hole</Link>
        <Routes>
          <Route path="/view/:hole_address" element={<Hole />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/no requests/i);

    await user.click(screen.getByRole("link", { name: "switch hole" }));

    expect(openedSources).toHaveLength(2);
    expect(openedSources[0].close).toHaveBeenCalled();
    expect(openedSources[1].close).not.toHaveBeenCalled();
    expect(eventSourceUrls[1]).toContain("bbbbbb");
  });

  // Selecting a request is not a new subscription — that was the whole bug the
  // split view exists to fix.
  it("keeps the same stream when a request is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    await user.click(screen.getByRole("link", { name: "/abc123" }));

    await screen.findByRole("region", { name: "Request detail" });
    expect(openedSources).toHaveLength(1);
    expect(openedSources[0].close).not.toHaveBeenCalled();
  });
});

// Tailwind does the collapsing and jsdom has no layout, so whether the panes
// actually stack is the [verify] step's job, not these tests'. What is testable
// here is the navigation the collapse depends on: with only room for one pane,
// the reader needs a way back to the list, and it must appear exactly when a
// request is open.
describe("Hole narrow-width navigation", () => {
  it("offers a way back to the list while a request is open", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHoleAt("/view/abc123/req001");
    await screen.findByRole("rowheader", { name: "user-agent" });

    expect(screen.getByRole("link", { name: /all requests/i })).toHaveAttribute(
      "href",
      "/view/abc123",
    );
  });

  it("offers no way back when the list is already what you are looking at", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    expect(
      screen.getByRole("region", { name: "Captured requests" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /all requests/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Hole connection state", () => {
  // A list that has quietly stopped updating looks exactly like a hole nobody
  // has sent anything to, which is the failure this makes impossible.
  it("says the tail is live once the stream is open", async () => {
    renderHole();
    await screen.findByText(/no requests/i);

    // Asserted before the open as well as after: a badge that read "Live" from
    // the first paint would pass the second half on its own, while telling the
    // reader a list nothing is feeding yet is up to date.
    expect(screen.getByText(/connecting/i)).toBeVisible();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();

    act(() => lastEventSource!.onopen!());

    expect(screen.getByText("Live")).toBeVisible();
  });

  it("says so when the tail has dropped", async () => {
    renderHole();
    await screen.findByText(/no requests/i);
    act(() => lastEventSource!.onopen!());

    act(() => lastEventSource!.onerror!());

    expect(screen.getByText(/reconnecting/i)).toBeVisible();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  // The state the acceptance criterion is really about: "Reconnecting…" reads
  // as a blip worth waiting out, and a tail that has been down through three
  // attempts is not a blip. This is the badge the reader needs to see before
  // they trust an empty-looking list, so it is asserted as rendered UI here
  // and not only as a value the stream hook returns.
  it("says the tail is down once reconnecting keeps failing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHole();
    await screen.findByText(/no requests/i);
    act(() => lastEventSource!.onopen!());

    act(() => lastEventSource!.onerror!());
    expect(screen.getByText(/reconnecting/i)).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => lastEventSource!.onerror!());
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    act(() => lastEventSource!.onerror!());

    expect(screen.getByText("Disconnected")).toBeVisible();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
  });

  // Captures that arrived during the outage were pushed to a stream nobody was
  // reading; without a fresh snapshot they are simply missing from the list.
  it("picks up what it missed when the stream comes back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");
    act(() => lastEventSource!.onopen!());

    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      capturedRequest({ request_address: "missed", method: "PUT" }),
    ]);
    act(() => lastEventSource!.onerror!());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => lastEventSource!.onopen!());

    expect(await screen.findByText("PUT")).toBeVisible();
  });

  // Re-syncing must not take the list away and put a spinner in its place —
  // the reader is mid-scroll and the rows they can see are still valid.
  it("leaves the rows on screen while it re-syncs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");
    act(() => lastEventSource!.onopen!());

    vi.mocked(holeService.getRequests).mockReturnValue(new Promise(() => {}));
    act(() => lastEventSource!.onerror!());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => lastEventSource!.onopen!());

    expect(screen.getByText("probe=1")).toBeVisible();
    expect(screen.queryByText(/loading requests/i)).not.toBeInTheDocument();
  });

  // The sibling test above covers a re-sync that never settles. This is the one
  // that bites: the snapshot *rejects*, and the failure panel takes the place of
  // rows that are still perfectly good. Nothing recovers them either — the
  // stream is live again, so no further re-sync is coming, and captures arriving
  // on it merge into state that the failure panel is standing in front of.
  it("keeps the rows, and keeps showing new ones, when a re-sync fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");
    act(() => lastEventSource!.onopen!());

    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    act(() => lastEventSource!.onerror!());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => lastEventSource!.onopen!());
    await act(async () => {});

    expect(screen.getByText("probe=1")).toBeVisible();
    expect(
      screen.queryByText(/couldn't load this hole's requests/i),
    ).not.toBeInTheDocument();

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(
          capturedRequest({ request_address: "after1", method: "PUT" }),
        ),
      } as MessageEvent);
    });

    expect(screen.getByText("PUT")).toBeVisible();
  });
});

// Who wins when the snapshot and the stream disagree about what the hole
// contains: which one is authoritative, and for what.
describe("Hole snapshot reconciliation", () => {
  // The stream opens in milliseconds and the snapshot takes tens of them, so
  // the ordinary mount has the first open landing while the first snapshot is
  // still out. Two answers racing for one list is what the queue avoids — but
  // the open's request must be honoured, not thrown away: it is the one that
  // covers captures landing between the snapshot's query and the server
  // registering a subscriber.
  it("waits for the snapshot it has, then makes the one it was asked for", async () => {
    let resolveFirst: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    renderHole();

    act(() => lastEventSource!.onopen!());
    // Not concurrently — the one in flight gets to finish.
    expect(holeService.getRequests).toHaveBeenCalledTimes(1);

    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      capturedRequest({ request_address: "gap001", method: "PUT" }),
    ]);
    await act(async () => {
      resolveFirst([capturedRequest()]);
    });

    expect(holeService.getRequests).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("PUT")).toBeVisible();
  });

  // The first snapshot failing is not the end of the story when the stream is
  // fine: the open already asked for another one. Dropping that request left
  // the failure panel up forever, badge reading "Live", with every capture
  // arriving on the healthy stream stacked up invisibly behind it.
  it("recovers from a failed first load once its deferred re-sync runs", async () => {
    let rejectFirst: (error: Error) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }),
    );
    renderHole();

    act(() => lastEventSource!.onopen!());
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    await act(async () => {
      rejectFirst(new Error("offline"));
    });

    expect(await screen.findByText("/abc123")).toBeVisible();
    expect(
      screen.queryByText(/couldn't load this hole's requests/i),
    ).not.toBeInTheDocument();
  });

  // The same rule, reached through "loading" instead of "failed". While no
  // snapshot has ever succeeded every re-sync goes back to loading, so a
  // flapping stream over a broken /requests endpoint made the list flicker
  // between the captures it had and a spinner.
  it("keeps streamed rows on screen while a re-sync it cannot finish runs", async () => {
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    renderHole();
    await screen.findByText(/couldn't load this hole's requests/i);

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(
          capturedRequest({ request_address: "live01", method: "PATCH" }),
        ),
      } as MessageEvent);
    });
    expect(screen.getByText("PATCH")).toBeVisible();

    // A re-sync that never settles: the rows are all we have, so they stay.
    vi.mocked(holeService.getRequests).mockReturnValue(new Promise(() => {}));
    await act(async () => {
      lastEventSource!.onopen!();
    });

    expect(screen.getByText("PATCH")).toBeVisible();
    expect(screen.queryByText(/loading requests/i)).not.toBeInTheDocument();
  });

  // The view is genuinely in the failed state here — its only snapshot
  // rejected — and then a capture arrives on a stream that is fine. Rows that
  // exist are worth more than a panel explaining that a fetch did not work, so
  // the panel has to give way to them rather than stand in front of them.
  it("shows the rows it has rather than a failure panel over the top of them", async () => {
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    renderHole();
    await screen.findByText(/couldn't load this hole's requests/i);

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(
          capturedRequest({ request_address: "live01", method: "PATCH" }),
        ),
      } as MessageEvent);
    });

    expect(screen.getByText("PATCH")).toBeVisible();
    expect(
      screen.queryByText(/couldn't load this hole's requests/i),
    ).not.toBeInTheDocument();
  });

  // A hole can be legitimately empty, which is why "has a snapshot ever come
  // back" is a different question from "are there rows". Without that
  // distinction an empty hole whose re-sync fails claims it could not be
  // loaded, when it loaded fine and is simply empty.
  it("keeps an empty hole empty rather than failed when a re-sync fails", async () => {
    renderHole();
    await screen.findByText(/no requests/i);

    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    await act(async () => {
      lastEventSource!.onopen!();
    });

    expect(screen.getByText(/no requests/i)).toBeVisible();
    expect(
      screen.queryByText(/couldn't load this hole's requests/i),
    ).not.toBeInTheDocument();
  });

  // Addresses are reusable, so a tombstone cannot be forever: the stream
  // delivering one is proof the backend has it again, which is the very fact
  // the tombstone stood in for. Without clearing it, the reissued capture
  // showed up live and then vanished at the next snapshot.
  it("lets an address back in when the stream delivers it again", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    vi.mocked(holeService.deleteRequest).mockResolvedValue(true);
    renderHole();
    await screen.findByText("/abc123");

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() =>
      expect(screen.queryByText("/abc123")).not.toBeInTheDocument(),
    );

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(capturedRequest({ method: "PUT" })),
      } as MessageEvent);
    });
    expect(screen.getByText("PUT")).toBeVisible();

    // The next snapshot carries the address too, and must not be filtered
    // against a tombstone the stream has already disproved.
    await act(async () => {
      lastEventSource!.onopen!();
    });

    expect(screen.getByText("/abc123")).toBeVisible();
  });

  // The queued re-sync fires from a `.finally` that outlives the view: the
  // snapshot it was waiting on settles after the reader has gone somewhere
  // else, and there is nothing left to show the answer to.
  it("drops a queued re-sync when the view has gone", async () => {
    let resolveFirst: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const { unmount } = renderHole();

    act(() => lastEventSource!.onopen!());
    expect(holeService.getRequests).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveFirst([]);
    });

    expect(holeService.getRequests).toHaveBeenCalledTimes(1);
  });

  // A delete the backend refused — the row was already gone, or the call
  // failed — is not a delete. Acting on it anyway would tombstone an address
  // that is still live, so the next snapshot would filter out a row the
  // backend is still returning.
  it("leaves everything alone when the backend refuses the delete", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    vi.mocked(holeService.deleteRequest).mockResolvedValue(false);
    renderHoleAt("/view/abc123/req001");
    await screen.findByRole("link", { name: "/abc123" });

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await act(async () => {});

    expect(screen.getByRole("link", { name: "/abc123" })).toBeVisible();
    expect(navigateSpy).not.toHaveBeenCalled();
    // And the address is not tombstoned: the next snapshot still shows it.
    await act(async () => {
      lastEventSource!.onopen!();
    });
    expect(screen.getByRole("link", { name: "/abc123" })).toBeVisible();
  });

  // A snapshot that fails is the one thing on this screen with nothing behind
  // it: the stream asks for one when it *opens*, so a connection that stays up
  // never asks again. The gap it was fetching — captures that landed before
  // the subscription, deletions made elsewhere — stays open until a reload.
  it("asks again after a failed snapshot, without the stream having to drop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("/abc123");

    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    await act(async () => {
      lastEventSource!.onopen!();
    });

    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      capturedRequest({ request_address: "missed", method: "PUT" }),
    ]);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(await screen.findByText("PUT")).toBeVisible();
  });

  // The schedule, not just the fact of a retry: a backend that is down should
  // not be asked once a second forever, which is the same storm the stream's
  // own backoff exists to avoid.
  it("backs off between snapshot retries up to a cap", async () => {
    vi.useFakeTimers();
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    renderHole();
    await act(async () => {});
    expect(holeService.getRequests).toHaveBeenCalledTimes(1);

    const askedAfter = async (delay: number) => {
      const before = vi.mocked(holeService.getRequests).mock.calls.length;
      // One tick short: a schedule that fired early would be
      // indistinguishable from one that fired on time without this.
      await act(async () => {
        vi.advanceTimersByTime(delay - 1);
      });
      expect(vi.mocked(holeService.getRequests).mock.calls.length).toBe(before);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(vi.mocked(holeService.getRequests).mock.calls.length).toBe(
        before + 1,
      );
    };

    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await askedAfter(delay);
    }
  });

  it("starts the snapshot backoff over once one comes back", async () => {
    vi.useFakeTimers();
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    renderHole();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // The backend recovers, and the retry after it succeeds.
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("/abc123")).toBeVisible();

    // A later failure starts from the beginning, not from where the outage
    // left off — otherwise one bad patch makes the tab sluggish for good.
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    await act(async () => {
      lastEventSource!.onopen!();
    });
    const before = vi.mocked(holeService.getRequests).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(vi.mocked(holeService.getRequests).mock.calls.length).toBe(before);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(vi.mocked(holeService.getRequests).mock.calls.length).toBe(
      before + 1,
    );
  });

  // A DELETE settles a render or two after it was issued, and by then the
  // reader may have left the hole entirely. Navigating back to it is bad
  // enough; doing it with `replace` also destroys the history entry of the
  // hole they went to.
  it("does not pull the reader back to a hole they have left", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    let confirmDelete: (deleted: boolean) => void = () => {};
    vi.mocked(holeService.deleteRequest).mockReturnValue(
      new Promise((resolve) => {
        confirmDelete = resolve;
      }),
    );
    render(
      <MemoryRouter initialEntries={["/view/aaaaaa/req001"]}>
        <Link to="/view/bbbbbb">switch hole</Link>
        <Routes>
          <Route path="/view/:hole_address" element={<Hole />} />
          <Route
            path="/view/:hole_address/:request_address"
            element={<Hole />}
          />
        </Routes>
      </MemoryRouter>,
    );
    // Waited on a row, not the detail region: that section renders from the
    // URL alone, on the very first paint, so awaiting it says nothing about
    // whether the snapshot that draws the delete button has landed.
    await screen.findByRole("link", { name: "/abc123" });

    await user.click(screen.getByRole("button", { name: /delete/i }));
    vi.mocked(holeService.getRequests).mockResolvedValue([]);
    // The <Link> keeps its own binding, so this is a real navigation: the
    // keyed view for aaaaaa unmounts, exactly as it would in a browser.
    await user.click(screen.getByRole("link", { name: "switch hole" }));
    await screen.findByText(/no requests/i);

    await act(async () => {
      confirmDelete(true);
    });

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.getAllByText("bbbbbb").length).toBeGreaterThan(0);
  });

  // A re-sync is the only thing that can notice a deletion made somewhere else
  // — another tab, a phone, curl. Merging it into what is already on screen
  // can only ever add, so the row stayed forever and its detail pane 404ed.
  it("drops a request that was deleted somewhere else", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gone = capturedRequest({
      request_address: "gone01",
      request_path: "/gone",
    });
    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      gone,
    ]);
    renderHole();
    await screen.findByText("/gone");
    act(() => lastEventSource!.onopen!());

    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    act(() => lastEventSource!.onerror!());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => lastEventSource!.onopen!());
    await act(async () => {});

    expect(screen.queryByText("/gone")).not.toBeInTheDocument();
    expect(screen.getByText("/abc123")).toBeVisible();
  });

  // A capture that arrives on the stream while a snapshot is out is newer than
  // that snapshot, so the snapshot's authority to remove rows must not extend
  // to it.
  it("keeps a capture that streamed in while the snapshot was out", async () => {
    let resolveSnapshot: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    renderHole();

    act(() => {
      lastEventSource!.onmessage!({
        data: JSON.stringify(
          capturedRequest({ request_address: "live01", method: "PATCH" }),
        ),
      } as MessageEvent);
    });
    await act(async () => {
      resolveSnapshot([capturedRequest()]);
    });

    expect(screen.getByText("PATCH")).toBeVisible();
  });

  // The delete button and the detail pane never shared a screen before this
  // task, so nothing had to decide what happens to the pane when its request
  // is deleted out from under it.
  it("navigates back to the list when the open request is deleted", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    vi.mocked(holeService.deleteRequest).mockResolvedValue(true);
    renderHoleAt("/view/abc123/req001");
    // The row, not the detail region: that section renders from the URL alone
    // on the first paint, so awaiting it says nothing about whether the
    // snapshot that draws the delete button has landed.
    await screen.findByRole("link", { name: "/abc123" });

    await user.click(screen.getByRole("button", { name: /delete/i }));

    // `useNavigate` is stubbed at the top of this file, so the pane cannot
    // actually unmount here — what the component owns is the decision to leave,
    // and replacing rather than pushing so Back does not return to a dead URL.
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith("/view/abc123", {
        replace: true,
      }),
    );
  });

  // The handler is created during a render and the DELETE settles later. If it
  // judges "was this the open one?" against the selection it was born with, it
  // closes a pane the reader opened in the meantime — and `replace` takes the
  // history entry with it.
  it("leaves alone a request the reader opened while the delete was in flight", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      capturedRequest({ request_address: "req002", request_path: "/other" }),
    ]);
    let confirmDelete: (deleted: boolean) => void = () => {};
    vi.mocked(holeService.deleteRequest).mockReturnValue(
      new Promise((resolve) => {
        confirmDelete = resolve;
      }),
    );
    renderHoleAt("/view/abc123/req001");
    await screen.findByText("/other");

    const list = screen.getByRole("region", { name: "Captured requests" });
    const doomedRow = within(list)
      .getByRole("link", { name: "/abc123" })
      .closest("tr")!;
    await user.click(
      within(doomedRow).getByRole("button", { name: /delete/i }),
    );
    // The reader moves on before the DELETE comes back.
    await user.click(screen.getByRole("link", { name: "/other" }));
    await act(async () => {
      confirmDelete(true);
    });

    expect(navigateSpy).not.toHaveBeenCalledWith("/view/abc123", {
      replace: true,
    });
  });

  // The snapshot is no longer a once-per-mount thing, so it can now be in
  // flight while the user acts on the list. One fetched before a delete must
  // not put the deleted row back.
  it("does not resurrect a deleted request with an older snapshot", async () => {
    const user = userEvent.setup();
    const doomed = capturedRequest({
      request_address: "doomed",
      request_path: "/doomed",
    });
    vi.mocked(holeService.getRequests).mockResolvedValue([
      capturedRequest(),
      doomed,
    ]);
    vi.mocked(holeService.deleteRequest).mockResolvedValue(true);
    renderHole();
    await screen.findByText("/doomed");

    // A snapshot taken before the delete, still in flight when it lands.
    let resolveStale: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValue(
      new Promise((resolve) => {
        resolveStale = resolve;
      }),
    );
    // An open is all it takes to ask for one; the reconnect that usually
    // prompts it is not what this test is about, and installing fake timers
    // for it — then swapping back mid-test, with promises already in flight —
    // was making this test fail at random.
    await act(async () => {
      lastEventSource!.onopen!();
    });

    const doomedRow = screen.getByText("/doomed").closest("tr")!;
    await user.click(
      within(doomedRow).getByRole("button", { name: /delete/i }),
    );
    await waitFor(() =>
      expect(screen.queryByText("/doomed")).not.toBeInTheDocument(),
    );

    await act(async () => {
      resolveStale([capturedRequest(), doomed]);
    });

    expect(screen.queryByText("/doomed")).not.toBeInTheDocument();
  });
});

describe("Hole empty state", () => {
  it("tells the user to send a request, showing the hole's capture URL", async () => {
    renderHole();

    const panel = (await screen.findByText(/no requests/i)).closest("div")!;
    // Scoped to the panel: the page header shows the same URL, so a document
    // -wide query would pass with the empty state's copy of it deleted.
    expect(
      within(panel).getByText(`${window.location.origin}/abc123`),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // Starting from an empty array meant the designed "nothing here" panel was
  // also the first thing painted on every visit, and the last thing painted
  // after a failed load.
  it("waits for the first load rather than claiming the hole is empty", async () => {
    let resolveRequests: (requests: RequestObject[]) => void = () => {};
    vi.mocked(holeService.getRequests).mockReturnValue(
      new Promise((resolve) => {
        resolveRequests = resolve;
      }),
    );
    renderHole();

    expect(screen.queryByText(/no requests/i)).not.toBeInTheDocument();

    resolveRequests([]);
    expect(await screen.findByText(/no requests/i)).toBeVisible();
  });

  it("reports a failed load instead of claiming the hole is empty", async () => {
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    renderHole();

    expect(
      await screen.findByText(/couldn't load this hole's requests/i),
    ).toBeVisible();
    expect(screen.queryByText(/no requests/i)).not.toBeInTheDocument();
  });

  // The panel is where a reader who has just watched the load fail is looking,
  // so the way out belongs on it — waiting for the automatic retry's backoff
  // is not what someone staring at an error message wants to do.
  it("offers a way to ask again from the failure panel", async () => {
    // Frozen: the automatic retry is a second later, and a test that let it
    // run would pass with the button wired to nothing.
    vi.useFakeTimers();
    vi.mocked(holeService.getRequests).mockRejectedValue(new Error("offline"));
    renderHole();
    await act(async () => {});
    expect(
      screen.getByText(/couldn't load this hole's requests/i),
    ).toBeVisible();

    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    const asked = vi.mocked(holeService.getRequests).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await act(async () => {});

    expect(vi.mocked(holeService.getRequests).mock.calls.length).toBe(
      asked + 1,
    );
    expect(screen.getByText("/abc123")).toBeVisible();
    expect(
      screen.queryByText(/couldn't load this hole's requests/i),
    ).not.toBeInTheDocument();
  });
});
