/**
 * A parsed `content-type` value. Dispatching on these fields is what lets the
 * body viewer treat `application/vnd.api+json; charset=utf-8` as JSON — the
 * substring matching this parser replaces used to send vendor subtypes to a
 * blank panel.
 */
export interface MediaType {
  type: string;
  subtype: string;
  /** The structured-syntax suffix, e.g. `json` in `application/vnd.api+json`. */
  suffix: string | undefined;
  /** Parameter names and values, lowercased names, quotes stripped. */
  parameters: Record<string, string>;
}

/**
 * Parses a `content-type` header into type, subtype, structured suffix, and
 * parameters. Captured requests are attacker-controlled, so this never throws:
 * anything that is not `type/subtype…` returns undefined and the caller falls
 * back to the binary/unknown rendering.
 */
export function parseMediaType(
  header: string | null | undefined,
): MediaType | undefined {
  if (!header) return undefined;

  const [essence] = header.split(";", 1);
  const slash = essence.indexOf("/");
  if (slash === -1) return undefined;

  const type = essence.slice(0, slash).trim().toLowerCase();
  const subtype = essence
    .slice(slash + 1)
    .trim()
    .toLowerCase();
  if (type === "" || subtype === "") return undefined;

  const plus = subtype.lastIndexOf("+");
  const suffix =
    plus === -1 || plus === subtype.length - 1
      ? undefined
      : subtype.slice(plus + 1);

  return { type, subtype, suffix, parameters: parseParameters(header) };
}

/**
 * The `name=value` parameters of a header whose value is a token followed by
 * `;`-separated parameters — content-type, content-disposition. Names are
 * lowercased. Quotes around values are delimiters, not content: they are
 * stripped, a quoted value may contain `;` and `\"`-escaped quotes (RFC
 * 2046), and only unquoted values are whitespace-trimmed.
 */
export function parseParameters(header: string): Record<string, string> {
  const parameters: Record<string, string> = {};
  let at = header.indexOf(";");
  if (at === -1) return parameters;
  at += 1;

  while (at < header.length) {
    const equals = header.indexOf("=", at);
    if (equals === -1) break;
    const semicolon = header.indexOf(";", at);
    // A valueless token (`; flag; a=1`) — skip it, don't let its `;` be
    // swallowed into the next parameter's name.
    if (semicolon !== -1 && semicolon < equals) {
      at = semicolon + 1;
      continue;
    }
    const name = header.slice(at, equals).trim().toLowerCase();

    let value: string;
    let i = equals + 1;
    while (i < header.length && header[i] === " ") i += 1;
    if (header[i] === '"') {
      value = "";
      i += 1;
      while (i < header.length && header[i] !== '"') {
        if (header[i] === "\\" && i + 1 < header.length) i += 1;
        value += header[i];
        i += 1;
      }
      i += 1;
      while (i < header.length && header[i] !== ";") i += 1;
    } else {
      const end = header.indexOf(";", i);
      value = header.slice(i, end === -1 ? header.length : end).trim();
      i = end === -1 ? header.length : end;
    }

    if (name !== "") parameters[name] = value;
    at = i + 1;
  }
  return parameters;
}

/** The rendering families the body viewer dispatches between. */
export type BodyFamily =
  | "json"
  | "ndjson"
  | "xml"
  | "yaml"
  | "javascript"
  | "html"
  | "text"
  | "form"
  | "multipart"
  | "image"
  | "binary";

const NDJSON_SUBTYPES = new Set(["ndjson", "x-ndjson", "jsonl", "x-jsonlines"]);
const YAML_SUBTYPES = new Set(["yaml", "x-yaml"]);
const JAVASCRIPT_SUBTYPES = new Set([
  "javascript",
  "x-javascript",
  "ecmascript",
]);

/**
 * Maps a parsed media type to its rendering family. Matching is on the parsed
 * subtype and structured suffix — never substrings of the raw header — so
 * `application/vnd.api+json` is JSON and `application/octet-stream` is not
 * accidentally anything. Unknown and unparseable types are "binary": they get
 * size, preview, and a download rather than an empty panel.
 */
export function classifyBody(media: MediaType | undefined): BodyFamily {
  if (media === undefined) return "binary";
  const { type, subtype, suffix } = media;

  if (type === "image") return "image";
  if (type === "application" && subtype === "x-www-form-urlencoded")
    return "form";
  if (type === "multipart" && subtype === "form-data") return "multipart";
  if (NDJSON_SUBTYPES.has(subtype)) return "ndjson";
  if (subtype === "json" || suffix === "json") return "json";
  if (subtype === "xml" || suffix === "xml") return "xml";
  if (YAML_SUBTYPES.has(subtype) || suffix === "yaml") return "yaml";
  if (JAVASCRIPT_SUBTYPES.has(subtype)) return "javascript";
  if (subtype === "html") return "html";
  if (type === "text") return "text";
  return "binary";
}
