import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
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
  },
}));

// jsdom has no EventSource. The stub records what was opened and hands the
// most recent instance back, so tests can push a message through the stream.
type StubEventSource = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};
const eventSourceUrls: string[] = [];
let lastEventSource: StubEventSource | null = null;

// A plain function, not an arrow: the component calls it with `new`. Returning
// an object makes that construction yield the stub.
function StubEventSource(url: string): StubEventSource {
  eventSourceUrls.push(url);
  lastEventSource = { onmessage: null, onerror: null, close: vi.fn() };
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

const renderHole = () =>
  render(
    <MemoryRouter initialEntries={["/view/abc123"]}>
      <Routes>
        <Route path="/view/:hole_address" element={<Hole />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  eventSourceUrls.length = 0;
  lastEventSource = null;
  vi.mocked(holeService.getRequests).mockResolvedValue([]);
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

    // The second hole resolves empty rather than hanging: a pending fetch would
    // paint the loading state and hide stale rows either way, so the assertion
    // below would pass even with the keying removed.
    vi.mocked(holeService.getRequests).mockResolvedValue([]);
    await user.click(screen.getByRole("link", { name: "switch hole" }));
    await screen.findByText(/no requests/i);

    expect(screen.queryByText("/aaaaaa")).not.toBeInTheDocument();
    expect(screen.getAllByText("bbbbbb").length).toBeGreaterThan(0);
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
});
