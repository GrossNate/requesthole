import { useEffect, useMemo, useState } from "react";
import holeService from "../services";
import EmptyState from "./EmptyState";
import { classifyBody, parseMediaType } from "../utils/mediaType";
import { hexPreview } from "../utils/hexPreview";
import { parseMultipart, type MultipartPart } from "../utils/multipart";
import { prettyJson, prettyNdjson, prettyXml } from "../utils/prettyPrint";
import { highlightCode, type HighlightLanguage } from "../utils/highlight";

/**
 * How much of a body the viewer will render as DOM text. Pretty-printing a
 * megabyte of JSON into DOM nodes is what freezes a tab; past this the viewer
 * shows a truncated prefix and offers the whole body as a download.
 */
export const DISPLAY_CAP_BYTES = 256 * 1024;

/**
 * The byte cap alone doesn't bound the DOM — a 256 KB body of tiny form
 * pairs or multipart parts is tens of thousands of rows. Row counts are
 * capped separately.
 */
export const MAX_RENDERED_ROWS = 1000;

/**
 * Raster image subtypes safe to hand to an <img> via a blob URL. SVG is
 * deliberately absent: an SVG document can run script, and a blob: URL
 * inherits this origin — see useOwnedBlobUrl.
 */
const RASTER_IMAGE_SUBTYPES = new Set([
  "png",
  "jpeg",
  "jpg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "x-icon",
  "vnd.microsoft.icon",
]);

/**
 * An object URL for bytes the app already holds, revoked on cleanup. Built
 * synchronously from fetched state, so there is no async race to guard.
 *
 * Always typed application/octet-stream, never a captured content-type: a
 * blob: URL inherits this origin, so an attacker-typed image/svg+xml blob
 * would render as a script-capable same-origin document if the user opened
 * it in a tab. Raster <img> rendering survives via content sniffing;
 * downloads don't care.
 */
function useOwnedBlobUrl(
  bytes: Uint8Array,
  enabled = true,
): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    // The cast bridges a TS lib gap: Uint8Array's generic ArrayBufferLike
    // backing isn't assignable to BlobPart, though Blob accepts it at runtime.
    const objectUrl = URL.createObjectURL(
      new Blob([bytes as unknown as BlobPart], {
        type: "application/octet-stream",
      }),
    );
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [bytes, enabled]);

  return url;
}

const DownloadLink = ({
  url,
  filename,
}: {
  url: string | undefined;
  filename: string;
}) => (
  <div>
    <a
      className={`btn btn-sm btn-outline btn-primary ${url ? "" : "btn-disabled"}`}
      href={url}
      download={filename}
    >
      Download body
    </a>
  </div>
);

export const BodySection = ({ children }: { children: React.ReactNode }) => (
  <section className="gap-tight flex flex-col">
    <h2 className="section-label">Body</h2>
    {children}
  </section>
);

const CodeBlock = ({
  text,
  language,
}: {
  text: string;
  language?: HighlightLanguage;
}) => {
  // Tokenizing up to 256 KB is too expensive to re-run per render.
  const children = useMemo(
    () => (language ? highlightCode(text, language) : text),
    [text, language],
  );
  return (
    <pre className="address border-base-300 bg-base-200/50 px-gutter py-snug rounded-box border break-all whitespace-pre-wrap">
      {children}
    </pre>
  );
};

/**
 * Decodes body bytes per the content-type's charset parameter, defaulting to
 * UTF-8. The charset is attacker-controlled, so an unknown label falls back
 * to UTF-8 rather than throwing.
 */
function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder();
  }
  return decoder.decode(bytes);
}

/**
 * The content-aware body viewer: fetches the captured bytes once per request
 * address and dispatches on the parsed media type. Captured bodies are
 * attacker-controlled — every path renders them as React text children (or an
 * inert <img>/download); nothing here may ever emit them as markup.
 */
const RequestBody = ({
  requestAddress,
  contentType,
}: {
  requestAddress: string;
  contentType: string | undefined;
}) => {
  const media = parseMediaType(contentType);
  const family = classifyBody(media);
  const charset = media?.parameters["charset"];

  const [bytes, setBytes] = useState<Uint8Array>();
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    if (family === "image") return;
    let current = true;
    setBytes(undefined);
    setFailed(false);

    holeService
      .getBodyBytes(requestAddress)
      .then((buffer) => {
        if (current) setBytes(new Uint8Array(buffer));
      })
      .catch((error) => {
        console.error(error);
        if (current) setFailed(true);
      });

    return () => {
      current = false;
    };
  }, [requestAddress, family]);

  if (family === "image") {
    // A bare broken-image glyph explains nothing; every other family has an
    // explicit state for an empty, wrong, or unloadable body.
    return (
      <BodySection>
        {imageFailed ? (
          <EmptyState
            compact
            title="Couldn't display this image"
            description="The body may be empty, not actually an image, or the backend may be down."
          />
        ) : (
          <img
            alt="Captured request body"
            className="border-base-300 rounded-box max-w-full border"
            src={`${holeService.BASE_URL}/api/request/${requestAddress}/body`}
            onError={() => setImageFailed(true)}
          />
        )}
      </BodySection>
    );
  }

  if (failed) {
    return (
      <BodySection>
        <EmptyState
          compact
          title="Couldn't load this body"
          description="The backend didn't answer. Check that it's running, then reload."
        />
      </BodySection>
    );
  }

  if (bytes === undefined) return null;

  if (bytes.byteLength === 0) {
    return (
      <BodySection>
        <EmptyState
          compact
          title="Empty body"
          description="This request arrived without a body."
        />
      </BodySection>
    );
  }

  // Binary bodies keep their hex-preview rendering whatever their size, and
  // multipart bodies cap per part — only text-rendered families go through
  // the whole-body truncation path.
  if (family === "binary") {
    return (
      <BinaryBody
        bytes={bytes}
        requestAddress={requestAddress}
        subtype={media?.subtype}
      />
    );
  }

  if (family === "multipart") {
    return (
      <MultipartBody
        bytes={bytes}
        boundary={media?.parameters["boundary"] ?? ""}
        charset={charset}
        requestAddress={requestAddress}
      />
    );
  }

  if (bytes.byteLength > DISPLAY_CAP_BYTES) {
    return (
      <TruncatedBody
        bytes={bytes}
        charset={charset}
        requestAddress={requestAddress}
      />
    );
  }

  const text = decodeBytes(bytes, charset);

  switch (family) {
    case "json":
      return (
        <StructuredTextBody
          text={text}
          format={prettyJson}
          claimed="JSON"
          language="json"
        />
      );
    case "ndjson":
      return (
        <StructuredTextBody
          text={text}
          format={prettyNdjson}
          claimed="NDJSON"
          language="json"
        />
      );
    case "xml":
      return (
        <StructuredTextBody
          text={text}
          format={prettyXml}
          claimed="XML"
          language="xml"
        />
      );
    case "yaml":
      // YAML is already line-oriented; it gets highlighting, not
      // reformatting. There is no malformed fallback because there is no
      // meaningful malformed case: almost any text is a valid YAML scalar.
      return (
        <BodySection>
          <CodeBlock text={text} language="yaml" />
        </BodySection>
      );
    case "javascript":
      return (
        <BodySection>
          <CodeBlock text={text} language="javascript" />
        </BodySection>
      );
    case "html":
      // Untrusted-body invariant: HTML is source to inspect, never a document
      // to render. hljs's xml grammar covers HTML.
      return (
        <BodySection>
          <CodeBlock text={text} language="xml" />
        </BodySection>
      );
    case "form":
      return (
        <FormEncodedBody
          text={text}
          bytes={bytes}
          requestAddress={requestAddress}
        />
      );
    default:
      return (
        <BodySection>
          <CodeBlock text={text} />
        </BodySection>
      );
  }
};

/**
 * A structured-text body: formatted and highlighted when it parses, raw text
 * with an explicit note when it does not — malformed content must never
 * throw, and must never be silently hidden.
 */
const StructuredTextBody = ({
  text,
  format,
  claimed,
  language,
}: {
  text: string;
  format: (text: string) => string | undefined;
  claimed: string;
  language: HighlightLanguage;
}) => {
  // Formatting up to 256 KB (JSON.parse, DOMParser) per render is the
  // freeze the display cap exists to avoid.
  const formatted = useMemo(() => format(text), [format, text]);

  return (
    <BodySection>
      {formatted === undefined ? (
        <>
          <p className="text-caption text-warning">
            This body didn't parse as {claimed}; showing it as raw text.
          </p>
          <CodeBlock text={text} />
        </>
      ) : (
        <CodeBlock text={formatted} language={language} />
      )}
    </BodySection>
  );
};

/**
 * An `application/x-www-form-urlencoded` body as a key/value table. A value
 * that is itself a JSON object or array is pretty-printed — GitHub and Slack
 * send the whole webhook as a single `payload` parameter, which is otherwise
 * an unreadable escaped blob.
 */
const FormEncodedBody = ({
  text,
  bytes,
  requestAddress,
}: {
  text: string;
  bytes: Uint8Array;
  requestAddress: string;
}) => {
  const pairs = useMemo(() => Array.from(new URLSearchParams(text)), [text]);
  const omitted = Math.max(0, pairs.length - MAX_RENDERED_ROWS);
  const downloadUrl = useOwnedBlobUrl(bytes, omitted > 0);

  return (
    <BodySection>
      {omitted > 0 ? (
        <p className="text-caption text-warning">
          {pairs.length.toLocaleString()} pairs — showing the first{" "}
          {MAX_RENDERED_ROWS.toLocaleString()}, {omitted.toLocaleString()} more
          pairs not shown. Download the body to see all of them.
        </p>
      ) : null}
      <div className="border-base-300 rounded-box overflow-hidden border">
        <table className="table-zebra table w-full">
          <tbody>
            {pairs.slice(0, MAX_RENDERED_ROWS).map(([key, value], index) => {
              const nestedJson = /^\s*[{[]/.test(value)
                ? prettyJson(value)
                : undefined;
              return (
                <tr key={index} className="border-base-300">
                  <th
                    scope="row"
                    className="address text-base-content/60 w-64 align-top font-normal"
                  >
                    {key}
                  </th>
                  <td className="text-base-content break-all whitespace-normal">
                    {nestedJson === undefined ? (
                      <span className="address whitespace-normal">{value}</span>
                    ) : (
                      <pre className="address whitespace-pre-wrap">
                        {highlightCode(nestedJson, "json")}
                      </pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {omitted > 0 ? (
        <DownloadLink url={downloadUrl} filename={`${requestAddress}.bin`} />
      ) : null}
    </BodySection>
  );
};

/**
 * A `multipart/form-data` body as a list of parts. Text parts render as text;
 * a raster image part renders inline from a blob built out of the bytes
 * already in hand — never another fetch, never a link to the body endpoint.
 */
const MultipartBody = ({
  bytes,
  boundary,
  charset,
  requestAddress,
}: {
  bytes: Uint8Array;
  boundary: string;
  charset: string | undefined;
  requestAddress: string;
}) => {
  // Byte-scanning the whole body per render would repeat on every parent
  // state change; parts must also be referentially stable so each image
  // part's blob URL isn't revoked and rebuilt per render.
  const parsed = useMemo(
    () => parseMultipart(bytes, boundary),
    [bytes, boundary],
  );
  const overCap = bytes.byteLength > DISPLAY_CAP_BYTES;
  const omitted = parsed
    ? Math.max(0, parsed.parts.length - MAX_RENDERED_ROWS)
    : 0;
  const downloadUrl = useOwnedBlobUrl(
    bytes,
    parsed === undefined ? overCap : omitted > 0,
  );

  if (parsed === undefined) {
    return (
      <BodySection>
        <p className="text-caption text-warning">
          This body didn't parse as multipart/form-data; showing it as raw text
          {overCap ? ", truncated" : ""}.
        </p>
        <CodeBlock
          text={decodeBytes(bytes.subarray(0, DISPLAY_CAP_BYTES), charset)}
        />
        {overCap ? (
          <DownloadLink url={downloadUrl} filename={`${requestAddress}.bin`} />
        ) : null}
      </BodySection>
    );
  }

  const { parts, skipped } = parsed;

  return (
    <BodySection>
      {skipped > 0 ? (
        <p className="text-caption text-warning">
          {skipped.toLocaleString()} {skipped === 1 ? "part" : "parts"} couldn't
          be parsed and {skipped === 1 ? "is" : "are"} not shown.
        </p>
      ) : null}
      {omitted > 0 ? (
        <p className="text-caption text-warning">
          {parts.length.toLocaleString()} parts — showing the first{" "}
          {MAX_RENDERED_ROWS.toLocaleString()}, {omitted.toLocaleString()} more
          parts not shown. Download the body to see all of them.
        </p>
      ) : null}
      <ul className="gap-tight flex list-none flex-col">
        {parts.slice(0, MAX_RENDERED_ROWS).map((part, index) => (
          <li
            key={index}
            className="border-base-300 rounded-box flex flex-col overflow-hidden border"
          >
            <div className="gap-snug bg-base-200/50 border-base-300 px-gutter py-tight flex flex-wrap items-baseline border-b">
              <span className="address text-base-content">
                {part.name ?? "(unnamed part)"}
              </span>
              {part.filename ? (
                <span className="address text-base-content/60">
                  {part.filename}
                </span>
              ) : null}
              {part.contentType ? (
                <span className="text-caption text-base-content/50">
                  {part.contentType}
                </span>
              ) : null}
            </div>
            <div className="px-gutter py-snug">
              <MultipartPartContent part={part} />
            </div>
          </li>
        ))}
      </ul>
      {omitted > 0 ? (
        <DownloadLink url={downloadUrl} filename={`${requestAddress}.bin`} />
      ) : null}
    </BodySection>
  );
};

const MultipartPartContent = ({ part }: { part: MultipartPart }) => {
  const partMedia = parseMediaType(part.contentType);
  const family = classifyBody(partMedia);
  const isRaster =
    family === "image" && RASTER_IMAGE_SUBTYPES.has(partMedia!.subtype);
  // A part with no content-type is text by multipart convention; declared
  // text-ish families render as text too. Everything else — including
  // non-raster images like SVG, which could execute as a document — gets the
  // binary treatment: preview plus download, so a captured file part is
  // never stranded as a bare byte count.
  const isTextual =
    part.contentType === undefined ||
    (family !== "binary" && family !== "image" && family !== "multipart");
  const blobUrl = useOwnedBlobUrl(part.bytes, !isTextual);

  if (isRaster) {
    return blobUrl ? (
      <img
        alt={`Captured part ${part.name ?? ""}`}
        className="border-base-300 rounded-box max-w-full border"
        src={blobUrl}
      />
    ) : null;
  }

  if (isTextual) {
    // The whole body skips the byte cap so parts can render, which makes the
    // per-part cap here the only bound on an oversized text part.
    const overCap = part.bytes.byteLength > DISPLAY_CAP_BYTES;
    return (
      <>
        {overCap ? (
          <p className="text-caption text-warning">
            Truncated: showing the first {DISPLAY_CAP_BYTES.toLocaleString()} of{" "}
            {part.bytes.byteLength.toLocaleString()} bytes.
          </p>
        ) : null}
        <span className="address text-base-content whitespace-pre-wrap">
          {decodeBytes(
            part.bytes.subarray(0, DISPLAY_CAP_BYTES),
            partMedia?.parameters["charset"],
          )}
        </span>
      </>
    );
  }

  return (
    <div className="gap-tight flex flex-col">
      <span className="text-caption text-base-content/60">
        {part.bytes.byteLength.toLocaleString()} bytes
      </span>
      <CodeBlock text={hexPreview(part.bytes)} />
      <DownloadLink
        url={blobUrl}
        filename={part.filename ?? `${part.name ?? "part"}.bin`}
      />
    </div>
  );
};

/** Extensions for download filenames; anything unrecognized gets `.bin`. */
const DOWNLOAD_EXTENSIONS: Record<string, string> = { pdf: "pdf" };

/**
 * A binary or unrecognized body: byte size, a short hex/ASCII glimpse, and a
 * download. The download is an app-owned `application/octet-stream` blob with
 * `<a download>` — never a link to the body endpoint, which captured content
 * must not be navigated to on this origin.
 */
const BinaryBody = ({
  bytes,
  requestAddress,
  subtype,
}: {
  bytes: Uint8Array;
  requestAddress: string;
  subtype: string | undefined;
}) => {
  const downloadUrl = useOwnedBlobUrl(bytes);
  const extension = DOWNLOAD_EXTENSIONS[subtype ?? ""] ?? "bin";

  return (
    <BodySection>
      <p className="text-caption text-base-content/60">
        {bytes.byteLength.toLocaleString()} bytes
        {subtype ? ` · ${subtype}` : ""} — showing the first bytes.
      </p>
      <CodeBlock text={hexPreview(bytes)} />
      <DownloadLink
        url={downloadUrl}
        filename={`${requestAddress}.${extension}`}
      />
    </BodySection>
  );
};

/**
 * A text body over the display cap: a decoded prefix with an explicit
 * truncation marker, plus the whole body as a download.
 */
const TruncatedBody = ({
  bytes,
  charset,
  requestAddress,
}: {
  bytes: Uint8Array;
  charset: string | undefined;
  requestAddress: string;
}) => {
  const downloadUrl = useOwnedBlobUrl(bytes);

  return (
    <BodySection>
      <p className="text-caption text-warning">
        Truncated: showing the first {DISPLAY_CAP_BYTES.toLocaleString()} of{" "}
        {bytes.byteLength.toLocaleString()} bytes. Download the body to see all
        of it.
      </p>
      <CodeBlock
        text={decodeBytes(bytes.subarray(0, DISPLAY_CAP_BYTES), charset)}
      />
      <DownloadLink url={downloadUrl} filename={`${requestAddress}.bin`} />
    </BodySection>
  );
};

export default RequestBody;
