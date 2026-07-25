import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import holeService from "./services";
import App from "./App";

vi.mock("./services", () => ({
  default: {
    BASE_URL: "",
    getHoles: vi.fn(),
    addHole: vi.fn(),
    deleteHole: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(holeService.getHoles).mockResolvedValue([]);
});

describe("app shell", () => {
  it("pairs the logo with the wordmark, and gives the logo a text alternative", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: /requesthole/i })).toBeVisible();
    expect(screen.getByRole("banner")).toHaveTextContent("RequestHole");
  });

  // The wordmark is site chrome, not a page heading; the route owns the h1.
  it("leaves exactly one level-1 heading on the page", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
