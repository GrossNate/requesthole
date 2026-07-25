import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";

const renderHome = (holes: { hole_address: string }[]) =>
  render(
    <MemoryRouter>
      <Home holes={holes} setHoles={vi.fn()} createHole={vi.fn()} />
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

  it("gives the hole list a real column header", () => {
    renderHome([{ hole_address: "abc123" }]);

    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Address"]));
  });
});
