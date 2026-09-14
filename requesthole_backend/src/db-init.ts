import Database from "better-sqlite3";

export default function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS holes (
      hole_id INTEGER PRIMARY KEY,
      hole_address TEXT NOT NULL UNIQUE,
      created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      -- The creating client, normalized as the rate limiter keys it. Counts
      -- each client's live holes against MAX_HOLES_PER_IP; never returned by
      -- any route, and swept with the hole.
      creator_ip TEXT
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
      body BLOB,
      -- JSON describing content the media gate dropped (ALLOW_MEDIA off);
      -- NULL when nothing was.
      body_dropped TEXT,
      -- The gate version (GATE_VERSION) that kept this body, so reads of the
      -- current version need not run it again; NULL for rows captured with
      -- media on. Older versions are checked again on read.
      body_checked INTEGER
    );

    -- SQLite does not index foreign keys on its own. The insert-time trim and
    -- the retention sweep both filter requests by hole, and the cascade on
    -- hole delete walks this column too.
    CREATE INDEX IF NOT EXISTS idx_requests_hole_id ON requests (hole_id);
  `);

  // `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a database
  // from before the per-client share has no creator column. Its old holes
  // stay NULL and count against nobody's share.
  const holeColumns = db.prepare("PRAGMA table_info(holes)").all() as {
    name: string;
  }[];
  if (!holeColumns.some((column) => column.name === "creator_ip")) {
    db.exec("ALTER TABLE holes ADD COLUMN creator_ip TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_holes_creator_ip ON holes (creator_ip)",
  );

  // Likewise for a database from before the media gate: its old requests
  // stay NULL, which reads as nothing dropped.
  const requestColumns = db.prepare("PRAGMA table_info(requests)").all() as {
    name: string;
  }[];
  if (!requestColumns.some((column) => column.name === "body_dropped")) {
    db.exec("ALTER TABLE requests ADD COLUMN body_dropped TEXT");
  }
  if (!requestColumns.some((column) => column.name === "body_checked")) {
    db.exec("ALTER TABLE requests ADD COLUMN body_checked INTEGER");
  }
}
