/**
 * A `multipart/form-data` body split into its parts. Parsing works on bytes,
 * not text — a file part can be an image or other binary content that a text
 * decode would corrupt.
 */
import { parseParameters } from "./mediaType";

export interface MultipartPart {
  /** The `name` from the part's content-disposition, if present. */
  name: string | undefined;
  /** The `filename` from the part's content-disposition, if present. */
  filename: string | undefined;
  /** The part's own `content-type` header value, if present. */
  contentType: string | undefined;
  bytes: Uint8Array;
}

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
 * Splits a multipart body on its boundary. Captured bodies are
 * attacker-controlled, so this never throws: a body that does not contain the
 * boundary, or contains no complete part, returns undefined and the caller
 * falls back to the binary/unknown rendering.
 */
export function parseMultipart(
  bytes: Uint8Array,
  boundary: string,
): MultipartPart[] | undefined {
  if (boundary === "") return undefined;
  const delimiter = new TextEncoder().encode(`--${boundary}`);

  // Collect delimiter positions; parts live between consecutive delimiters.
  const positions: number[] = [];
  for (
    let at = indexOfBytes(bytes, delimiter, 0);
    at !== -1;
    at = indexOfBytes(bytes, delimiter, at + delimiter.length)
  ) {
    positions.push(at);
  }
  if (positions.length < 2) return undefined;

  const parts: MultipartPart[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    // Skip the delimiter and the CRLF that ends its line.
    let start = positions[i] + delimiter.length;
    if (bytes[start] === 13 && bytes[start + 1] === 10) start += 2;
    // The part's content ends at the CRLF that precedes the next delimiter.
    let end = positions[i + 1];
    if (bytes[end - 2] === 13 && bytes[end - 1] === 10) end -= 2;
    if (end < start) continue;

    const headersEnd = indexOfBytes(bytes.subarray(start, end), CRLF_CRLF, 0);
    if (headersEnd === -1) continue;

    const headerText = new TextDecoder().decode(
      bytes.subarray(start, start + headersEnd),
    );
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
      bytes: bytes.subarray(start + headersEnd + CRLF_CRLF.length, end),
    });
  }

  return parts.length > 0 ? parts : undefined;
}
