import { isUtf8 } from "node:buffer";
import { parseContentType, type ContentType } from "./media-type";
import { parseMultipart, type MultipartPart } from "./multipart";

/**
 * The media gate (task 0008). With `ALLOW_MEDIA` off, RequestHole is
 * text-only: this decides, for a captured body and its request headers, what
 * is stored and what description of dropped content is recorded. It runs at
 * capture and again at read time, so it is pure and never throws.
 */

export type DropReason =
  | "type"
  | "encoding"
  | "bytes"
  | "signature"
  | "malformed";

/** A whole body that was dropped. */
export interface BodyDrop {
  reason: DropReason;
  bytes: number;
  /** The declared content-type, or null when the request had none. */
  contentType: string | null;
  contentEncoding?: string;
  signature?: string;
}

/**
 * The request headers the filter reads, names lowercased. A header sent more
 * than once is an array (Node's `headersDistinct`).
 */
export type FilterHeaders = Record<string, string | string[] | undefined>;

/** One multipart part whose content was dropped; its headers are kept. */
export interface PartDrop {
  /** The part's position in the form, counting from 0. */
  index: number;
  name: string | null;
  filename: string | null;
  contentType: string | null;
  bytes: number;
  reason: DropReason;
  signature?: string;
}

/**
 * What the `requests.body_dropped` column holds, as JSON. Names, filenames
 * and types are sender-controlled text: data, rendered escaped.
 */
export type BodyDropped = BodyDrop | { parts: PartDrop[] };

export interface FilterResult {
  /** What to store: the body, or null when nothing is kept. */
  body: Buffer | null;
  /** A description of what was dropped, or null when nothing was. */
  dropped: BodyDropped | null;
}

/** A check's verdict on a declared type: allowed, or why not. */
type TypeVerdict =
  | { ok: true; media: ContentType }
  | { ok: false; reason: DropReason };

const BANNED_CHARSET = /^(?:utf-?7|utf-?16.*|utf-?32.*)$/;

/**
 * Step 1: the strict parse. A missing content-type is legitimate (Pub/Sub
 * unwrapped push omits it) and gated as text/plain.
 */
function checkContentType(values: string[]): TypeVerdict {
  if (values.length > 1) return { ok: false, reason: "malformed" };
  const [value] = values;
  const media =
    value === undefined
      ? parseContentType("text/plain")
      : parseContentType(value);
  if (media === undefined) return { ok: false, reason: "malformed" };
  const charset = media.parameters.get("charset");
  if (charset !== undefined && BANNED_CHARSET.test(charset.toLowerCase())) {
    return { ok: false, reason: "type" };
  }
  return { ok: true, media };
}

/** Text formats standard applications open with embedded images decoded. */
const EXCLUDED_TEXT_SUBTYPES = new Set([
  "rtf",
  "vcard",
  "x-vcard",
  "directory",
  "calendar",
  "uuencode",
  "x-uuencode",
]);

const ALLOWED_SUFFIXES = new Set([
  "json",
  "xml",
  "yaml",
  "csv",
  "jwt",
  "sd-jwt",
  "jws",
]);

/** `+xml` types that are media manifests rather than data. */
const EXCLUDED_APPLICATION_SUBTYPES = new Set(["smil+xml", "dash+xml"]);

const ALLOWED_APPLICATION_SUBTYPES = new Set([
  "json",
  "x-json",
  "x-www-form-urlencoded",
  "xml",
  "xml-dtd",
  "xml-external-parsed-entity",
  "ndjson",
  "x-ndjson",
  "jsonl",
  "jsonlines",
  "x-jsonlines",
  "yaml",
  "x-yaml",
  "toml",
  "x-toml",
  "javascript",
  "x-javascript",
  "ecmascript",
  "csp-report",
  "graphql",
  "sql",
  "csv",
  "jwt",
  "jose",
  "x-sh",
  "x-shellscript",
  "jsonpath",
  "sparql-query",
  "sparql-update",
  "n-triples",
  "n-quads",
  "trig",
  "x-amz-json-1.0",
  "x-amz-json-1.1",
]);

/**
 * Step 3: the declared-type allowlist. The top-level gate runs first, since
 * `video/lottie+json`, `model/gltf+json` and `image/svg+xml` would otherwise
 * match the suffix rules. `multipart/form-data` passes here and is filtered
 * part by part.
 */
function checkAllowedType({ type, subtype, suffix }: ContentType): boolean {
  switch (type) {
    case "text":
      return !EXCLUDED_TEXT_SUBTYPES.has(subtype);
    case "multipart":
      return subtype === "form-data";
    case "application":
      if (EXCLUDED_APPLICATION_SUBTYPES.has(subtype)) return false;
      if (suffix !== undefined && ALLOWED_SUFFIXES.has(suffix)) return true;
      return ALLOWED_APPLICATION_SUBTYPES.has(subtype);
    default:
      return false;
  }
}

/**
 * Step 4: strict UTF-8 (overlong forms, surrogates and truncated sequences
 * fail) with no C0 control except tab, LF, CR and form feed. DEL, C1
 * controls and a leading BOM are fine. In UTF-8 every byte below 0x80 is its
 * own character, so a byte scan finds the controls.
 */
function checkBytes(bytes: Buffer): boolean {
  if (!isUtf8(bytes)) return false;
  for (const byte of bytes) {
    if (
      byte < 0x20 &&
      byte !== 0x09 &&
      byte !== 0x0a &&
      byte !== 0x0c &&
      byte !== 0x0d
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Skips an XML prolog — declaration, processing instructions, comments, a
 * doctype with its internal subset, and whitespace — and returns what follows.
 * Not capped at a fixed size: a cap would let padding push `<svg` past it.
 */
function afterXmlProlog(text: string): string {
  let at = 0;
  for (;;) {
    while (at < text.length && /[ \t\r\n\f]/.test(text[at]!)) at += 1;
    if (text.startsWith("<?", at)) {
      const end = text.indexOf("?>", at + 2);
      if (end === -1) return "";
      at = end + 2;
    } else if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end === -1) return "";
      at = end + 3;
    } else if (text.slice(at, at + 9).toLowerCase() === "<!doctype") {
      let depth = 0;
      let end = at + 9;
      for (; end < text.length; end++) {
        const char = text[end];
        if (char === "[") depth += 1;
        else if (char === "]") depth -= 1;
        else if (char === ">" && depth <= 0) break;
      }
      if (end >= text.length) return "";
      at = end + 1;
    } else {
      return text.slice(at);
    }
  }
}

/**
 * Image and document formats that are pure ASCII and would pass steps 1–4
 * under text/plain. Anchored at the start (after an optional BOM and leading
 * whitespace) — scanning the body for `data:image/` would contradict the
 * accepted base64 limit and break real JSON.
 */
const SIGNATURES: [string, (start: string, whole: string) => boolean][] = [
  ["pdf", (start) => start.startsWith("%PDF-")],
  ["postscript", (start) => start.startsWith("%!PS")],
  ["rtf", (start) => start.startsWith("{\\rtf")],
  ["svg", (start) => /^<svg/i.test(afterXmlProlog(start))],
  ["xpm", (start) => start.startsWith("/* XPM */")],
  ["xbm", (start) => /^#define[ \t]+\S*_width[ \t]/.test(start)],
  ["netpbm", (start) => /^P[1-3]\s+(?:#[^\n]*\n\s*)*\d/.test(start)],
  [
    "vcard",
    (start, whole) =>
      /^BEGIN:VCARD/i.test(start) &&
      /^(?:[A-Za-z0-9-]+\.)?PHOTO[;:]/im.test(whole),
  ],
  ["uuencode", (start) => /^begin [0-7]{3}\s/.test(start)],
  ["mime", (start) => /^MIME-Version:/i.test(start)],
];

/** Step 5: the name of the format the body starts like, if any. */
function matchSignature(bytes: Buffer): string | undefined {
  const whole = bytes.toString("utf8");
  const start = whole.replace(/^\uFEFF?[ \t\r\n\f]*/, "");
  return SIGNATURES.find(([, matches]) => matches(start, whole))?.[0];
}

/** Codings named across every value of a comma-separated header. */
function codings(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== "");
}

/**
 * Step 2: compressed bodies are dropped, never decompressed — that would
 * invite decompression bombs for an edge case. Node decodes only `chunked`
 * transfer coding, so any other would leave the stored bytes compressed.
 * Returns the offending header value, or undefined when the body is plain.
 */
function checkEncodings(headers: FilterHeaders): string | undefined {
  const contentEncoding = valuesOf(headers["content-encoding"]);
  if (codings(contentEncoding).some((coding) => coding !== "identity")) {
    return contentEncoding.join(", ");
  }
  const transferEncoding = valuesOf(headers["transfer-encoding"]);
  if (codings(transferEncoding).some((coding) => coding !== "chunked")) {
    return transferEncoding.join(", ");
  }
  return undefined;
}

function valuesOf(header: string | string[] | undefined): string[] {
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

/** Why one body or part failed, and the detail its description carries. */
interface Failure {
  reason: DropReason;
  contentEncoding?: string;
  signature?: string;
}

/** Steps 4 and 5: the checks every kept byte must pass. */
function checkContent(bytes: Buffer): Failure | undefined {
  if (!checkBytes(bytes)) return { reason: "bytes" };
  const signature = matchSignature(bytes);
  return signature === undefined
    ? undefined
    : { reason: "signature", signature };
}

const CRLF = Buffer.from("\r\n");

/**
 * Step 6. Each part runs steps 1, 3, 4 and 5 against its own headers; a
 * dropped part keeps its headers and loses its content. The stored body is
 * rebuilt from the parts, so preamble and epilogue — which parsers ignore,
 * but which could hold arbitrary bytes — are never stored. Returns undefined
 * when the body cannot be parsed into parts, so the caller fails closed.
 */
function filterMultipart(
  body: Buffer,
  boundary: string | undefined,
): FilterResult | undefined {
  if (boundary === undefined) return undefined;
  const parsed = parseMultipart(body, boundary);
  if (parsed === undefined || parsed.skipped > 0) return undefined;
  // Header blocks are stored verbatim, so they must be text too.
  if (parsed.parts.some(({ headerBytes }) => !checkBytes(headerBytes))) {
    return undefined;
  }

  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const chunks: Buffer[] = [];
  const drops: PartDrop[] = [];
  parsed.parts.forEach((part, index) => {
    const failure = part.bytes.length === 0 ? undefined : checkPart(part);
    if (failure !== undefined) {
      const contentTypes = part.headers
        .filter(([name]) => name === "content-type")
        .map(([, value]) => value);
      drops.push({
        index,
        name: part.name ?? null,
        filename: part.filename ?? null,
        contentType: contentTypes.length > 0 ? contentTypes.join(", ") : null,
        bytes: part.bytes.length,
        ...failure,
      });
    }
    chunks.push(delimiter, CRLF);
    if (part.headerBytes.length > 0) chunks.push(part.headerBytes, CRLF);
    chunks.push(CRLF);
    if (failure === undefined) chunks.push(part.bytes);
    chunks.push(CRLF);
  });
  chunks.push(delimiter, Buffer.from("--\r\n"));

  return {
    body: Buffer.concat(chunks),
    dropped: drops.length > 0 ? { parts: drops } : null,
  };
}

/** Steps 1, 3, 4 and 5 for one part; no recursive multipart parsing. */
function checkPart(part: MultipartPart): Failure | undefined {
  const values = (name: string) =>
    part.headers.filter(([key]) => key === name).map(([, value]) => value);
  const verdict = checkContentType(values("content-type"));
  if (!verdict.ok) return { reason: verdict.reason };
  if (values("content-transfer-encoding").length > 0) {
    return { reason: "encoding" };
  }
  if (verdict.media.type === "multipart") return { reason: "type" };
  if (!checkAllowedType(verdict.media)) return { reason: "type" };
  return checkContent(part.bytes);
}

export function filterBody(
  body: Buffer | null | undefined,
  headers: FilterHeaders,
): FilterResult {
  // Nothing arrived, so nothing can be dropped.
  if (!body || body.length === 0) return { body: body ?? null, dropped: null };

  const contentTypes = valuesOf(headers["content-type"]);
  const drop = (failure: Failure): FilterResult => ({
    body: null,
    dropped: {
      reason: failure.reason,
      bytes: body.length,
      contentType: contentTypes.length > 0 ? contentTypes.join(", ") : null,
      ...(failure.contentEncoding === undefined
        ? {}
        : { contentEncoding: failure.contentEncoding }),
      ...(failure.signature === undefined
        ? {}
        : { signature: failure.signature }),
    },
  });

  const verdict = checkContentType(contentTypes);
  if (!verdict.ok) return drop({ reason: verdict.reason });
  const contentEncoding = checkEncodings(headers);
  if (contentEncoding !== undefined) {
    return drop({ reason: "encoding", contentEncoding });
  }
  const { media } = verdict;
  if (!checkAllowedType(media)) return drop({ reason: "type" });

  if (media.type === "multipart") {
    const result = filterMultipart(body, media.parameters.get("boundary"));
    if (result !== undefined) return result;
  }
  const failure = checkContent(body);
  return failure === undefined ? { body, dropped: null } : drop(failure);
}
