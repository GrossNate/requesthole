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

  // A 20 KB body of nested brackets — well under the display cap — indents
  // to a quadratically larger string and past ~60k levels the concatenation
  // throws RangeError. Formatting must refuse (raw fallback), never crash
  // the app.
  it("refuses pathologically deep nesting instead of blowing up", () => {
    const deep = "[".repeat(10_000) + "]".repeat(10_000);
    expect(prettyJson(deep)).toBeUndefined();
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

  // Block-formatting mixed content would trim the spaces around inline
  // elements — data, in an inspector. Mixed content stays inline verbatim.
  it("keeps mixed element/text content inline with its whitespace", () => {
    expect(prettyXml("<p>foo <b>bar</b> baz</p>")).toBe(
      "<p>foo <b>bar</b> baz</p>",
    );
  });

  // The declaration and the DOCTYPE's ids and internal subset are content —
  // the internal subset is exactly what someone inspecting a suspected-XXE
  // request needs to see.
  it("keeps the XML declaration and full DOCTYPE", () => {
    expect(
      prettyXml('<?xml version="1.0" encoding="utf-8"?><root a="1"/>'),
    ).toBe(
      `<?xml version="1.0" encoding="utf-8"?>
<root a="1"/>`,
    );
    expect(prettyXml('<!DOCTYPE foo [<!ENTITY x "y">]><root/>')).toBe(
      `<!DOCTYPE foo [<!ENTITY x "y">]>
<root/>`,
    );
  });

  it("keeps a processing instruction", () => {
    expect(
      prettyXml('<?xml-stylesheet href="s.xsl" type="text/xsl"?><root/>'),
    ).toBe(
      `<?xml-stylesheet href="s.xsl" type="text/xsl"?>
<root/>`,
    );
  });

  it("keeps a processing instruction inside mixed content", () => {
    expect(prettyXml("<p>foo <?pi data?> <b>bar</b> baz</p>")).toBe(
      "<p>foo <?pi data?> <b>bar</b> baz</p>",
    );
  });

  // The doctype is read by scanning the prolog, not by regex over the whole
  // body: a doctype-shaped string inside a comment must not shadow the real
  // one, and quoted literals may legally contain ">", "[", and "]>".
  it("is not fooled by a doctype-shaped string inside a prolog comment", () => {
    expect(prettyXml("<!-- <!DOCTYPE fake> --><!DOCTYPE real><r/>")).toBe(
      `<!-- <!DOCTYPE fake> -->
<!DOCTYPE real>
<r/>`,
    );
  });

  it("keeps doctypes whose quoted literals contain '>', '[', or ']>'", () => {
    expect(prettyXml('<!DOCTYPE r SYSTEM "a>b.dtd"><r/>')).toBe(
      `<!DOCTYPE r SYSTEM "a>b.dtd">
<r/>`,
    );
    expect(prettyXml('<!DOCTYPE r SYSTEM "weird[.dtd"><r/>')).toBe(
      `<!DOCTYPE r SYSTEM "weird[.dtd">
<r/>`,
    );
    expect(prettyXml('<!DOCTYPE r [<!ENTITY x "]>">]><r/>')).toBe(
      `<!DOCTYPE r [<!ENTITY x "]>">]>
<r/>`,
    );
  });

  // Same crash mode as JSON: recursion and quadratic indentation on deep
  // nesting must bail to raw display, never throw during render.
  //
  // 200 levels, not thousands: the bail is at MAX_FORMAT_DEPTH (100), so twice
  // that proves the behaviour just as well while the cost — jsdom's DOMParser
  // chewing through the document, which dwarfs the formatter's own work —
  // stays in milliseconds. The 30 KB version took seconds and failed as a
  // timeout under a loaded full-suite run, which is not this test's subject.
  it("refuses pathologically deep nesting instead of blowing up", () => {
    const deep = "<a>".repeat(200) + "</a>".repeat(200);
    expect(prettyXml(deep)).toBeUndefined();
  });

  // The other half of "pathological": size without depth. A body this shape is
  // formatted rather than refused — there is no depth to bail on — so this is
  // the case that actually walks 30 KB of document, and it is cheap because
  // the walk is shallow.
  it("formats a large flat document without blowing up", () => {
    const wide = `<r>${"<a>x</a>".repeat(5_000)}</r>`;
    const formatted = prettyXml(wide);
    expect(formatted).toContain("<a>x</a>");
    expect(formatted?.split("\n")).toHaveLength(5_002);
  });
});
