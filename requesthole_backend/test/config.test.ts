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
      maxHolesPerIp: 20,
      maxBodyBytes: 1048576,
      allowMedia: false,
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
          MAX_HOLES_PER_IP: "4",
          MAX_BODY_BYTES: "2048",
          ALLOW_MEDIA: "true",
        },
      ),
    ).toEqual({
      retentionDays: 3,
      maxRequestsPerHole: 5,
      holeCreateRateLimit: 2,
      captureRateLimit: 9,
      maxHoles: 42,
      maxHolesPerIp: 4,
      maxBodyBytes: 2048,
      allowMedia: true,
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

  describe("ALLOW_MEDIA", () => {
    it.each([
      ["true", true],
      ["TRUE", true],
      ["True", true],
      ["1", true],
      ["false", false],
      ["FALSE", false],
      ["fAlSe", false],
      ["0", false],
    ])("reads %s as %s", (raw, expected) => {
      expect(loadConfig({}, { ALLOW_MEDIA: raw }).allowMedia).toBe(expected);
    });

    it.each(["yes", "on", "no", "off", "", " true", "2"])(
      "refuses to start on %j",
      (raw) => {
        expect(() => loadConfig({}, { ALLOW_MEDIA: raw })).toThrow(
          "ALLOW_MEDIA",
        );
      },
    );

    it("lets the override win over the environment", () => {
      expect(
        loadConfig({ allowMedia: true }, { ALLOW_MEDIA: "false" }).allowMedia,
      ).toBe(true);
      expect(
        loadConfig({ allowMedia: false }, { ALLOW_MEDIA: "true" }).allowMedia,
      ).toBe(false);
    });

    it("validates the override", () => {
      expect(() =>
        loadConfig({ allowMedia: "true" as unknown as boolean }, {}),
      ).toThrow("allowMedia");
    });
  });
});
