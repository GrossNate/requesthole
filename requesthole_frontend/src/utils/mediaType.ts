/**
 * A parsed `content-type` value. Dispatching on these fields is what lets the
 * body viewer treat `application/vnd.api+json; charset=utf-8` as JSON — the
 * substring matching this replaces sent vendor subtypes to a blank panel.
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
  const subtype = essence.slice(slash + 1).trim().toLowerCase();
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
 * lowercased; quotes around values are delimiters, not content, and are
 * stripped.
 */
export function parseParameters(header: string): Record<string, string> {
  const parameters: Record<string, string> = {};
  for (const segment of header.split(";").slice(1)) {
    const equals = segment.indexOf("=");
    if (equals === -1) continue;
    const name = segment.slice(0, equals).trim().toLowerCase();
    let value = segment.slice(equals + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (name !== "") parameters[name] = value;
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
