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
    // The stale-record check matters on route changes: the first render after
    // the param changes still holds the previous request's record, and
    // rendering the body viewer then would fetch the new address's body
    // classified under the old content-type.
    if (
      loadState === "loading" ||
      (request && request.request_address !== request_address)
    ) {
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
