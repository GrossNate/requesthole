import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import holeService from "../services";
import {
  type RequestObject,
  type RequestHeadersObject,
  type LoadState,
} from "../types";
import { formatTimestamp } from "../utils/format";
import { isAddress } from "../utils/address";
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
        setText(data);
      })
      .catch((error) => console.error(error));

    return () => {
      current = false;
    };
  }, [requestAddress, isInlineText]);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    let objectUrl: string | undefined;

    holeService
      .getBodyBytes(requestAddress)
      .then((bytes) => {
        // application/octet-stream, not application/pdf: even a blob: URL the
        // app owns should never be something a browser will render inline.
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" }),
        );
        // StrictMode cleans up the first effect run before this resolves, so
        // without this the blob would be built after cleanup and never revoked
        // — an orphan holding the whole file for the tab's lifetime.
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setDownloadUrl(url);
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
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

const RequestBreadcrumbs = ({
  holeAddress,
  requestAddress,
}: {
  holeAddress: string | undefined;
  requestAddress?: string;
}) => (
  <nav className="breadcrumbs text-caption py-0">
    <ul>
      <li>
        <Link to="/" className="text-base-content/60 hover:text-primary">
          All holes
        </Link>
      </li>
      <li>
        <Link
          to={`/view/${holeAddress}`}
          className="text-base-content/60 hover:text-primary"
        >
          <span>
            Hole <span className="address">{holeAddress}</span>
          </span>
        </Link>
      </li>
      {requestAddress ? (
        <li className="text-base-content/40">
          <span>
            Request <span className="address">{requestAddress}</span>
          </span>
        </li>
      ) : null}
    </ul>
  </nav>
);

const Request = () => {
  const [request, setRequest] = useState<RequestObject>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const { request_address, hole_address } = useParams();
  const addressIsValid = isAddress(request_address);

  useEffect(() => {
    // Same reasoning as the hole address: this value comes from the route and
    // is interpolated into API URLs and the download filename.
    if (!addressIsValid) return;
    let current = true;

    setLoadState("loading");
    holeService
      .getRequest(request_address!)
      .then((requestData) => {
        if (!current) return;
        let headersObject: RequestHeadersObject = {};
        try {
          headersObject = JSON.parse(requestData.headers);
        } catch (error) {
          console.error(error);
        }
        setRequest({ ...requestData, headersObject });
        setLoadState("loaded");
      })
      .catch((error) => {
        console.error(error);
        if (current) setLoadState("failed");
      });

    return () => {
      current = false;
    };
  }, [request_address, addressIsValid]);

  if (!addressIsValid) {
    return (
      <div className="gap-gutter flex h-full flex-col">
        <RequestBreadcrumbs holeAddress={hole_address} />
        <EmptyState
          title="That's not a valid request address"
          description="A request address is exactly six letters or digits. Check the link you followed."
        >
          <Link to={`/view/${hole_address}`} className="btn btn-sm btn-primary">
            Back to the hole
          </Link>
        </EmptyState>
      </div>
    );
  }

  const detail = () => {
    if (loadState === "loading") {
      return (
        <p className="text-body text-base-content/50" role="status">
          Loading request…
        </p>
      );
    }
    if (loadState === "failed" || !request) {
      return (
        <EmptyState
          title="Couldn't load this request"
          description="The backend didn't answer. Check that it's running, then reload."
        />
      );
    }
    return (
      <div className="scroll-pane gap-gutter flex flex-col">
        <RequestHeaders headers={request.headersObject ?? {}} />
        <RequestBody
          requestAddress={request_address!}
          contentType={request.headersObject?.["content-type"]}
        />
      </div>
    );
  };

  return (
    <div className="gap-gutter flex h-full flex-col">
      <RequestBreadcrumbs
        holeAddress={hole_address}
        requestAddress={request?.request_address}
      />

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

      {detail()}
    </div>
  );
};

export default Request;
