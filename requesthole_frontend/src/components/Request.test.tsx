import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import holeService from "../services";
import Request from "./Request";

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getRequest: vi.fn(),
    getBody: vi.fn(),
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

beforeEach(() => {
  vi.mocked(holeService.getRequest).mockResolvedValue({
    request_address: "req001",
    created: "2026-07-25T14:03:22.145Z",
    method: "POST",
    request_path: "/abc123",
    query_params: "{}",
    headers: '{"user-agent":"curl/8.7.1"}',
  });
});

describe("Request detail", () => {
  // The header name labels its value; without scope it is just a bold cell.
  it("labels each header value with a row header", async () => {
    renderRequest();

    expect(
      await screen.findByRole("rowheader", { name: "user-agent" }),
    ).toBeVisible();
  });

  it("shows the captured query parameters, not raw JSON text", async () => {
    vi.mocked(holeService.getRequest).mockResolvedValue({
      request_address: "req001",
      created: "2026-07-25T14:03:22.145Z",
      method: "GET",
      request_path: "/abc123",
      query_params: '{"probe":"1"}',
      headers: "{}",
    });
    renderRequest();

    expect(await screen.findByText("probe=1")).toBeVisible();
    expect(screen.queryByText('{"probe":"1"}')).not.toBeInTheDocument();
  });
});
