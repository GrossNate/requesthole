import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import holeService from "../services";
import { type RequestObject, type RequestHeadersObject } from "../types";
import { formatTimestamp } from "../utils/format";
import EmptyState from "./EmptyState";
import MethodBadge from "./MethodBadge";

/** Content types the viewer renders inline as escaped text. */
const TEXTUAL =
  /(text\/)|(application\/xml)|(application\/javascript)|(multipart\/form-data)|(application\/x-www-form-urlencoded)/;

const RequestHeaders = ({ headers }: { headers: RequestHeadersObject }) => {
  const headerKeys = Object.keys(headers);

  if (headerKeys.length === 0) {
    return (
      <section className="gap-tight flex flex-col">
        <h2 className="section-label">Headers</h2>
        <EmptyState
          compact
          title="No headers captured"
          description="This request arrived without any headers."
        />
      </section>
    );
  }

  return (
    <section className="gap-tight flex flex-col">
      <h2 className="section-label">Headers</h2>
      <div className="border-base-300 rounded-box overflow-hidden border">
        <table className="table-zebra table w-full">
          <tbody>
            {headerKeys.map((key) => (
              <tr key={key} className="border-base-300">
                <th
                  scope="row"
                  className="address text-base-content/60 w-64 align-top font-normal"
                >
                  {key}
                </th>
                <td className="address text-base-content break-all whitespace-normal">
                  {headers[key]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const BodySection = ({ children }: { children: React.ReactNode }) => (
  <section className="gap-tight flex flex-col">
    <h2 className="section-label">Body</h2>
    {children}
  </section>
);

/**
 * Task 0005 replaces this viewer with a content-aware one. Until then it keeps
 * the original content-type dispatch, with the fetch moved out of render and
 * the PDF handed over as a locally-built blob rather than by navigating to the
 * body endpoint — captured bodies must never load as a document on this origin.
 */
const RequestBody = ({
  requestAddress,
  contentType,
}: {
  requestAddress: string;
  contentType: string | undefined;
}) => {
  const [text, setText] = useState<string>();
  const [downloadUrl, setDownloadUrl] = useState<string>();

  const isImage = contentType !== undefined && /image\//.test(contentType);
  const isPdf =
    contentType !== undefined && /application\/pdf/.test(contentType);
  const isInlineText =
    contentType !== undefined &&
    (TEXTUAL.test(contentType) || /application\/json/.test(contentType));

  useEffect(() => {
    if (!isInlineText) return;
    let current = true;

    holeService
      .getBody(requestAddress)
      .then((data) => {
        if (!current) return;
        setText(typeof data === "string" ? data : JSON.stringify(data));
      })
      .catch((error) => console.error(error));

    return () => {
      current = false;
    };
  }, [requestAddress, isInlineText]);

  useEffect(() => {
    if (!isPdf) return;
    let objectUrl: string | undefined;

    holeService
      .getBodyBytes(requestAddress)
      .then((bytes) => {
        // application/octet-stream, not application/pdf: even a blob: URL the
        // app owns should never be something a browser will render inline.
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" }),
        );
        setDownloadUrl(objectUrl);
      })
      .catch((error) => console.error(error));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloadUrl(undefined);
    };
  }, [requestAddress, isPdf]);

  if (contentType === undefined) return null;

  if (isImage) {
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

  if (isInlineText) {
    return (
      <BodySection>
        <div className="address border-base-300 bg-base-200/50 px-gutter py-snug rounded-box border break-all whitespace-pre-wrap">
          {text}
        </div>
      </BodySection>
    );
  }

  if (isPdf) {
    return (
      <BodySection>
        <div>
          <a
            className={`btn btn-sm btn-outline btn-primary ${
              downloadUrl ? "" : "btn-disabled"
            }`}
            href={downloadUrl}
            download={`${requestAddress}.pdf`}
          >
            📄 Download PDF
          </a>
        </div>
      </BodySection>
    );
  }

  return null;
};

const Request = () => {
  const [request, setRequest] = useState<RequestObject>();
  const { request_address, hole_address } = useParams();

  useEffect(() => {
    let current = true;

    holeService
      .getRequest(request_address ?? "")
      .then((requestData) => {
        if (!current) return;
        let headersObject: RequestHeadersObject = {};
        try {
          headersObject = JSON.parse(requestData.headers);
        } catch (error) {
          console.error(error);
        }
        setRequest({ ...requestData, headersObject });
      })
      .catch((error) => console.error(error));

    return () => {
      current = false;
    };
  }, [request_address]);

  return (
    <div className="gap-gutter flex h-full flex-col">
      <nav className="breadcrumbs text-caption py-0">
        <ul>
          <li>
            <Link to="/" className="text-base-content/60 hover:text-primary">
              All holes
            </Link>
          </li>
          <li>
            <Link
              to={`/view/${hole_address}`}
              className="text-base-content/60 hover:text-primary"
            >
              <span>
                Hole <span className="address">{hole_address}</span>
              </span>
            </Link>
          </li>
          <li className="text-base-content/40">
            <span>
              Request{" "}
              <span className="address">{request?.request_address}</span>
            </span>
          </li>
        </ul>
      </nav>

      <div className="gap-snug flex flex-wrap items-center">
        {request ? <MethodBadge method={request.method} /> : null}
        <h1 className="page-title address">{request?.request_path}</h1>
        <span
          className="text-caption text-base-content/50 ms-auto font-mono"
          title={request?.created}
        >
          {formatTimestamp(request?.created)}
        </span>
      </div>

      <div className="scroll-pane gap-gutter flex flex-col">
        <RequestHeaders headers={request?.headersObject ?? {}} />
        {request ? (
          <RequestBody
            requestAddress={request_address ?? ""}
            contentType={request.headersObject?.["content-type"]}
          />
        ) : null}
      </div>
    </div>
  );
};

export default Request;
