import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import holeService from "./services";
import MediaConfigProvider from "./MediaConfigProvider";
import { useAllowMedia } from "./mediaConfigContext";

vi.mock("./services", () => ({
  default: { getConfig: vi.fn() },
}));

const Probe = () => <span>{useAllowMedia() ? "media on" : "media off"}</span>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("MediaConfigProvider", () => {
  it("reports media off until the instance says otherwise, fetching once", async () => {
    vi.mocked(holeService.getConfig).mockResolvedValue({ allowMedia: true });
    const { rerender } = render(
      <MediaConfigProvider>
        <Probe />
      </MediaConfigProvider>,
    );

    expect(screen.getByText("media off")).toBeInTheDocument();
    expect(await screen.findByText("media on")).toBeInTheDocument();
    rerender(
      <MediaConfigProvider>
        <Probe />
      </MediaConfigProvider>,
    );
    expect(holeService.getConfig).toHaveBeenCalledTimes(1);
  });

  it("stays media off when the instance says so", async () => {
    vi.mocked(holeService.getConfig).mockResolvedValue({ allowMedia: false });
    render(
      <MediaConfigProvider>
        <Probe />
      </MediaConfigProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("media off")).toBeInTheDocument();
  });

  it("is media off with no provider at all", () => {
    render(<Probe />);
    expect(screen.getByText("media off")).toBeInTheDocument();
  });
});
