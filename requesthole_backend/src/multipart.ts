import { parseParameters } from "./media-type";

/**
 * A `multipart/form-data` body split into its parts, on bytes rather than
 * text: a file part can be binary that a text decode would corrupt.
 *
 * Ported from the frontend's parser (requesthole_frontend/src/utils/
 * multipart.ts) — the packages are separate. The backend adds what rebuilding
 * a stored body needs: each part's raw header block and every header line,
 * and it stops at the close delimiter so the epilogue never becomes parts.
 */
export interface MultipartPart {
  /** The `name` from the part's content-disposition, if present. */
  name: string | undefined;
  /** The `filename` from the part's content-disposition, if present. */
  filename: string | undefined;
  /** The part's first `content-type` header value, if present. */
  contentType: string | undefined;
  /** Every header line, names lowercased, in order, duplicates kept. */
  headers: [string, string][];
  /** The header block verbatim, without the blank line that ends it. */
  headerBytes: Buffer;
  bytes: Buffer;
}

export interface MultipartParseResult {
  parts: MultipartPart[];
  /** Regions between delimiters that could not be parsed as a part. */
  skipped: number;
}

const CR = 13;
const LF = 10;
const DASH = 45;
const CRLF_CRLF = Buffer.from("\r\n\r\n");

/**
 * Positions where `--boundary` is a real delimiter per RFC 2046: at the very
 * start of the body or preceded by CRLF, and followed (after optional linear
 * whitespace) by CRLF, the closing `--`, or end of input. A bare
 * `--boundary` in the middle of a content line is legal part content.
 * Collection ends at the first close delimiter.
 */
function delimiterPositions(bytes: Buffer, delimiter: Buffer): number[] {
  const positions: number[] = [];
  for (
    let at = bytes.indexOf(delimiter, 0);
    at !== -1;
    at = bytes.indexOf(delimiter, at + delimiter.length)
  ) {
    if (at !== 0 && !(bytes[at - 2] === CR && bytes[at - 1] === LF)) continue;

    let after = at + delimiter.length;
    const closing = bytes[after] === DASH && bytes[after + 1] === DASH;
    if (closing) after += 2;
    while (bytes[after] === 32 || bytes[after] === 9) after += 1;
    const atLineEnd =
      after >= bytes.length || (bytes[after] === CR && bytes[after + 1] === LF);
    if (!atLineEnd) continue;
    positions.push(at);
    if (closing) break;
  }
  return positions;
}

/**
 * Splits a multipart body on its boundary. Captured bodies are
 * attacker-controlled, so this never throws: a body that does not contain the
 * boundary, or contains no parseable part, returns undefined.
 */
export function parseMultipart(
  bytes: Buffer,
  boundary: string,
): MultipartParseResult | undefined {
  if (boundary === "") return undefined;
  const delimiter = Buffer.from(`--${boundary}`, "utf8");

  const positions = delimiterPositions(bytes, delimiter);
  if (positions.length < 2) return undefined;

  const parts: MultipartPart[] = [];
  let skipped = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    // The region between this delimiter line's CRLF and the CRLF that
    // belongs to the next delimiter.
    let start = positions[i]! + delimiter.length;
    if (bytes[start] === CR && bytes[start + 1] === LF) start += 2;
    let end = positions[i + 1]!;
    if (bytes[end - 2] === CR && bytes[end - 1] === LF) end -= 2;
    if (end < start) {
      skipped += 1;
      continue;
    }
    const region = bytes.subarray(start, end);

    // Headers end at the empty line. A region that begins with CRLF has an
    // empty header block — legal, and must be kept.
    let headerBytes: Buffer;
    let bodyStart: number;
    if (region[0] === CR && region[1] === LF) {
      headerBytes = region.subarray(0, 0);
      bodyStart = 2;
    } else {
      const headersEnd = region.indexOf(CRLF_CRLF);
      if (headersEnd === -1) {
        skipped += 1;
        continue;
      }
      headerBytes = region.subarray(0, headersEnd);
      bodyStart = headersEnd + CRLF_CRLF.length;
    }

    const headers: [string, string][] = [];
    for (const line of headerBytes.toString("utf8").split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      headers.push([
        line.slice(0, colon).trim().toLowerCase(),
        line.slice(colon + 1).trim(),
      ]);
    }
    const header = (name: string) => headers.find(([key]) => key === name)?.[1];
    const parameters = parseParameters(header("content-disposition") ?? "");

    parts.push({
      name: parameters["name"],
      filename: parameters["filename"],
      contentType: header("content-type"),
      headers,
      headerBytes,
      bytes: region.subarray(bodyStart),
    });
  }

  return parts.length > 0 ? { parts, skipped } : undefined;
}
