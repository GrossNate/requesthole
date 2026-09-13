import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import holeService from "./services";
import App from "./App";
import { HoleLimitError } from "./errors";

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
  return {
    onmessage: null,
    onerror: null,
    addEventListener: vi.fn(),
    close: vi.fn(),
  };
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
    // And the click is answered: the create says it failed.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't create a hole/i,
    );
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

// Creating can now be refused on purpose: a client at its share of live holes
// or its hourly budget gets 429, and a deployment at its ceiling gets 503. A
// refusal used to land in the same catch as an outage, which swapped a list
// that loaded fine for "The backend didn't answer".
describe("a hole creation that is refused", () => {
  const renderLoaded = async () => {
    vi.mocked(holeService.getHoles).mockResolvedValue([
      { hole_address: "abc123" },
    ]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("table");
  };

  it("keeps the list and says a limit was hit", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(
      new HoleLimitError("share"),
    );
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /create hole/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/limit/i);
    expect(screen.getByRole("table")).toBeVisible();
    expect(
      screen.queryByText(/couldn't load your holes/i),
    ).not.toBeInTheDocument();
  });

  it("tells a client at its share to delete a hole", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(
      new HoleLimitError("share"),
    );
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /create hole/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/delete/i);
  });

  // Deleting frees nothing against the hourly limit, so the page must not
  // send the reader off to delete holes; it says how long to wait instead.
  it("tells a client at the hourly limit to wait, not to delete", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(
      new HoleLimitError("rate-limit", 1800),
    );
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /create hole/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/30 minutes/i);
    expect(alert).not.toHaveTextContent(/delete/i);
  });

  // The refusal describes a moment. Once the reader acts on it, or leaves,
  // it is no longer true, and a stale "you're at the limit" is misleading.
  it("drops the message once the reader deletes a hole", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(
      new HoleLimitError("share"),
    );
    vi.mocked(holeService.deleteHole).mockResolvedValue(true);
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: /create hole/i }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("drops the message once the reader leaves the page", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(
      new HoleLimitError("share"),
    );
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: /create hole/i }));
    await screen.findByRole("alert");

    await user.click(
      within(screen.getByRole("table")).getByRole("link", { name: "abc123" }),
    );
    await screen.findByRole("heading", { level: 1, name: /Hole abc123/i });
    await user.click(screen.getByRole("link", { name: "Home" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the deployment is full when the ceiling refuses it", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(
      new HoleLimitError("full"),
    );
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /create hole/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/full/i);
    expect(screen.getByRole("table")).toBeVisible();
  });

  it("says the create failed, without hiding the list, when the backend is down", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole).mockRejectedValue(new Error("offline"));
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /create hole/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't create a hole/i,
    );
    expect(screen.getByRole("table")).toBeVisible();
  });

  it("clears the message once a create succeeds", async () => {
    const user = userEvent.setup();
    vi.mocked(holeService.addHole)
      .mockRejectedValueOnce(new HoleLimitError("share"))
      .mockResolvedValueOnce([{ hole_address: "zzz999" }]);
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /create hole/i }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /create hole/i }));
    await screen.findByRole("heading", { level: 1, name: /Hole zzz999/i });
    await user.click(screen.getByRole("link", { name: "Home" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
