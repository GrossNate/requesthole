import Database from "better-sqlite3";

export default function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS holes (
      hole_id INTEGER PRIMARY KEY,
      hole_address TEXT NOT NULL UNIQUE,
      created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS requests (
      request_id INTEGER PRIMARY KEY,
      request_address TEXT NOT NULL UNIQUE,
      hole_id INTEGER NOT NULL REFERENCES holes (hole_id) ON DELETE CASCADE,
      created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      method TEXT NOT NULL,
      request_path TEXT NOT NULL,
      query_params TEXT,
      headers TEXT,
      body BLOB
    );

    -- SQLite does not index foreign keys on its own. The insert-time trim and
    -- the retention sweep both filter requests by hole, and the cascade on
    -- hole delete walks this column too.
    CREATE INDEX IF NOT EXISTS idx_requests_hole_id ON requests (hole_id);
  `);
}
