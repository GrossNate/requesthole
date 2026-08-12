import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import holeService from "../services";
import Request from "./Request";

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getRequest: vi.fn(),
    getBodyBytes: vi.fn(),
  },
}));

const toBytes = (text: string) => {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(0, encoded.byteLength) as ArrayBuffer;
};

const renderRequest = () =>
  render(
    <MemoryRouter initialEntries={["/view/abc123/req001"]}>
      <Routes>
        <Route
          path="/view/:hole_address/:request_address"
          element={<Request />}
        />
      </Routes>
    </MemoryRouter>,
  );

const captured = (headers: string) => ({
  request_address: "req001",
  created: "2026-07-25T14:03:22.145Z",
  method: "POST",
  request_path: "/abc123",
  query_params: "{}",
  headers,
});

beforeEach(() => {
  vi.mocked(holeService.getRequest).mockResolvedValue(
    captured('{"user-agent":"curl/8.7.1"}'),
  );
  vi.mocked(holeService.getBodyBytes).mockResolvedValue(new ArrayBuffer(0));
});

afterEach(() => {
  vi.clearAllMocks();
  // Teardown belongs in the hook: a failing assertion inside a test body would
  // otherwise leave the URL global stubbed for everything after it.
  vi.unstubAllGlobals();
});

describe("Request detail", () => {
  // The header name labels its value; without scope it is just a bold cell.
  it("labels each header value with a row header", async () => {
    renderRequest();

    expect(
      await screen.findByRole("rowheader", { name: "user-agent" }),
    ).toBeVisible();
  });

  it("says so when a request carried no headers", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue(captured("{}"));
    renderRequest();

    expect(await screen.findByText(/no headers/i)).toBeVisible();
  });

  it("shows the captured timestamp readably, keeping the exact value to hand", async () => {
    renderRequest();

    const shown = await screen.findByTitle("2026-07-25T14:03:22.145Z");
    expect(shown).toBeVisible();
    expect(shown).not.toHaveTextContent("2026-07-25T14:03:22.145Z");
  });
});

describe("Request body", () => {
  // The per-family rendering lives in RequestBody.test.tsx; these pin the
  // integration — the detail view passes the captured content-type through
  // and the body is fetched exactly once per mount, not once per render
  // (which used to be an unbounded request loop).
  it("renders a JSON body through the content-aware viewer, fetching once", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"application/json"}'),
    );
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes('{"hello":"world"}'),
    );
    const { container } = renderRequest();

    await waitFor(() =>
      expect(container.textContent).toContain('"hello": "world"'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(holeService.getBodyBytes).toHaveBeenCalledTimes(1);
  });

  it("fetches a text body once", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"text/plain"}'),
    );
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("a plain text body"),
    );
    renderRequest();

    await screen.findByText("a plain text body");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(holeService.getBodyBytes).toHaveBeenCalledTimes(1);
  });
});

describe("Request load state", () => {
  // The pane used to be its own route, so switching requests remounted it and
  // the header could not be stale. Inside the hole view one instance is reused
  // across selections, and the header was showing the request you just left
  // while the body underneath said "Loading request…".
  it("shows nothing of the previous request while the next one loads", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue({
      ...captured("{}"),
      method: "DELETE",
      request_path: "/the-previous-one",
      request_address: "other0",
    });
    renderRequest();

    await screen.findByText(/loading request/i);

    expect(screen.queryByText("/the-previous-one")).not.toBeInTheDocument();
    expect(screen.queryByText("DELETE")).not.toBeInTheDocument();
  });

  // On a route change the first render still holds the previous request's
  // record, so the body viewer would fire a full-body fetch for the new
  // address classified under the old content-type.
  it("does not render the body viewer for a record that doesn't match the route", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue({
      ...captured('{"content-type":"application/json"}'),
      request_address: "other0",
    });
    renderRequest();

    await screen.findByText(/loading request/i);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(holeService.getBodyBytes).not.toHaveBeenCalled();
  });
  // Rendering the "no headers" empty state before the fetch resolves — and
  // forever after it fails — states something untrue about the request.
  it("waits for the first load rather than claiming there were no headers", () => {
    vi.mocked(holeService.getRequest).mockReturnValue(new Promise(() => {}));
    renderRequest();

    expect(screen.queryByText(/no headers/i)).not.toBeInTheDocument();
  });

  // The pane keeps the record it loaded last, which is what makes a fetch that
  // rejects mid-selection ambiguous: the state says "failed" while the record
  // in hand says "you are looking at the previous request". Reading staleness
  // first left the reader on "Loading request…" for good — reachable by
  // opening a request that another tab has since deleted.
  it("reports a failed load for a request opened after one that succeeded", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/view/abc123/req001"]}>
        <Link to="/view/abc123/req002">the next one</Link>
        <Routes>
          <Route
            path="/view/:hole_address/:request_address"
            element={<Request />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("rowheader", { name: "user-agent" });

    vi.mocked(holeService.getRequest).mockRejectedValue(new Error("gone"));
    await user.click(screen.getByRole("link", { name: "the next one" }));

    expect(
      await screen.findByText(/couldn't load this request/i),
    ).toBeVisible();
    expect(screen.queryByText(/loading request/i)).not.toBeInTheDocument();
    // And nothing of the request the reader left is still captioning it.
    expect(screen.queryByText("/abc123")).not.toBeInTheDocument();
    expect(screen.queryByText("POST")).not.toBeInTheDocument();
  });

  it("reports a failed load rather than claiming there were no headers", async () => {
    vi.mocked(holeService.getRequest).mockRejectedValue(new Error("offline"));
    renderRequest();

    expect(
      await screen.findByText(/couldn't load this request/i),
    ).toBeVisible();
    expect(screen.queryByText(/no headers/i)).not.toBeInTheDocument();
  });

  // The address reaches API URLs and the download filename straight from the
  // route, exactly as the hole address does.
  it("refuses an address that is not a real request address", async () => {
    render(
      <MemoryRouter initialEntries={["/view/abc123/a%2F..%2Fapi"]}>
        <Routes>
          <Route
            path="/view/:hole_address/:request_address"
            element={<Request />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/not a valid request address/i),
    ).toBeVisible();
    expect(holeService.getRequest).not.toHaveBeenCalled();
  });
});
