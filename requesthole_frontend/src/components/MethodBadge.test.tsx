import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MethodBadge from "./MethodBadge";

describe("MethodBadge", () => {
  it("shows the method in upper case however it was captured", () => {
    render(<MethodBadge method="post" />);

    expect(screen.getByText("POST")).toBeVisible();
  });

  // The method is whatever the client sent, so anything at all can land here.
  it("still renders a method it has no colour for", () => {
    render(<MethodBadge method="PROPFIND" />);

    const badge = screen.getByText("PROPFIND");
    expect(badge).toBeVisible();
    expect(badge.className).toContain("badge-neutral");
  });

  // An attacker-supplied method must never reach the class list.
  it("never puts the captured method into its own class names", () => {
    render(<MethodBadge method="badge-error animate-spin" />);

    const badge = screen.getByText("BADGE-ERROR ANIMATE-SPIN");
    expect(badge.className).toContain("badge-neutral");
    expect(badge.className).not.toContain("badge-error");
  });
});
