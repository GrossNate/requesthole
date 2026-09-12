/**
 * Operator knobs. Every one is an optional environment variable with a
 * documented default (see the README's Configuration table). Explicit
 * overrides beat the environment, mirroring how `databasePath` is threaded
 * into the db plugin, so tests can set a knob without touching `process.env`.
 * Nonsense values throw at startup rather than degrading into an unbounded
 * deploy.
 */
export interface Config {
  /** Holes older than this many days are swept, requests and all. */
  retentionDays: number;
  /** Per-hole cap on stored requests; the oldest are evicted at insert time. */
  maxRequestsPerHole: number;
  /** Hole creations allowed per client IP per hour. */
  holeCreateRateLimit: number;
  /** Captures allowed per client IP per minute. */
  captureRateLimit: number;
  /** Total holes; creation is refused (never evicted) at the ceiling. */
  maxHoles: number;
  /** Request bodies above this many bytes are rejected with 413. */
  maxBodyBytes: number;
}

export type ConfigOverrides = Partial<Config>;

const KNOBS: { key: keyof Config; env: string; fallback: number }[] = [
  { key: "retentionDays", env: "RETENTION_DAYS", fallback: 7 },
  { key: "maxRequestsPerHole", env: "MAX_REQUESTS_PER_HOLE", fallback: 100 },
  { key: "holeCreateRateLimit", env: "HOLE_CREATE_RATE_LIMIT", fallback: 10 },
  { key: "captureRateLimit", env: "CAPTURE_RATE_LIMIT", fallback: 60 },
  { key: "maxHoles", env: "MAX_HOLES", fallback: 1000 },
  { key: "maxBodyBytes", env: "MAX_BODY_BYTES", fallback: 1048576 },
];

function parsePositiveInteger(name: string, raw: string): number {
  // A strict decimal-digit match: Number() would accept "1e3", " 5", "0x10"
  // and "", none of which an operator means.
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw);
}

export default function loadConfig(
  overrides: ConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const config = {} as Config;
  for (const { key, env: name, fallback } of KNOBS) {
    const override = overrides[key];
    if (override !== undefined) {
      // Overrides get the same check as the environment: a test or embedder
      // passing 0 or a negative would otherwise reach SQL LIMIT/OFFSET and the
      // limiter unvalidated.
      if (!Number.isInteger(override) || override < 1) {
        throw new Error(
          `${key} must be a positive integer, got ${String(override)}`,
        );
      }
      config[key] = override;
      continue;
    }
    const raw = env[name];
    config[key] =
      raw === undefined ? fallback : parsePositiveInteger(name, raw);
  }
  return config;
}
