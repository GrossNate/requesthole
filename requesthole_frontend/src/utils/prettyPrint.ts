/**
 * Pretty-printers for the structured-text body families. Each returns the
 * formatted text, or undefined when the input does not parse — captured bodies
 * are attacker-controlled, so none of these ever throw; the caller falls back
 * to showing the raw text with a note.
 */

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
  return reindentJson(text);
}

/** Re-indents valid JSON by moving whitespace between tokens, nothing else. */
function reindentJson(text: string): string {
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

  // Walk the parsed DOM rather than regex-splitting a serialized string:
  // formatting may only move whitespace between nodes, and a text split
  // would rewrite the inside of CDATA sections and comments — which is
  // data, and must survive verbatim.
  return Array.from(doc.childNodes)
    .map((node) => serializeXmlNode(node, 0))
    .filter((line) => line !== "")
    .join("\n");
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

function serializeXmlNode(node: Node, depth: number): string {
  const pad = "  ".repeat(depth);
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const element = node as Element;
      const children = Array.from(element.childNodes).filter(
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
