import { useEffect, useState } from "react";
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
 * An object URL for bytes the app already holds, revoked on cleanup. Built
 * synchronously from fetched state, so there is no async race to guard.
 */
function useOwnedBlobUrl(bytes: Uint8Array): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
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
  }, [bytes]);

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
}) => (
  <pre className="address border-base-300 bg-base-200/50 px-gutter py-snug rounded-box border break-all whitespace-pre-wrap">
    {language ? highlightCode(text, language) : text}
  </pre>
);

/**
 * Decodes body bytes per the content-type's charset parameter, defaulting to
 * UTF-8. The charset is attacker-controlled, so an unknown label falls back to
 * UTF-8 rather than throwing.
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

  const [bytes, setBytes] = useState<Uint8Array>();

  useEffect(() => {
    if (family === "image") return;
    let current = true;

    holeService
      .getBodyBytes(requestAddress)
      .then((buffer) => {
        if (current) setBytes(new Uint8Array(buffer));
      })
      .catch((error) => console.error(error));

    return () => {
      current = false;
    };
  }, [requestAddress, family]);

  if (family === "image") {
    return (
      <BodySection>
        <img
          alt="Captured request body"
          className="border-base-300 rounded-box max-w-full border"
          src={`${holeService.BASE_URL}/api/request/${requestAddress}/body`}
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

  if (bytes.byteLength > DISPLAY_CAP_BYTES) {
    return <TruncatedBody bytes={bytes} requestAddress={requestAddress} />;
  }

  const text = decodeBytes(bytes, media?.parameters["charset"]);

  switch (family) {
    case "json":
      return (
        <StructuredTextBody
          text={text}
          formatted={prettyJson(text)}
          claimed="JSON"
          language="json"
        />
      );
    case "ndjson":
      return (
        <StructuredTextBody
          text={text}
          formatted={prettyNdjson(text)}
          claimed="NDJSON"
          language="json"
        />
      );
    case "xml":
      return (
        <StructuredTextBody
          text={text}
          formatted={prettyXml(text)}
          claimed="XML"
          language="xml"
        />
      );
    case "yaml":
      // YAML is already line-oriented; it gets highlighting, not reformatting.
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
    case "text":
      return (
        <BodySection>
          <CodeBlock text={text} />
        </BodySection>
      );
    case "form":
      return <FormEncodedBody text={text} />;
    case "multipart":
      return (
        <MultipartBody
          bytes={bytes}
          boundary={media?.parameters["boundary"] ?? ""}
          text={text}
        />
      );
    default:
      return (
        <BinaryBody
          bytes={bytes}
          requestAddress={requestAddress}
          subtype={media?.subtype}
        />
      );
  }
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
 * A body over the display cap: a decoded prefix with an explicit truncation
 * marker, plus the whole body as a download.
 */
const TruncatedBody = ({
  bytes,
  requestAddress,
}: {
  bytes: Uint8Array;
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
        text={decodeBytes(bytes.subarray(0, DISPLAY_CAP_BYTES), undefined)}
      />
      <DownloadLink url={downloadUrl} filename={`${requestAddress}.bin`} />
    </BodySection>
  );
};

/**
 * A `multipart/form-data` body as a list of parts. Text parts render as text;
 * an image part renders inline from a blob built out of the bytes already in
 * hand — never another fetch, never a link to the body endpoint.
 */
const MultipartBody = ({
  bytes,
  boundary,
  text,
}: {
  bytes: Uint8Array;
  boundary: string;
  text: string;
}) => {
  const parts = parseMultipart(bytes, boundary);

  if (parts === undefined) {
    return (
      <BodySection>
        <p className="text-caption text-warning">
          This body didn't parse as multipart/form-data; showing it as raw
          text.
        </p>
        <CodeBlock text={text} />
      </BodySection>
    );
  }

  return (
    <BodySection>
      <ul className="gap-tight flex list-none flex-col">
        {parts.map((part, index) => (
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
    </BodySection>
  );
};

const MultipartPartContent = ({ part }: { part: MultipartPart }) => {
  const family = classifyBody(parseMediaType(part.contentType));
  const [imageUrl, setImageUrl] = useState<string>();
  const isImage = family === "image";

  // The blob is built synchronously from bytes already fetched, so unlike the
  // body-level download there is no async race — cleanup only has to revoke.
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(
      new Blob([part.bytes as BlobPart], { type: part.contentType }),
    );
    setImageUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setImageUrl(undefined);
    };
  }, [part, isImage]);

  if (isImage) {
    return imageUrl ? (
      <img
        alt={`Captured part ${part.name ?? ""}`}
        className="border-base-300 rounded-box max-w-full border"
        src={imageUrl}
      />
    ) : null;
  }

  // A part with no content-type is text by multipart convention; declared
  // text-ish families render as text too. Anything else stays a byte count.
  if (part.contentType === undefined || family !== "binary") {
    return (
      <span className="address text-base-content whitespace-pre-wrap">
        {decodeBytes(
          part.bytes,
          parseMediaType(part.contentType)?.parameters["charset"],
        )}
      </span>
    );
  }

  return (
    <span className="text-caption text-base-content/60">
      {part.bytes.byteLength.toLocaleString()} bytes
    </span>
  );
};

/**
 * An `application/x-www-form-urlencoded` body as a key/value table. A value
 * that is itself a JSON object or array is pretty-printed — GitHub and Slack
 * send the whole webhook as a single `payload` parameter, which is otherwise
 * an unreadable escaped blob.
 */
const FormEncodedBody = ({ text }: { text: string }) => {
  const pairs = Array.from(new URLSearchParams(text));

  return (
    <BodySection>
      <div className="border-base-300 rounded-box overflow-hidden border">
        <table className="table-zebra table w-full">
          <tbody>
            {pairs.map(([key, value], index) => {
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
    </BodySection>
  );
};

/**
 * A structured-text body: formatted and highlighted when it parses, raw text
 * with an explicit note when it does not — malformed content must never
 * throw, and must never be silently hidden.
 */
const StructuredTextBody = ({
  text,
  formatted,
  claimed,
  language,
}: {
  text: string;
  formatted: string | undefined;
  claimed: string;
  language: HighlightLanguage;
}) => (
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

export default RequestBody;
