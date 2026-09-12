import { describe, it, expect } from "vitest";
import loadConfig from "../src/config";

describe("loadConfig", () => {
  it("applies the documented defaults when nothing is set", () => {
    expect(loadConfig({}, {})).toEqual({
      retentionDays: 7,
      maxRequestsPerHole: 100,
      holeCreateRateLimit: 10,
      captureRateLimit: 60,
      maxHoles: 1000,
      maxBodyBytes: 1048576,
    });
  });

  it("reads each knob from the environment", () => {
    expect(
      loadConfig(
        {},
        {
          RETENTION_DAYS: "3",
          MAX_REQUESTS_PER_HOLE: "5",
          HOLE_CREATE_RATE_LIMIT: "2",
          CAPTURE_RATE_LIMIT: "9",
          MAX_HOLES: "42",
          MAX_BODY_BYTES: "2048",
        },
      ),
    ).toEqual({
      retentionDays: 3,
      maxRequestsPerHole: 5,
      holeCreateRateLimit: 2,
      captureRateLimit: 9,
      maxHoles: 42,
      maxBodyBytes: 2048,
    });
  });

  it("lets explicit overrides win over the environment", () => {
    expect(loadConfig({ maxHoles: 1 }, { MAX_HOLES: "42" }).maxHoles).toBe(1);
  });

  it("fails fast on a value too large to hold exactly", () => {
    expect(() => loadConfig({}, { MAX_HOLES: "9".repeat(400) })).toThrow(
      "MAX_HOLES",
    );
    expect(() =>
      loadConfig({}, { MAX_HOLES: String(Number.MAX_SAFE_INTEGER + 1) }),
    ).toThrow("MAX_HOLES");
  });

  it.each([
    ["maxHoles", 0],
    ["maxBodyBytes", -1],
    ["captureRateLimit", 1.5],
    ["retentionDays", Number.NaN],
  ])("fails fast on a nonsense %s override too", (key, value) => {
    expect(() => loadConfig({ [key]: value }, {})).toThrow(key);
  });

  it.each([
    ["RETENTION_DAYS", "0"],
    ["MAX_REQUESTS_PER_HOLE", "-1"],
    ["HOLE_CREATE_RATE_LIMIT", "abc"],
    ["CAPTURE_RATE_LIMIT", "1.5"],
    ["MAX_HOLES", ""],
    ["MAX_BODY_BYTES", "1e3"],
  ])("fails fast on a nonsense %s", (name, value) => {
    expect(() => loadConfig({}, { [name]: value })).toThrow(name);
  });
});
