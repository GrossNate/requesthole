import { describe, it, expect } from "vitest";
import { formatQueryParams, formatTimestamp } from "./format";

describe("formatTimestamp", () => {
  // The backend sends ISO-8601 text. Raw, it is unreadable in a dense table.
  it("renders an ISO timestamp as a readable date and time", () => {
    expect(formatTimestamp("2026-07-25T14:03:22.145Z", "UTC")).toBe(
      "2026-07-25 14:03:22",
    );
  });

  it("returns the raw value when it is not a parseable date", () => {
    expect(formatTimestamp("whenever", "UTC")).toBe("whenever");
    expect(formatTimestamp(undefined, "UTC")).toBe("");
  });
});

describe("formatQueryParams", () => {
  // The backend stores JSON.stringify(request.query), so the column receives
  // JSON text and has to parse it before anything readable comes out.
  it("renders each parameter as key=value", () => {
    expect(formatQueryParams('{"probe":"1","flavor":"vanilla"}')).toBe(
      "probe=1 · flavor=vanilla",
    );
  });

  it("renders a repeated parameter's values together", () => {
    expect(formatQueryParams('{"tag":["a","b"]}')).toBe("tag=a, b");
  });

  it("returns an empty string when there are no parameters", () => {
    expect(formatQueryParams("{}")).toBe("");
    expect(formatQueryParams("")).toBe("");
  });

  // query_params is nullable in the schema, and a captured request is
  // attacker-controlled — malformed text must not take the list down.
  it("falls back to the raw text when it is not parseable JSON", () => {
    expect(formatQueryParams("not json")).toBe("not json");
    expect(formatQueryParams(null)).toBe("");
  });

  // A querystring always parses to an object of pairs. Anything else is not a
  // parameter set, so inventing index keys for it would misrepresent it.
  it("falls back to the raw text for JSON that is not an object of pairs", () => {
    expect(formatQueryParams('["x","y"]')).toBe('["x","y"]');
    expect(formatQueryParams("42")).toBe("42");
  });

  it("renders a structured value as JSON rather than [object Object]", () => {
    expect(formatQueryParams('{"a":{"b":1}}')).toBe('a={"b":1}');
  });
});
