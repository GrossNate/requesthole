import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Scoped to this file: stub the address generator so we can force a genuine
// UNIQUE collision through the public POST /api/hole path and prove the route
// recovers — the unit test in unique-insert.test.ts covers the helper in
// isolation, this covers the real DB constraint + route wiring end-to-end.
vi.mock("../src/utils/address-generator", () => ({
  default: vi.fn(),
  ADDRESS_LENGTH: 6,
}));

import buildApp from "../src/app";
import generateAddress from "../src/utils/address-generator";
import type { FastifyInstance } from "fastify";

const mockedGenerate = vi.mocked(generateAddress);

describe("POST /api/hole collision retry", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockedGenerate.mockReset();
    app = buildApp({ databasePath: ":memory:" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("recovers from a real address collision and still returns 201", async () => {
    mockedGenerate.mockReturnValueOnce("AAAAAA");
    const first = await app.inject({ method: "POST", url: "/api/hole" });
    expect(first.statusCode).toBe(201);

    // The generator hands out the already-taken "AAAAAA" first (a DB UNIQUE
    // collision), then a fresh "BBBBBB"; the route must retry and succeed.
    mockedGenerate
      .mockReturnValueOnce("AAAAAA")
      .mockReturnValueOnce("BBBBBB");
    const second = await app.inject({ method: "POST", url: "/api/hole" });

    expect(second.statusCode).toBe(201);
    const rows = second.json<{ hole_address: string }[]>();
    expect(rows[0]?.hole_address).toBe("BBBBBB");
    // 1 call for the first hole, 2 for the second (collision + fresh).
    expect(mockedGenerate).toHaveBeenCalledTimes(3);
  });
});
