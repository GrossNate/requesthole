/**
 * Pretty-printers for the structured-text body families. Each returns the
 * formatted text, or undefined when the input does not parse — captured bodies
 * are attacker-controlled, so none of these ever throw; the caller falls back
 * to showing the raw text with a note.
 */

/**
 * Nesting deeper than this refuses to format (raw fallback) rather than
 * blow up: indentation grows quadratically with depth, and a 20 KB body of
 * nested brackets — far under the display cap — would otherwise produce a
 * hundreds-of-megabytes string or throw mid-render.
 */
const MAX_FORMAT_DEPTH = 100;

export function prettyJson(text: string): string | undefined {
  // Parse only to validate. The output is built by re-indenting the original
  // tokens, never by re-serializing the parsed value: a parse/stringify
  // round-trip silently rewrites what an inspector must show verbatim —
  // numbers past 2^53 lose precision and duplicate keys collapse.
  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }
  try {
    return reindentJson(text);
  } catch {
    return undefined;
  }
}

/**
 * Re-indents valid JSON by moving whitespace between tokens, nothing else.
 * Returns undefined past MAX_FORMAT_DEPTH.
 */
function reindentJson(text: string): string | undefined {
  let out = "";
  let depth = 0;
  let i = 0;
  const skipWhitespace = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i += 1;
  };
  const indent = () => "  ".repeat(depth);

  skipWhitespace();
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += text.slice(start, i);
    } else if (c === "{" || c === "[") {
      const closer = c === "{" ? "}" : "]";
      i += 1;
      skipWhitespace();
      if (text[i] === closer) {
        i += 1;
        out += c + closer;
      } else {
        depth += 1;
        if (depth > MAX_FORMAT_DEPTH) return undefined;
        out += `${c}\n${indent()}`;
        continue;
      }
    } else if (c === "}" || c === "]") {
      depth -= 1;
      out += `\n${indent()}${c}`;
      i += 1;
    } else if (c === ",") {
      out += `,\n${indent()}`;
      i += 1;
    } else if (c === ":") {
      out += ": ";
      i += 1;
    } else {
      // A number, true, false, or null — copied verbatim.
      const start = i;
      while (i < text.length && !',{}[]": \t\n\r'.includes(text[i])) i += 1;
      out += text.slice(start, i);
    }
    skipWhitespace();
  }
  return out;
}

export function prettyXml(text: string): string | undefined {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return undefined;

  // The XML declaration never reaches the DOM, and the DOM's DocumentType
  // drops the internal subset — exactly what someone inspecting a
  // suspected-XXE request needs to see — so both are carried over from the
  // source text verbatim. The declaration can only sit at the very start;
  // the doctype is found by scanning the prolog (see extractDoctype).
  const declaration = text.match(/^\s*(<\?xml\s[\s\S]*?\?>)/)?.[1];
  const doctypeSource = extractDoctype(text);

  // Walk the parsed DOM rather than regex-splitting a serialized string:
  // formatting may only move whitespace between nodes, and a text split
  // would rewrite the inside of CDATA sections and comments — which is
  // data, and must survive verbatim. The walk throws past MAX_FORMAT_DEPTH
  // (see reindentJson's rationale); that bails to the raw fallback.
  try {
    const lines = Array.from(doc.childNodes)
      .map((node) =>
        node.nodeType === Node.DOCUMENT_TYPE_NODE
          ? (doctypeSource ?? `<!DOCTYPE ${(node as DocumentType).name}>`)
          : serializeXmlNode(node, 0),
      )
      .filter((line) => line !== "");
    if (declaration) lines.unshift(declaration);
    return lines.join("\n");
  } catch {
    return undefined;
  }
}

/**
 * The DOCTYPE declaration from the document prolog, verbatim from source.
 * This scans rather than regex-matches the body: a doctype-shaped string
 * inside a prolog comment must not shadow the real one, and quoted literals
 * may legally contain ">", "[", and "]>", which no single regex survives.
 */
function extractDoctype(text: string): string | undefined {
  let i = 0;
  while (i < text.length) {
    while (i < text.length && " \t\r\n".includes(text[i])) i += 1;
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i);
      if (end === -1) return undefined;
      i = end + 2;
    } else if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      if (end === -1) return undefined;
      i = end + 3;
    } else if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) {
      return scanDoctype(text, i);
    } else {
      // The root element (or anything else): no doctype in the prolog.
      return undefined;
    }
  }
  return undefined;
}

/** Scans one DOCTYPE declaration, honoring quotes and the internal subset. */
function scanDoctype(text: string, start: number): string | undefined {
  let quote: string | undefined;
  let inSubset = false;
  for (let i = start + "<!DOCTYPE".length; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (inSubset && text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      if (end === -1) return undefined;
      i = end + 2;
    } else if (c === "[") {
      inSubset = true;
    } else if (c === "]") {
      inSubset = false;
    } else if (c === ">" && !inSubset) {
      return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function openXmlTag(element: Element): string {
  const attributes = Array.from(element.attributes)
    .map((attr) => ` ${attr.name}="${escapeXmlAttribute(attr.value)}"`)
    .join("");
  return `<${element.tagName}${attributes}`;
}

/**
 * Serializes a node with no reformatting at all — used for mixed
 * element/text content, where the whitespace around inline elements is data
 * that block indentation would rewrite.
 */
function serializeXmlInline(node: Node, depth: number): string {
  if (depth > MAX_FORMAT_DEPTH) throw new RangeError("nesting too deep");
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const element = node as Element;
      if (element.childNodes.length === 0) return `${openXmlTag(element)}/>`;
      const content = Array.from(element.childNodes)
        .map((child) => serializeXmlInline(child, depth + 1))
        .join("");
      return `${openXmlTag(element)}>${content}</${element.tagName}>`;
    }
    case Node.TEXT_NODE:
      return escapeXmlText(node.nodeValue ?? "");
    case Node.CDATA_SECTION_NODE:
      return `<![CDATA[${node.nodeValue ?? ""}]]>`;
    case Node.COMMENT_NODE:
      return `<!--${node.nodeValue ?? ""}-->`;
    case Node.PROCESSING_INSTRUCTION_NODE: {
      const instruction = node as ProcessingInstruction;
      return `<?${instruction.target} ${instruction.data}?>`;
    }
    default:
      // A node type this walk doesn't know must never be silently elided —
      // bail to the raw fallback instead.
      throw new RangeError("unserializable node type");
  }
}

function serializeXmlNode(node: Node, depth: number): string {
  if (depth > MAX_FORMAT_DEPTH) throw new RangeError("nesting too deep");
  const pad = "  ".repeat(depth);
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const element = node as Element;
      const allChildren = Array.from(element.childNodes);
      const children = allChildren.filter(
        (child) =>
          !(
            child.nodeType === Node.TEXT_NODE &&
            (child.nodeValue ?? "").trim() === ""
          ),
      );
      if (children.length === 0) return `${pad}${openXmlTag(element)}/>`;

      // Pure text/CDATA content stays on one line, verbatim — indenting it
      // would inject whitespace into the data.
      const isInline = children.every(
        (child) =>
          child.nodeType === Node.TEXT_NODE ||
          child.nodeType === Node.CDATA_SECTION_NODE,
      );
      if (isInline) {
        const content = children
          .map((child) =>
            child.nodeType === Node.CDATA_SECTION_NODE
              ? `<![CDATA[${child.nodeValue ?? ""}]]>`
              : escapeXmlText(child.nodeValue ?? ""),
          )
          .join("");
        return `${pad}${openXmlTag(element)}>${content}</${element.tagName}>`;
      }

      // Mixed element/text content is kept inline verbatim (unfiltered
      // children): block-formatting it would trim the spaces around inline
      // elements, which is data.
      const isMixed =
        children.some((child) => child.nodeType === Node.ELEMENT_NODE) &&
        children.some((child) => child.nodeType === Node.TEXT_NODE);
      if (isMixed) {
        const content = allChildren
          .map((child) => serializeXmlInline(child, depth + 1))
          .join("");
        return `${pad}${openXmlTag(element)}>${content}</${element.tagName}>`;
      }

      const body = children
        .map((child) => serializeXmlNode(child, depth + 1))
        .join("\n");
      return `${pad}${openXmlTag(element)}>\n${body}\n${pad}</${element.tagName}>`;
    }
    case Node.TEXT_NODE:
      return `${pad}${escapeXmlText((node.nodeValue ?? "").trim())}`;
    case Node.CDATA_SECTION_NODE:
      return `${pad}<![CDATA[${node.nodeValue ?? ""}]]>`;
    case Node.COMMENT_NODE:
      return `${pad}<!--${node.nodeValue ?? ""}-->`;
    case Node.PROCESSING_INSTRUCTION_NODE: {
      const instruction = node as ProcessingInstruction;
      return `${pad}<?${instruction.target} ${instruction.data}?>`;
    }
    case Node.DOCUMENT_TYPE_NODE:
      return `${pad}<!DOCTYPE ${(node as DocumentType).name}>`;
    default:
      return "";
  }
}

export function prettyNdjson(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return undefined;

  const formatted = lines.map(prettyJson);
  if (formatted.some((line) => line === undefined)) return undefined;
  return formatted.join("\n");
}
