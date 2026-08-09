import { describe, it, expect } from "vitest";
import { classifyBody, parseMediaType } from "./mediaType";

describe("parseMediaType", () => {
  it("parses a bare type/subtype", () => {
    expect(parseMediaType("application/json")).toEqual({
      type: "application",
      subtype: "json",
      suffix: undefined,
      parameters: {},
    });
  });

  // GitHub-style webhooks send vendor subtypes like
  // application/vnd.foo.commithook+json — the suffix is the only reliable
  // signal that the body is JSON.
  it("extracts the structured-syntax suffix from a vendor subtype", () => {
    expect(parseMediaType("application/vnd.api+json")).toMatchObject({
      type: "application",
      subtype: "vnd.api+json",
      suffix: "json",
    });
  });

  // `application/json; charset=utf-8` is the common real-world form; the
  // charset drives text decoding and must not break subtype matching.
  it("parses parameters, lowercasing names, trimming values, keeping value case", () => {
    expect(parseMediaType("application/json; Charset= UTF-8 ")).toEqual({
      type: "application",
      subtype: "json",
      suffix: undefined,
      parameters: { charset: "UTF-8" },
    });
  });

  // A valueless token must be skipped whole — naively seeking the next `=`
  // would swallow its `;` into the following parameter's name and lose it.
  it("skips a valueless parameter token", () => {
    expect(
      parseMediaType("multipart/form-data; flag; boundary=B")?.parameters,
    ).toEqual({ boundary: "B" });
  });

  // RFC 2046 allows `;` and `\"`-escaped quotes inside a quoted value; a bare
  // split on `;` corrupts the boundary and every part-split misses.
  it("keeps semicolons and escaped quotes inside a quoted value intact", () => {
    expect(
      parseMediaType('multipart/form-data; boundary="a;b"')?.parameters,
    ).toEqual({ boundary: "a;b" });
    expect(
      parseMediaType('multipart/form-data; note="say \\"hi\\""; x=1')
        ?.parameters,
    ).toEqual({ note: 'say "hi"', x: "1" });
  });

  // Multipart boundaries are often quoted; the quotes are delimiters, not part
  // of the boundary, and keeping them would make part-splitting miss every part.
  it("strips quotes from a quoted parameter value", () => {
    expect(
      parseMediaType('multipart/form-data; boundary="----WebKitBoundary7MA4"'),
    ).toMatchObject({
      type: "multipart",
      subtype: "form-data",
      parameters: { boundary: "----WebKitBoundary7MA4" },
    });
  });

  // The header is attacker-controlled; junk must classify as unknown, never
  // throw or produce a half-parsed type.
  it("returns undefined for anything that is not type/subtype", () => {
    expect(parseMediaType(undefined)).toBeUndefined();
    expect(parseMediaType("")).toBeUndefined();
    expect(parseMediaType("gibberish")).toBeUndefined();
    expect(parseMediaType("/json")).toBeUndefined();
    expect(parseMediaType("text/")).toBeUndefined();
  });
});

describe("classifyBody", () => {
  const family = (header: string | undefined) =>
    classifyBody(parseMediaType(header));

  // Real-world webhook traffic: JSON dominant, vendor `+json` subtypes
  // common, form-encoded second, XML in use. The suffix rules are the point —
  // substring matching was what sent vendor subtypes to a blank panel.
  it("classifies JSON by subtype and by structured suffix", () => {
    expect(family("application/json")).toBe("json");
    expect(family("application/vnd.api+json; charset=utf-8")).toBe("json");
    expect(family("application/vnd.foo.commithook+json")).toBe("json");
  });

  it("classifies NDJSON separately so lines format independently", () => {
    expect(family("application/x-ndjson")).toBe("ndjson");
    expect(family("application/ndjson")).toBe("ndjson");
    expect(family("application/jsonl")).toBe("ndjson");
  });

  it("classifies XML by subtype and suffix, and YAML likewise", () => {
    expect(family("application/xml")).toBe("xml");
    expect(family("text/xml")).toBe("xml");
    expect(family("application/atom+xml")).toBe("xml");
    expect(family("application/yaml")).toBe("yaml");
    expect(family("application/x-yaml")).toBe("yaml");
    expect(family("text/yaml")).toBe("yaml");
  });

  it("classifies javascript for highlighting", () => {
    expect(family("application/javascript")).toBe("javascript");
    expect(family("text/javascript")).toBe("javascript");
  });

  // HTML gets its own family because it must be shown as source, never
  // rendered — the untrusted-body invariant.
  it("classifies HTML apart from other text", () => {
    expect(family("text/html")).toBe("html");
    expect(family("text/plain")).toBe("text");
    expect(family("text/csv")).toBe("text");
  });

  it("classifies forms, multipart, and images", () => {
    expect(family("application/x-www-form-urlencoded")).toBe("form");
    expect(family("multipart/form-data; boundary=B")).toBe("multipart");
    expect(family("image/png")).toBe("image");
  });

  // Anything unrecognized — including a missing or unparseable header — is
  // binary: size, preview, and a download, never an empty panel.
  it("classifies everything else, and no header at all, as binary", () => {
    expect(family("application/octet-stream")).toBe("binary");
    expect(family("application/pdf")).toBe("binary");
    expect(family("audio/mpeg")).toBe("binary");
    expect(family("gibberish")).toBe("binary");
    expect(family(undefined)).toBe("binary");
  });
});
