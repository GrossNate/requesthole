import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CopyButton from "./CopyButton";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(await screen.findByText("Copied")).toBeVisible();
  });

  // navigator.clipboard is absent on insecure origins, which is exactly when a
  // silent no-op would be indistinguishable from a successful copy.
  it("says so when the clipboard rejects", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    render(<CopyButton value="https://requesthole.example/abc123" />);

    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(await screen.findByText("Copy failed")).toBeVisible();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  // The label reverting on a timer is not an event worth announcing; only the
  // outcome of the click is.
  it("announces the outcome once, from a region separate from the label", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="https://requesthole.example/abc123" />);

    await user.click(screen.getByRole("button", { name: /copy/i }));

    const live = await screen.findByRole("status");
    expect(live).toHaveTextContent("Copied to clipboard");
    expect(live).not.toContainElement(screen.getByText("Copied"));
  });

  // The confirmation is temporary by design; without this nothing checks that
  // the button ever returns to its resting state.
  it("goes back to its resting label after the confirmation", async () => {
    vi.useFakeTimers();
    // fireEvent rather than user-event: user-event's own async clipboard does
    // not settle while the timers are faked.
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<CopyButton value="https://requesthole.example/abc123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });
    expect(screen.getByText("Copied")).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeVisible();

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
