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
});
