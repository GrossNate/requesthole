import Database from "better-sqlite3";

// Addresses are random (crc32 of a v4 UUID), so collisions are rare but real —
// the birthday bound puts them in reach at scale. Both address columns carry a
// UNIQUE constraint; this retries the insert with a fresh address when one
// collides, and rethrows anything that isn't a unique-constraint violation.
export default function insertWithUniqueAddress<T>(
  generate: () => string,
  insert: (address: string) => T,
  maxAttempts = 5,
): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return insert(generate());
    } catch (error) {
      const isCollision =
        error instanceof Database.SqliteError &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE";
      if (isCollision && attempt < maxAttempts) {
        continue;
      }
      throw error;
    }
  }
}
