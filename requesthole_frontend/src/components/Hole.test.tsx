import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RequestObject } from "../types";
import holeService from "../services";
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

  it("renders the captured timestamp readably rather than as raw ISO text", async () => {
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();
    await screen.findByText("probe=1");

    expect(
      screen.queryByText("2026-07-25T14:03:22.145Z"),
    ).not.toBeInTheDocument();
  });
});

describe("Hole capture URL", () => {
  // BASE_URL is "" in production, which used to yield the bare path "/abc123".
  it("shows an absolute URL and copies that same URL", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getRequests).mockResolvedValue([capturedRequest()]);
    renderHole();

    const expected = `${window.location.origin}/abc123`;
    expect(await screen.findByText(expected)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /copy/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(expected);
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
});
