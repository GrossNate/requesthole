import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import holeService from "./services";
import MediaConfigProvider from "./MediaConfigProvider";
import { useAllowMedia } from "./mediaConfigContext";

vi.mock("./services", () => ({
  default: { getConfig: vi.fn() },
}));

const Probe = () => {
  const allowMedia = useAllowMedia();
  return (
    <span>
      {allowMedia === undefined
        ? "pending"
        : allowMedia
          ? "media on"
          : "media off"}
    </span>
  );
};

const renderProvided = () =>
  render(
    <MediaConfigProvider>
      <Probe />
    </MediaConfigProvider>,
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe("MediaConfigProvider", () => {
  it("is pending until the instance answers, then says media on, fetching once", async () => {
    vi.mocked(holeService.getConfig).mockResolvedValue({ allowMedia: true });
    const { rerender } = renderProvided();

    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(await screen.findByText("media on")).toBeInTheDocument();
    rerender(
      <MediaConfigProvider>
        <Probe />
      </MediaConfigProvider>,
    );
    expect(holeService.getConfig).toHaveBeenCalledTimes(1);
  });

  // getConfig turns any failure into `{ allowMedia: false }`, so this is also
  // what a failed fetch looks like here.
  it("settles on media off when the instance says so", async () => {
    vi.mocked(holeService.getConfig).mockResolvedValue({ allowMedia: false });
    renderProvided();

    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(await screen.findByText("media off")).toBeInTheDocument();
  });

  it("is media off with no provider at all", () => {
    render(<Probe />);
    expect(screen.getByText("media off")).toBeInTheDocument();
  });
});
