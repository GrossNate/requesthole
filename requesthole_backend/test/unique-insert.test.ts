import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import insertWithUniqueAddress from "../src/utils/unique-insert";

function uniqueViolation() {
  return new Database.SqliteError(
    "UNIQUE constraint failed: holes.hole_address",
    "SQLITE_CONSTRAINT_UNIQUE",
  );
}

describe("insertWithUniqueAddress", () => {
  it("returns the insert result on the first non-colliding address", () => {
    const generate = vi.fn(() => "aaaaaa");
    const insert = vi.fn((address: string) => `row:${address}`);

    expect(insertWithUniqueAddress(generate, insert)).toBe("row:aaaaaa");
    expect(generate).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
  });

  it("retries with a fresh address when the insert hits a unique collision", () => {
    const addresses = ["dupada", "freshx"];
    const generate = vi.fn(() => addresses.shift()!);
    const insert = vi.fn((address: string) => {
      if (address === "dupada") {
        throw uniqueViolation();
      }
      return `row:${address}`;
    });

    expect(insertWithUniqueAddress(generate, insert)).toBe("row:freshx");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget of persistent collisions", () => {
    const generate = vi.fn(() => "always");
    const insert = vi.fn(() => {
      throw uniqueViolation();
    });

    expect(() => insertWithUniqueAddress(generate, insert, 3)).toThrow(
      Database.SqliteError,
    );
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("propagates a non-unique error without retrying", () => {
    const generate = vi.fn(() => "aaaaaa");
    const insert = vi.fn(() => {
      throw new Database.SqliteError("no such table", "SQLITE_ERROR");
    });

    expect(() => insertWithUniqueAddress(generate, insert)).toThrow(
      "no such table",
    );
    expect(insert).toHaveBeenCalledOnce();
  });
});
