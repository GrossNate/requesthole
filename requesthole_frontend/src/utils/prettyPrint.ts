/**
 * Pretty-printers for the structured-text body families. Each returns the
 * formatted text, or undefined when the input does not parse — captured bodies
 * are attacker-controlled, so none of these ever throw; the caller falls back
 * to showing the raw text with a note.
 */

export function prettyJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return undefined;
  }
}

export function prettyXml(text: string): string | undefined {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return undefined;

  // Re-serialize through the platform so entities and CDATA stay faithful,
  // then split between adjacent tags and indent by nesting depth.
  const serialized = new XMLSerializer().serializeToString(doc);
  const lines = serialized.replace(/>\s*</g, ">\n<").split("\n");

  let depth = 0;
  const indented: string[] = [];
  for (const line of lines) {
    const isClosing = line.startsWith("</");
    const isSelfContained =
      /^<[^/!?][^>]*>[\s\S]*<\/[^>]+>$/.test(line) || // <id>7</id>
      line.endsWith("/>") ||
      /^<[!?]/.test(line); // declaration, comment, doctype
    if (isClosing) depth = Math.max(0, depth - 1);
    indented.push("  ".repeat(depth) + line);
    if (line.startsWith("<") && !isClosing && !isSelfContained) depth += 1;
  }
  return indented.join("\n");
}

export function prettyNdjson(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return undefined;

  const formatted = lines.map(prettyJson);
  if (formatted.some((line) => line === undefined)) return undefined;
  return formatted.join("\n");
}
