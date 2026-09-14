/**
 * The media gate's description of dropped content, as the backend stores it
 * in `body_dropped` (task 0008). Names, filenames and types are
 * sender-controlled text: they are only ever rendered as React text.
 */

interface DropDetail {
  reason: string;
  bytes: number;
  contentType: string | null;
  contentEncoding?: string;
  signature?: string;
}

export interface WholeBodyDrop extends DropDetail {
  kind: "whole";
}

export interface PartDrop extends DropDetail {
  /** The part's position in the form, counting from 0. */
  index: number;
  name: string | null;
  filename: string | null;
}

export interface PartsDrop {
  kind: "parts";
  parts: PartDrop[];
}

export type BodyDropped = WholeBodyDrop | PartsDrop;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : null;

function readDetail(value: Record<string, unknown>): DropDetail | undefined {
  if (typeof value["reason"] !== "string") return undefined;
  if (typeof value["bytes"] !== "number") return undefined;
  const detail: DropDetail = {
    reason: value["reason"],
    bytes: value["bytes"],
    contentType: optionalString(value["contentType"]),
  };
  if (typeof value["contentEncoding"] === "string") {
    detail.contentEncoding = value["contentEncoding"];
  }
  if (typeof value["signature"] === "string") {
    detail.signature = value["signature"];
  }
  return detail;
}

/**
 * Reads the stored JSON text. Anything unreadable counts as nothing dropped:
 * the backend wrote it, so garbage here is a bug, not an attack, and the body
 * itself is still fetched and shown (or withheld) on its own terms.
 */
export function parseBodyDropped(
  text: string | null | undefined,
): BodyDropped | undefined {
  if (!text) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  if ("parts" in value) {
    if (!Array.isArray(value["parts"])) return undefined;
    const parts: PartDrop[] = [];
    for (const entry of value["parts"] as unknown[]) {
      if (!isRecord(entry) || typeof entry["index"] !== "number") continue;
      const detail = readDetail(entry);
      if (detail === undefined) continue;
      parts.push({
        index: entry["index"],
        name: optionalString(entry["name"]),
        filename: optionalString(entry["filename"]),
        ...detail,
      });
    }
    return parts.length > 0 ? { kind: "parts", parts } : undefined;
  }

  const detail = readDetail(value);
  return detail === undefined ? undefined : { kind: "whole", ...detail };
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The backend's signature names, as a reader would say them. */
const SIGNATURE_LABELS: Record<string, string> = {
  pdf: "a PDF document",
  postscript: "a PostScript document",
  rtf: "an RTF document",
  svg: "an SVG image",
  xpm: "an XPM image",
  xbm: "an XBM image",
  netpbm: "a Netpbm image",
  vcard: "a vCard with a photo",
  uuencode: "uuencoded data",
  mime: "a MIME message",
};

const PREFIX = "Media/binary data dropped";

function describeDetail(detail: DropDetail, encodedWhat: string): string {
  const pieces: string[] = [];
  switch (detail.reason) {
    case "encoding":
      pieces.push(
        detail.contentEncoding
          ? `compressed body (${detail.contentEncoding})`
          : encodedWhat,
      );
      break;
    case "signature":
      pieces.push(
        `looks like ${SIGNATURE_LABELS[detail.signature ?? ""] ?? detail.signature ?? "a file"}`,
      );
      break;
    case "bytes":
      pieces.push("not plain text");
      break;
    case "malformed":
      pieces.push("unreadable content-type");
      break;
  }
  pieces.push(formatByteCount(detail.bytes));
  pieces.push(detail.contentType ?? "no content-type");
  return `${PREFIX}: ${pieces.join(", ")}`;
}

/** The notice for a whole dropped body. */
export function describeDrop(dropped: WholeBodyDrop): string {
  return describeDetail(dropped, "encoded body");
}

/** The notice shown in a dropped part's place. */
export function describePartDrop(part: PartDrop): string {
  return describeDetail(part, "encoded part");
}

/** One line for the request list's marker. */
export function summarizeDrop(dropped: BodyDropped): string {
  if (dropped.kind === "whole") return describeDrop(dropped);
  const { parts } = dropped;
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  const count = `${parts.length} ${parts.length === 1 ? "part" : "parts"}`;
  const types = [
    ...new Set(parts.map((part) => part.contentType ?? "no content-type")),
  ];
  return `${PREFIX} from ${count}: ${[formatByteCount(total), ...types].join(", ")}`;
}
