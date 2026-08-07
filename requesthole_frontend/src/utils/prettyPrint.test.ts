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
});
