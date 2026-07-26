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

describe("holes dropdown", () => {
  // Every empty list goes through EmptyState, including this one — a menu is
  // too small for the panel, which is what the compact variant is for.
  it("uses the shared empty state when there are no holes", async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // Home's own empty state says the same thing, so scope to the menu.
    const headings = await screen.findAllByRole("heading", {
      name: /no holes yet/i,
    });
    const empty = headings.find((heading) =>
      heading.closest(".dropdown-content"),
    );
    expect(empty).toBeDefined();
    // Compact: no panel, so the dropdown does not get a dashed box inside it.
    expect(empty!.closest("div")?.className).not.toContain("border-dashed");
  });

  it("says so when the holes could not be loaded", async () => {
    vi.mocked(holeService.getHoles).mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: /couldn't load holes/i }),
    ).toBeVisible();
  });
});
