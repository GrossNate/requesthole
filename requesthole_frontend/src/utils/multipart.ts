import { parseParameters } from "./mediaType";

/**
 * A `multipart/form-data` body split into its parts. Parsing works on bytes,
 * not text — a file part can be an image or other binary content that a text
 * decode would corrupt.
 */
export interface MultipartPart {
  /** The `name` from the part's content-disposition, if present. */
  name: string | undefined;
  /** The `filename` from the part's content-disposition, if present. */
  filename: string | undefined;
  /** The part's own `content-type` header value, if present. */
  contentType: string | undefined;
  bytes: Uint8Array;
}

export interface MultipartParseResult {
  parts: MultipartPart[];
  /**
   * Regions between delimiters that could not be parsed as a part. Surfaced
   * so the viewer can say so — an inspector must never silently omit content.
   */
  skipped: number;
}

const CR = 13;
const LF = 10;
const CRLF_CRLF = [13, 10, 13, 10];

/** Index of `pattern` in `bytes` at or after `from`, or -1. */
function indexOfBytes(
  bytes: Uint8Array,
  pattern: ArrayLike<number>,
  from: number,
): number {
  outer: for (let i = from; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Positions where `--boundary` is a real delimiter per RFC 2046: at the very
 * start of the body or preceded by CRLF, and followed (after optional linear
 * whitespace) by CRLF, the closing `--`, or end of input. A bare
 * `--boundary` in the middle of a content line is legal part content and
 * must not split the part.
 */
function delimiterPositions(
  bytes: Uint8Array,
  delimiter: Uint8Array,
): number[] {
  const positions: number[] = [];
  for (
    let at = indexOfBytes(bytes, delimiter, 0);
    at !== -1;
    at = indexOfBytes(bytes, delimiter, at + delimiter.length)
  ) {
    if (at !== 0 && !(bytes[at - 2] === CR && bytes[at - 1] === LF)) continue;

    let after = at + delimiter.length;
    if (bytes[after] === 45 && bytes[after + 1] === 45) after += 2; // closing --
    while (bytes[after] === 32 || bytes[after] === 9) after += 1;
    const atLineEnd =
      after >= bytes.length || (bytes[after] === CR && bytes[after + 1] === LF);
    if (atLineEnd) positions.push(at);
  }
  return positions;
}

/**
 * Splits a multipart body on its boundary. Captured bodies are
 * attacker-controlled, so this never throws: a body that does not contain the
 * boundary, or contains no parseable part, returns undefined and the caller
 * falls back to raw display.
 */
export function parseMultipart(
  bytes: Uint8Array,
  boundary: string,
): MultipartParseResult | undefined {
  if (boundary === "") return undefined;
  const delimiter = new TextEncoder().encode(`--${boundary}`);

  const positions = delimiterPositions(bytes, delimiter);
  if (positions.length < 2) return undefined;

  const parts: MultipartPart[] = [];
  let skipped = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    // The region between this delimiter line's CRLF and the CRLF that
    // belongs to the next delimiter.
    let start = positions[i] + delimiter.length;
    if (bytes[start] === CR && bytes[start + 1] === LF) start += 2;
    let end = positions[i + 1];
    if (bytes[end - 2] === CR && bytes[end - 1] === LF) end -= 2;
    if (end < start) {
      skipped += 1;
      continue;
    }
    const region = bytes.subarray(start, end);

    // Headers end at the empty line. A region that begins with CRLF has an
    // empty header block — legal, and must be kept.
    let headerText: string;
    let bodyStart: number;
    if (region[0] === CR && region[1] === LF) {
      headerText = "";
      bodyStart = 2;
    } else {
      const headersEnd = indexOfBytes(region, CRLF_CRLF, 0);
      if (headersEnd === -1) {
        skipped += 1;
        continue;
      }
      headerText = new TextDecoder().decode(region.subarray(0, headersEnd));
      bodyStart = headersEnd + CRLF_CRLF.length;
    }

    const headers = new Map<string, string>();
    for (const line of headerText.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      headers.set(
        line.slice(0, colon).trim().toLowerCase(),
        line.slice(colon + 1).trim(),
      );
    }
    const parameters = parseParameters(
      headers.get("content-disposition") ?? "",
    );

    parts.push({
      name: parameters["name"],
      filename: parameters["filename"],
      contentType: headers.get("content-type"),
      bytes: region.subarray(bodyStart),
    });
  }

  return parts.length > 0 ? { parts, skipped } : undefined;
}
