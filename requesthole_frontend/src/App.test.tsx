import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import holeService from "./services";
import App from "./App";

vi.mock("./services", () => ({
  default: {
    BASE_URL: "",
    getHoles: vi.fn(),
    addHole: vi.fn(),
    deleteHole: vi.fn(),
    getRequests: vi.fn(),
    deleteRequest: vi.fn(),
  },
}));

function StubEventSource() {
  return { onmessage: null, onerror: null, close: vi.fn() };
}
vi.stubGlobal("EventSource", StubEventSource);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(holeService.getHoles).mockResolvedValue([]);
  vi.mocked(holeService.getRequests).mockResolvedValue([]);
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

describe("creating a hole after a failed load", () => {
  // The failed panel offers a create button, so creating has to work from a
  // state where the backend was just unreachable — including when it still is.
  it("does not fail silently when the backend is still down", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getHoles).mockRejectedValue(new Error("offline"));
    vi.mocked(holeService.addHole).mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByText(/couldn't load your holes/i);

    // An uncaught rejection here fails the run, which is the point: the button
    // used to swallow the error and leave the panel untouched.
    await user.click(screen.getByRole("button", { name: /create hole/i }));

    expect(screen.getByText(/couldn't load your holes/i)).toBeVisible();
  });

  it("clears the failed state once a hole is created", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.getHoles).mockRejectedValue(new Error("offline"));
    vi.mocked(holeService.addHole).mockResolvedValue([
      { hole_address: "zzz999" },
    ]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByText(/couldn't load your holes/i);

    await user.click(screen.getByRole("button", { name: /create hole/i }));
    await screen.findByRole("heading", { level: 1, name: /Hole zzz999/i });

    // Back on the list: the hole the user just made must not read as lost.
    await user.click(screen.getByRole("link", { name: "Home" }));

    expect(
      screen.queryByText(/couldn't load your holes/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
