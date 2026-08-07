/**
 * Renders a stored ISO-8601 `created` value as `YYYY-MM-DD HH:MM:SS` in the
 * viewer's own time zone. Anything unparseable is shown verbatim rather than
 * as "Invalid Date".
 */
export function formatTimestamp(
  isoTimestamp: string | null | undefined,
  timeZone?: string,
): string {
  if (!isoTimestamp) return "";

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

/**
 * Renders the stored `query_params` JSON text as a single readable line.
 *
 * Captured requests are attacker-controlled, so this never throws: unparseable
 * text is shown verbatim rather than blowing up the list it appears in.
 * Returns "" when there is nothing to show, leaving the placeholder to the
 * caller.
 */
export function formatQueryParams(
  queryParamsJson: string | null | undefined,
): string {
  if (!queryParamsJson) return "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(queryParamsJson);
  } catch {
    return queryParamsJson;
  }
  // A querystring always parses to an object of pairs. An array or a scalar is
  // not a parameter set, so it is shown as it was stored.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return queryParamsJson;
  }

  const render = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(render).join(", ");
    if (typeof value === "object" && value !== null)
      return JSON.stringify(value);
    return String(value);
  };

  return Object.entries(parsed as Record<string, unknown>)
    .map(([key, value]) => `${key}=${render(value)}`)
    .join(" · ");
}
