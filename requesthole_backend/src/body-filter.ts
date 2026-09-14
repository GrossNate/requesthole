import { isUtf8 } from "node:buffer";
import { parseContentType, type ContentType } from "./media-type";
import { parseMultipart, type MultipartPart } from "./multipart";

/**
 * The media gate (task 0008). With `ALLOW_MEDIA` off, RequestHole is
 * text-only: this decides, for a captured body and its request headers, what
 * is stored and what description of dropped content is recorded. It runs at
 * capture, and at read time for rows it has not already checked, so it is
 * pure and never throws.
 */

/**
 * Why content was dropped. `malformed` is a content-type that does not parse;
 * `form` is a multipart form whose body does not parse into parts.
 */
/**
 * The gate's version, stored in `requests.body_checked` for a body it kept.
 * Bump it whenever the gate catches something it used to let through: rows
 * marked by an older version are checked again when they are read.
 */
export const GATE_VERSION = 2;

export type DropReason =
  | "type"
  | "encoding"
  | "bytes"
  | "signature"
  | "malformed"
  | "form";

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
 * Whether a declared charset would make a decoder read the bytes as something
 * other than the UTF-8 the byte check verified. Besides the names above, the
 * viewer's TextDecoder knows WHATWG aliases such as `ucs-2` and `unicode` as
 * UTF-16, so labels are resolved the way it resolves them. A label it does not
 * know falls back to UTF-8 there, so it is harmless here.
 */
function isBannedCharset(label: string): boolean {
  const key = label.toLowerCase();
  if (BANNED_CHARSET.test(key)) return true;
  // Memoised: a form of thousands of parts with an unknown label would
  // otherwise build, and throw from, a TextDecoder for every part.
  const known = charsetVerdicts.get(key);
  if (known !== undefined) return known;
  let banned = false;
  try {
    const { encoding } = new TextDecoder(label);
    banned = encoding === "utf-16le" || encoding === "utf-16be";
  } catch {
    banned = false;
  }
  if (charsetVerdicts.size >= 256) charsetVerdicts.clear();
  charsetVerdicts.set(key, banned);
  return banned;
}

const charsetVerdicts = new Map<string, boolean>();

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
  if (charset !== undefined && isBannedCharset(charset)) {
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
      const end = doctypeEnd(text, at + 9);
      if (end === -1) return "";
      at = end;
    } else {
      return text.slice(at);
    }
  }
}

/**
 * Where a doctype that starts at `from` ends, or -1. Quoted literals, and
 * comments and processing instructions in the internal subset, may hold `>`
 * and `]` without ending anything, so they are skipped whole.
 */
function doctypeEnd(text: string, from: number): number {
  let inSubset = false;
  let at = from;
  while (at < text.length) {
    const char = text[at]!;
    if (char === '"' || char === "'") {
      const close = text.indexOf(char, at + 1);
      if (close === -1) return -1;
      at = close + 1;
    } else if (inSubset && text.startsWith("<!--", at)) {
      const close = text.indexOf("-->", at + 4);
      if (close === -1) return -1;
      at = close + 3;
    } else if (inSubset && text.startsWith("<?", at)) {
      const close = text.indexOf("?>", at + 2);
      if (close === -1) return -1;
      at = close + 2;
    } else {
      if (char === "[") inSubset = true;
      else if (char === "]") inSubset = false;
      else if (char === ">" && !inSubset) return at + 1;
      at += 1;
    }
  }
  return -1;
}

/** The first element is `svg`, with or without a (possibly non-ASCII) prefix. */
const SVG_ROOT = /^<(?:[^\s:>/]+:)?svg(?![\p{L}\p{N}_.:-])/iu;

/** Whether any line of `text` starts (after blanks) with `marker`. */
function lineStartsWith(text: string, marker: string): boolean {
  let at = text.indexOf(marker);
  while (at !== -1) {
    let before = at - 1;
    while (before >= 0 && /[ \t\f]/.test(text[before]!)) before -= 1;
    if (
      before < 0 ||
      text[before] === "\n" ||
      text[before] === "\r" ||
      text[before] === "\uFEFF"
    ) {
      return true;
    }
    at = text.indexOf(marker, at + marker.length);
  }
  return false;
}

/** A line in `text` starts (after blanks) with a PostScript header. */
function startsPostScriptLine(text: string): boolean {
  return /(?:^\uFEFF?|[\r\n])[ \t\f]*%!(?:PS|[ \t\r\n]|$)/.test(text);
}

/**
 * Image and document formats that are pure ASCII and would pass steps 1–4
 * under text/plain. Anchored at the start (after an optional BOM and leading
 * whitespace), except PDF and PostScript, which count at the start of any
 * line in the first 1024 bytes, and a raw email's MIME-Version, which counts
 * anywhere in its leading header block. Scanning the whole body for
 * `data:image/` would contradict the accepted base64 limit and break
 * legitimate JSON.
 */
const SIGNATURES: [string, (start: string, whole: string) => boolean][] = [
  // Readers look for these headers through the first 1024 bytes, so a
  // leading line must not hide them; only a line start counts, so text that
  // mentions one mid-line is kept.
  ["pdf", (_, whole) => lineStartsWith(whole.slice(0, 1024), "%PDF-")],
  // `%!` then PS, whitespace or the line's end is PostScript to libmagic,
  // shared-mime-info and printers; Go's `%!v(MISSING)` and `%!TEX` are not.
  ["postscript", (_, whole) => startsPostScriptLine(whole.slice(0, 1024))],
  ["rtf", (start) => start.startsWith("{\\rtf")],
  ["svg", (start) => SVG_ROOT.test(afterXmlProlog(start))],
  ["xpm", (start) => start.startsWith("/* XPM */")],
  ["xbm", (start) => /^#define[ \t]+\S*_width[ \t]/.test(start)],
  // P1–P6 then whitespace or comments (ended by CR or LF) before the width,
  // or the width straight after the magic when a height follows; P7 (PAM)
  // then a header keyword; PFM (PF, Pf) and half-float maps (PH, Ph) then
  // their dimensions. Prose like "P500 errors" or "P7 is" is kept.
  [
    "netpbm",
    (start) =>
      /^P[1-6](?:[ \t\r\n\f\v]|#[^\r\n]*[\r\n])+\d/.test(start) ||
      /^P[1-6]\d+[ \t\r\n\f\v]+\d/.test(start) ||
      /^P7\s+(?:#[^\r\n]*[\r\n]\s*)*(?:WIDTH|HEIGHT|DEPTH|MAXVAL|TUPLTYPE|ENDHDR)\b/.test(
        start,
      ) ||
      /^P[FfHh]\s+\d+\s+\d+/.test(start),
  ],
  // FITS: 80-column ASCII cards, the first always SIMPLE = T.
  ["fits", (start) => /^SIMPLE {2}=\s+T/.test(start)],
  // VICAR opens with its label size (or the old NJPL1I label).
  ["vicar", (start) => /^(?:LBLSIZE=|NJPL1I)/.test(start)],
  // ImageMagick's text format lists every pixel after this banner.
  [
    "imagemagick-txt",
    (start) => /^# ImageMagick pixel enumeration:/i.test(start),
  ],
  [
    "vcard",
    (start, whole) =>
      /^BEGIN:VCARD/i.test(start) &&
      // Unfolded first: a property may be folded right after its name.
      /^(?:[A-Za-z0-9-]+\.)?(?:PHOTO|LOGO|SOUND)[;:]/im.test(
        whole.replace(/\r?\n[ \t]/g, ""),
      ),
  ],
  ["uuencode", (start) => /^begin [0-7]{3}\s/.test(start)],
  // A raw email usually opens with Received:, From: or Date:, so any line of
  // the leading header block (up to the first blank line) counts.
  [
    "mime",
    (start) => /^MIME-Version:/im.test(start.split(/\r?\n\r?\n/, 1)[0]!),
  ],
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
 * but which could hold arbitrary bytes — are never stored. Returns a failure
 * when the body cannot be parsed into parts, so the caller drops it whole.
 */
function filterMultipart(
  body: Buffer,
  boundary: string | undefined,
): FilterResult | Failure {
  // RFC 2046 caps a boundary at 70 characters. A longer one makes every
  // delimiter search cost its length, over up to MAX_BODY_BYTES of body.
  // RFC 2046 bchars only: a boundary is written verbatim into every
  // delimiter line, so `%PDF-` or `%!` there would reach storage.
  if (boundary === undefined || !BOUNDARY.test(boundary)) {
    return { reason: "form" };
  }
  const parsed = parseMultipart(body, boundary);
  // An unclosed body would lose its tail in the rebuild, and a skipped region
  // is content no part check saw.
  if (parsed === undefined || parsed.skipped > 0 || !parsed.closed) {
    return { reason: "form" };
  }
  // Header blocks are stored verbatim, so they must be text, and headers.
  for (const { headerBytes } of parsed.parts) {
    if (!checkBytes(headerBytes) || !isHeaderBlock(headerBytes)) {
      return { reason: "form" };
    }
    // A reader finds a PDF or PostScript header anywhere in the first 1 KB,
    // and nothing legitimate puts one in a part header.
    const headerText = headerBytes.toString("utf8");
    if (headerText.includes("%PDF-")) {
      return { reason: "signature", signature: "pdf" };
    }
    if (headerText.includes("%!")) {
      return { reason: "signature", signature: "postscript" };
    }
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

/**
 * RFC 2046: 1–70 of digits, letters and '()+_,-./:=?, or space, never last.
 * The length cap also bounds every delimiter search's cost.
 */
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/;

const FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Every line is `name: value`, with no bare CR or LF inside a line. */
function isHeaderBlock(headerBytes: Buffer): boolean {
  if (headerBytes.length === 0) return true;
  return headerBytes
    .toString("utf8")
    .split("\r\n")
    .every((line) => {
      if (/[\r\n]/.test(line)) return false;
      const colon = line.indexOf(":");
      return colon > 0 && FIELD_NAME.test(line.slice(0, colon));
    });
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

  // A form that cannot be parsed into parts is dropped whole: whole-body
  // checks cannot see an SVG or an encoded part inside it.
  if (media.type === "multipart") {
    const result = filterMultipart(body, media.parameters.get("boundary"));
    return "reason" in result ? drop(result) : result;
  }
  const failure = checkContent(body);
  return failure === undefined ? { body, dropped: null } : drop(failure);
}
