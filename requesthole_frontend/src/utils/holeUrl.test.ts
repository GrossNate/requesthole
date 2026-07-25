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

  it("never returns a bare path", () => {
    expect(holeCaptureUrl("abc123", "", "http://localhost:5173")).not.toMatch(
      /^\//,
    );
  });
});
