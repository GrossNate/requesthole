import { describe, it, expect } from "vitest";
import { prettyJson, prettyNdjson, prettyXml } from "./prettyPrint";

describe("prettyJson", () => {
  it("re-indents compact JSON", () => {
    expect(prettyJson('{"hello":"world","n":[1,2]}')).toBe(
      `{
  "hello": "world",
  "n": [
    1,
    2
  ]
}`,
    );
  });

  // Captured bodies are attacker-controlled; a body that claims JSON but is
  // not must fall back to raw display, never throw.
  it("returns undefined for malformed JSON", () => {
    expect(prettyJson('{"unclosed":')).toBeUndefined();
  });

  // An inspector must show what arrived. A JSON.parse/stringify round-trip
  // would render 9007199254740993 as ...992 (64-bit precision loss) —
  // formatting may only ever move whitespace, never rewrite values.
  it("preserves numbers beyond Number.MAX_SAFE_INTEGER verbatim", () => {
    expect(prettyJson('{"id":9007199254740993}')).toBe(
      `{
  "id": 9007199254740993
}`,
    );
  });

  // Duplicate keys are legal JSON syntax and a parse/stringify round-trip
  // silently drops all but the last — silent omission, in an inspector.
  it("keeps duplicate keys as sent", () => {
    expect(prettyJson('{"a":1,"a":2}')).toBe(
      `{
  "a": 1,
  "a": 2
}`,
    );
  });

  it("keeps empty objects and arrays compact, and escapes intact", () => {
    expect(prettyJson('{"a":{},"b":[],"c":"say \\"hi\\" {[,"}')).toBe(
      `{
  "a": {},
  "b": [],
  "c": "say \\"hi\\" {[,"
}`,
    );
  });
});

describe("prettyNdjson", () => {
  // NDJSON is one JSON document per line; formatting the whole body as one
  // document would fail, so each line is formatted on its own.
  it("formats each line as its own JSON document", () => {
    expect(prettyNdjson('{"a":1}\n{"b":2}\n')).toBe(
      `{
  "a": 1
}
{
  "b": 2
}`,
    );
  });

  it("returns undefined when any non-blank line is malformed", () => {
    expect(prettyNdjson('{"a":1}\nnot json')).toBeUndefined();
  });
});

describe("prettyXml", () => {
  // Shopify webhooks send single-line XML; unindented it is unreadable.
  it("indents nested elements one level per depth", () => {
    expect(prettyXml("<order><id>7</id><total>9.99</total></order>")).toBe(
      `<order>
  <id>7</id>
  <total>9.99</total>
</order>`,
    );
  });

  it("returns undefined for XML that does not parse", () => {
    expect(prettyXml("<order><unclosed></order>")).toBeUndefined();
    expect(prettyXml("plain text, no markup")).toBeUndefined();
  });

  // Formatting may only move whitespace between nodes — CDATA and comment
  // content is data and must survive byte-for-byte, not be re-indented.
  it("keeps CDATA content verbatim", () => {
    expect(prettyXml("<a><![CDATA[x >   < y]]></a>")).toBe(
      "<a><![CDATA[x >   < y]]></a>",
    );
  });

  it("keeps comment content verbatim and block-indents siblings correctly", () => {
    expect(prettyXml("<a><!-- x >   < y --><b>1</b></a>")).toBe(
      `<a>
  <!-- x >   < y -->
  <b>1</b>
</a>`,
    );
  });

  it("keeps attributes, escaping their values, and self-closes empty elements", () => {
    expect(prettyXml('<a href="x &amp; &quot;y&quot;"><b/></a>')).toBe(
      `<a href="x &amp; &quot;y&quot;">
  <b/>
</a>`,
    );
  });
});
