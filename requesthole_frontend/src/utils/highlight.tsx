import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import javascript from "highlight.js/lib/languages/javascript";
import type { ReactNode } from "react";

// Only the languages the body viewer dispatches to — importing the full
// highlight.js bundle would add every grammar to the app for no benefit.
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("javascript", javascript);

export type HighlightLanguage = "json" | "xml" | "yaml" | "javascript";

/**
 * Walks hljs's output and rebuilds it as React elements, admitting only the
 * token `<span>`s hljs itself produces; anything else is flattened to its
 * text. This is what upholds the untrusted-body invariant: body content is
 * only ever emitted as text children React escapes.
 */
function toReact(nodes: NodeListOf<ChildNode>): ReactNode[] {
  return Array.from(nodes, (node, index) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (node instanceof HTMLSpanElement) {
      return (
        <span key={index} className={node.getAttribute("class") ?? undefined}>
          {toReact(node.childNodes)}
        </span>
      );
    }
    return node.textContent;
  });
}

/**
 * Syntax-highlights `code` into React nodes. hljs's API returns an HTML
 * string meant to be injected as markup, which the security invariant forbids
 * — so the string (in which hljs has already escaped the source text) is
 * parsed inert via DOMParser and converted element-by-element instead. Never
 * throws: any failure falls back to the un-highlighted text.
 */
export function highlightCode(
  code: string,
  language: HighlightLanguage,
): ReactNode[] {
  try {
    const { value } = hljs.highlight(code, { language });
    const doc = new DOMParser().parseFromString(value, "text/html");
    return toReact(doc.body.childNodes);
  } catch {
    return [code];
  }
}
