/** How much of a binary body the preview shows. */
export const HEX_PREVIEW_BYTES = 64;

const BYTES_PER_LINE = 16;

/**
 * A classic hex dump of the first HEX_PREVIEW_BYTES bytes: 16 hex pairs per
 * line, then the same bytes as ASCII with non-printables shown as dots so
 * control characters never reach the DOM text.
 */
export function hexPreview(bytes: Uint8Array): string {
  const preview = bytes.subarray(0, HEX_PREVIEW_BYTES);
  const lines: string[] = [];

  for (let at = 0; at < preview.length; at += BYTES_PER_LINE) {
    const line = preview.subarray(at, at + BYTES_PER_LINE);
    const hex = Array.from(line, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(" ");
    const ascii = Array.from(line, (byte) =>
      byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
    ).join("");
    lines.push(`${hex.padEnd(BYTES_PER_LINE * 3 - 1)}  |${ascii}|`);
  }

  return lines.join("\n");
}
