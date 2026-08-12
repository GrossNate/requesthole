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
import RequestBody from "./RequestBody";

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
                  className="address text-base-content/60 w-32 align-top font-normal sm:w-64"
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

/**
 * One captured request, shown in the hole view's detail pane. The hole around
 * it owns the page chrome — breadcrumbs, the hole heading, the capture URL — so
 * this renders the request itself and nothing else.
 */
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

  // The record in hand belongs to the request that was open a moment ago. This
  // matters twice over now that one instance of the pane serves every
  // selection: the body viewer would fetch the new address's bytes classified
  // under the old content-type, and the header would name the request the
  // reader just left while the body below it said it was still loading.
  const stale =
    loadState === "loading" ||
    (request && request.request_address !== request_address);

  const failurePanel = (
    <EmptyState
      title="Couldn't load this request"
      description="The backend didn't answer. Check that it's running, then reload."
    />
  );

  const detail = () => {
    // Failure outranks staleness. A fetch that rejects while the previous
    // record is still in hand leaves the pane holding one address's record
    // under another address's route — which is stale — so a spinner-first
    // order sat on "Loading request…" for good.
    if (loadState === "failed") return failurePanel;
    if (stale) {
      return (
        <p className="text-body text-base-content/50" role="status">
          Loading request…
        </p>
      );
    }
    if (!request) return failurePanel;
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
    <div className="gap-gutter flex min-h-0 flex-1 flex-col">
      {/* Blank while stale, so the whole pane changes over at once rather than
          captioning the new request with the old one's method and path. */}
      <div className="gap-snug flex min-w-0 flex-wrap items-center">
        {request && !stale ? <MethodBadge method={request.method} /> : null}
        {/* The hole owns the page heading; this one names the pane under it.
            Truncated rather than allowed its natural width: paths run long and
            `.address` refuses to wrap, which on a phone dragged the whole page
            sideways. The full value stays a hover away. */}
        <h2
          className="pane-title address min-w-0 flex-1 truncate"
          title={stale ? undefined : request?.request_path}
        >
          {stale ? null : request?.request_path}
        </h2>
        {/* Its own line on a phone: sharing one with the path left the path
            truncated to a few characters, and the path is what identifies the
            capture. */}
        <span
          className="text-caption text-base-content/50 w-full shrink-0 font-mono sm:ms-auto sm:w-auto"
          title={stale ? undefined : request?.created}
        >
          {stale ? null : formatTimestamp(request?.created)}
        </span>
      </div>

      {detail()}
    </div>
  );
};

export default Request;
