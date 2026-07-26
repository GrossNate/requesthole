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
    vi.mocked(holeService.getBody).mockResolvedValue({ hello: "world" });
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
    const createObjectURL = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(holeService.getRequest).mockResolvedValue(
      captured('{"content-type":"application/pdf"}'),
    );
    renderRequest();

    const download = await screen.findByRole("link", { name: /pdf/i });
    await waitFor(() =>
      expect(download.getAttribute("href")).toBe("blob:fake"),
    );
    expect(download).toHaveAttribute("download");
    expect(
      screen.queryByRole("link", { name: /\/api\/request/ }),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
