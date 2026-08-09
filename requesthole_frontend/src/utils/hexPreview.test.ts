import { describe, it, expect } from "vitest";
import { hexPreview, HEX_PREVIEW_BYTES } from "./hexPreview";

describe("hexPreview", () => {
  it("renders 16 bytes per line as hex plus printable ASCII", () => {
    const bytes = new TextEncoder().encode("GIF89a and then some more text!!");
    expect(hexPreview(bytes)).toBe(
      [
        "47 49 46 38 39 61 20 61 6e 64 20 74 68 65 6e 20  |GIF89a and then |",
        "73 6f 6d 65 20 6d 6f 72 65 20 74 65 78 74 21 21  |some more text!!|",
      ].join("\n"),
    );
  });

  // Binary bodies are arbitrarily large; the preview is a glimpse, not a dump.
  it("previews at most HEX_PREVIEW_BYTES bytes", () => {
    const bytes = new Uint8Array(HEX_PREVIEW_BYTES + 100).fill(65);
    const lines = hexPreview(bytes).split("\n");
    expect(lines).toHaveLength(HEX_PREVIEW_BYTES / 16);
  });

  // Non-printable bytes must show as placeholders, not leak control
  // characters into the DOM text.
  it("substitutes dots for non-printable bytes and pads a short tail line", () => {
    expect(hexPreview(new Uint8Array([0, 31, 65, 127]))).toBe(
      "00 1f 41 7f                                      |..A.|",
    );
  });
});
