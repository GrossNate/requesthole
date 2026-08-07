import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import holeService from "../services";
import Request from "./Request";

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getRequest: vi.fn(),
    getBody: vi.fn(),
    getBodyBytes: vi.fn(),
  },
}));

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
  vi.mocked(holeService.getBody).mockResolvedValue("");
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
  // The fetch used to run during render, so each response re-rendered the
  // component and fetched again — an unbounded request loop for JSON bodies.
  it("fetches a JSON body once, not once per render", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"application/json"}'),
    );
    vi.mocked(holeService.getBody).mockResolvedValue('{"hello":"world"}');
    renderRequest();

    await screen.findByText(/hello/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(holeService.getBody).toHaveBeenCalledTimes(1);
  });

  it("fetches a text body once", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"text/plain"}'),
    );
    vi.mocked(holeService.getBody).mockResolvedValue("a plain text body");
    renderRequest();

    await screen.findByText("a plain text body");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(holeService.getBody).toHaveBeenCalledTimes(1);
  });

  // Captured bodies are attacker-controlled and must never be navigated to on
  // this origin, whatever headers the endpoint sets.
  it("offers a PDF as a locally-built download, never a link to the body URL", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"application/pdf"}'),
    );
    renderRequest();

    const download = await screen.findByRole("link", { name: /pdf/i });
    await waitFor(() =>
      expect(download.getAttribute("href")).toBe("blob:fake"),
    );
    expect(download).toHaveAttribute("download");
    // The accessible name never contains the href, so asserting on the name
    // would pass for any implementation. Assert on the href itself.
    expect(download.getAttribute("href")).not.toMatch(/\/api\/request/);
  });

  // Under StrictMode the first effect run is always cleaned up before its fetch
  // resolves, so a blob built afterwards would never be revoked.
  it("revokes a blob whose fetch lands after the viewer is gone", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL,
    });
    let resolveBytes: (bytes: ArrayBuffer) => void = () => {};
    vi.mocked(holeService.getBodyBytes).mockReturnValue(
      new Promise((resolve) => {
        resolveBytes = resolve;
      }),
    );
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"application/pdf"}'),
    );
    const { unmount } = renderRequest();
    // Not by link role — until the bytes land the anchor has no href, so it is
    // not a link yet.
    await screen.findByText(/download pdf/i);

    unmount();
    resolveBytes(new ArrayBuffer(8));

    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake"),
    );
  });
});

describe("Request load state", () => {
  // Rendering the "no headers" empty state before the fetch resolves — and
  // forever after it fails — states something untrue about the request.
  it("waits for the first load rather than claiming there were no headers", () => {
    vi.mocked(holeService.getRequest).mockReturnValue(new Promise(() => {}));
    renderRequest();

    expect(screen.queryByText(/no headers/i)).not.toBeInTheDocument();
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
