/**
 * The `name=value` parameters of a header whose value is a token followed by
 * `;`-separated parameters — used here for a multipart part's
 * content-disposition, where only `name` and `filename` are read for display.
 * Names are lowercased. Quotes around values are delimiters, not content:
 * they are stripped, a quoted value may contain `;` and `\"`-escaped quotes
 * (RFC 2046), and only unquoted values are whitespace-trimmed. Lenient by
 * design; content types go through the strict `parseContentType` instead.
 *
 * Ported from the frontend (requesthole_frontend/src/utils/mediaType.ts).
 */
export function parseParameters(header: string): Record<string, string> {
  const parameters: Record<string, string> = {};
  let at = header.indexOf(";");
  if (at === -1) return parameters;
  at += 1;

  // The next `=` is found once and reused until `at` passes it: searching
  // afresh each turn is quadratic on a run of valueless `;` segments.
  let equals = -1;
  while (at < header.length) {
    if (equals < at) equals = header.indexOf("=", at);
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

/** A content-type that passed the strict parse. */
export interface ContentType {
  /** Lowercased. */
  type: string;
  /** Lowercased. */
  subtype: string;
  /** The structured-syntax suffix, e.g. `json` in `vnd.api+json`. */
  suffix: string | undefined;
  /** Lowercased names; values unquoted, case kept. */
  parameters: Map<string, string>;
}

const TCHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * A strict parse of one content-type value per RFC 9110's grammar:
 *
 *   media-type = type "/" subtype parameters
 *   parameters = *( OWS ";" OWS [ parameter ] )
 *   parameter  = token "=" ( token / quoted-string )
 *
 * Returns undefined on anything else — no slash, a non-token type or subtype,
 * trailing garbage (`text/plain, image/png`), a valueless parameter, a
 * wildcard, or the same parameter twice. Never throws.
 */
export function parseContentType(value: string): ContentType | undefined {
  // Index scans, not a trimming regex: `/^[ \t]+|[ \t]+$/` backtracks
  // quadratically on a long whitespace run, and multipart part headers put up
  // to MAX_BODY_BYTES of sender text here.
  let first = 0;
  let last = value.length;
  while (first < last && (value[first] === " " || value[first] === "\t")) {
    first += 1;
  }
  while (
    last > first &&
    (value[last - 1] === " " || value[last - 1] === "\t")
  ) {
    last -= 1;
  }
  const input = value.slice(first, last);
  let at = 0;
  const readToken = () => {
    const start = at;
    while (at < input.length && TCHAR.test(input[at]!)) at += 1;
    return input.slice(start, at);
  };
  const skipOws = () => {
    while (input[at] === " " || input[at] === "\t") at += 1;
  };

  const type = readToken().toLowerCase();
  if (type === "" || input[at] !== "/") return undefined;
  at += 1;
  const subtype = readToken().toLowerCase();
  if (subtype === "" || type === "*" || subtype === "*") return undefined;

  const parameters = new Map<string, string>();
  for (;;) {
    skipOws();
    if (at >= input.length) break;
    if (input[at] !== ";") return undefined;
    at += 1;
    skipOws();
    // An empty parameter (`;;` or a trailing `;`) is allowed by the grammar.
    if (at >= input.length || input[at] === ";") continue;

    const name = readToken().toLowerCase();
    if (name === "" || input[at] !== "=") return undefined;
    at += 1;
    let parameterValue: string;
    if (input[at] === '"') {
      at += 1;
      parameterValue = "";
      for (;;) {
        const char = input[at];
        if (char === undefined) return undefined;
        at += 1;
        if (char === '"') break;
        if (char === "\\") {
          const escaped = input[at];
          if (escaped === undefined || !isQuotedPairChar(escaped)) {
            return undefined;
          }
          parameterValue += escaped;
          at += 1;
        } else if (isQdtext(char)) {
          parameterValue += char;
        } else {
          return undefined;
        }
      }
    } else {
      parameterValue = readToken();
      if (!TOKEN.test(parameterValue)) return undefined;
    }
    if (parameters.has(name)) return undefined;
    parameters.set(name, parameterValue);
  }

  const plus = subtype.lastIndexOf("+");
  const suffix = plus === -1 ? undefined : subtype.slice(plus + 1);
  return { type, subtype, suffix, parameters };
}

// qdtext = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
function isQdtext(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code === 9 ||
    code === 32 ||
    code === 0x21 ||
    (code >= 0x23 && code <= 0x5b) ||
    (code >= 0x5d && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}

// quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text )
function isQuotedPairChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code === 9 ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}
