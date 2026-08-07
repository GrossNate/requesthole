import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  it("presents its title as a heading, with the explanation beside it", () => {
    render(
      <EmptyState
        title="No holes yet"
        description="Create a hole to start capturing requests."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No holes yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Create a hole to start capturing requests."),
    ).toBeVisible();
  });

  it("renders whatever the caller puts inside it", () => {
    render(
      <EmptyState title="Waiting for requests">
        <p>https://requesthole.example/abc123</p>
      </EmptyState>,
    );

    expect(
      screen.getByText("https://requesthole.example/abc123"),
    ).toBeVisible();
  });

  // Small surfaces — a dropdown, a side panel — get the same component rather
  // than an ad-hoc line, so an empty list reads the same everywhere. The
  // compact form drops the panel that would swamp a 224px menu.
  it("drops the panel in its compact form but keeps the heading", () => {
    const { container } = render(<EmptyState compact title="No holes yet" />);

    expect(
      screen.getByRole("heading", { name: "No holes yet" }),
    ).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain(
      "border-dashed",
    );
  });

  it("draws the panel in its default form", () => {
    const { container } = render(<EmptyState title="No holes yet" />);

    expect(container.firstElementChild?.className).toContain("border-dashed");
  });
});
