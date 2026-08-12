import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import type { RequestObject } from "../types";
import holeService from "../services";
import Hole from "./Hole";

// Deliberately no `useNavigate` stub — unlike Hole.test.tsx, these tests are
// about the history stack itself, so the real router has to do the navigating
// and the real Back has to walk it.

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getRequests: vi.fn(),
    deleteRequest: vi.fn(),
    getRequest: vi.fn(),
    getBodyBytes: vi.fn(),
  },
}));

type StubEventSource = {
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};
let lastEventSource: StubEventSource | null = null;

function StubEventSource(): StubEventSource {
  lastEventSource = {
    onopen: null,
    onmessage: null,
    onerror: null,
    close: vi.fn(),
  };
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

// The browser's Back button, and a readout of where it landed.
const Chrome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        go back
      </button>
      <span data-testid="where">{location.pathname}</span>
    </>
  );
};

const renderHole = () =>
  render(
    <MemoryRouter initialEntries={["/view/abc123"]}>
      <Chrome />
      <Routes>
        <Route path="/view/:hole_address" element={<Hole />} />
        <Route path="/view/:hole_address/:request_address" element={<Hole />} />
      </Routes>
    </MemoryRouter>,
  );

const rowFor = (path: string) =>
  screen.getByRole("link", { name: path }).closest("tr")!;

beforeEach(() => {
  vi.clearAllMocks();
  lastEventSource = null;
  vi.mocked(holeService.getRequests).mockResolvedValue([
    capturedRequest(),
    capturedRequest({ request_address: "req002", request_path: "/other" }),
  ]);
  vi.mocked(holeService.getRequest).mockResolvedValue(capturedRequest());
  vi.mocked(holeService.getBodyBytes).mockResolvedValue(new ArrayBuffer(0));
});

describe("Hole history", () => {
  // The row is a click target the whole way across and it stays on screen once
  // its request is open, so clicking the open one again is ordinary. Every one
  // of those clicks used to push an entry identical to the one already on top,
  // so Back returned the reader to the request they were already reading —
  // once per stray click.
  it("does not stack up entries when the open request is clicked again", async () => {
    const user = userEvent.setup();
    renderHole();
    await screen.findByText("/other");

    await user.click(within(rowFor("/abc123")).getByText("POST"));
    expect(await screen.findByTestId("where")).toHaveTextContent(
      "/view/abc123/req001",
    );

    // Both ways in: the row away from the link, and the link itself.
    await user.click(within(rowFor("/abc123")).getByText("POST"));
    await user.click(within(rowFor("/abc123")).getByRole("link"));
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/view/abc123/req001",
    );

    await user.click(screen.getByRole("button", { name: "go back" }));

    expect(screen.getByTestId("where")).toHaveTextContent("/view/abc123");
    expect(
      screen.queryByRole("region", { name: "Request detail" }),
    ).not.toBeInTheDocument();
  });

  // The other half of the same rule: moving between requests is real
  // navigation, and Back has to walk it one request at a time.
  it("keeps a way back to the request you were reading before", async () => {
    const user = userEvent.setup();
    renderHole();
    await screen.findByText("/other");

    await user.click(within(rowFor("/abc123")).getByText("POST"));
    await user.click(within(rowFor("/other")).getByText("POST"));
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/view/abc123/req002",
    );

    await user.click(screen.getByRole("button", { name: "go back" }));

    expect(screen.getByTestId("where")).toHaveTextContent(
      "/view/abc123/req001",
    );
  });
});
