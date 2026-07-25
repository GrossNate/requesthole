import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CopyButton from "./CopyButton";

describe("CopyButton", () => {
  it("copies the value it was given", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="https://requesthole.example/abc123" />);

    await user.click(screen.getByRole("button", { name: /copy/i }));

    await expect(navigator.clipboard.readText()).resolves.toBe(
      "https://requesthole.example/abc123",
    );
  });

  it("confirms visibly that it copied", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="https://requesthole.example/abc123" />);

    expect(screen.queryByText(/copied/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(await screen.findByText(/copied/i)).toBeVisible();
  });
});
