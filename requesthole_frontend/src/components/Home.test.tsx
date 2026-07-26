import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";

const renderHome = (
  holes: { hole_address: string }[],
  loadState: "loading" | "loaded" | "failed" = "loaded",
) =>
  render(
    <MemoryRouter>
      <Home
        holes={holes}
        setHoles={vi.fn()}
        createHole={vi.fn()}
        loadState={loadState}
      />
    </MemoryRouter>,
  );

describe("Home", () => {
  // Previously an empty list rendered nothing at all — a blank page below the
  // create button, indistinguishable from a failed load.
  it("explains the empty list instead of rendering nothing", () => {
    renderHome([]);

    expect(screen.getByText(/no holes yet/i)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // The list starts empty while the fetch is in flight, so "No holes yet" was
  // the first thing painted on every visit.
  it("waits for the first load rather than claiming there are none", () => {
    renderHome([], "loading");

    expect(screen.queryByText(/no holes yet/i)).not.toBeInTheDocument();
  });

  // A rejected fetch also leaves the list empty. Telling a user with holes that
  // they have none, and inviting them to make another, is worse than an error.
  it("reports a failed load instead of claiming there are none", () => {
    renderHome([], "failed");

    expect(screen.getByText(/couldn't load your holes/i)).toBeVisible();
    expect(screen.queryByText(/no holes yet/i)).not.toBeInTheDocument();
  });

  it("gives the hole list a real column header", () => {
    renderHome([{ hole_address: "abc123" }]);

    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Address"]));
  });
});
