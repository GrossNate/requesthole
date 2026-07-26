import { useState, useEffect, type MouseEventHandler } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import holeService from "../services";
import { type RequestObject } from "../types";
import { formatQueryParams, formatTimestamp } from "../utils/format";
import { holeCaptureUrl } from "../utils/holeUrl";
import CopyButton from "./CopyButton";
import EmptyState from "./EmptyState";
import MethodBadge from "./MethodBadge";

type LoadState = "loading" | "loaded" | "failed";

const Hole = () => {
  const [holeRequests, setHoleRequests] = useState<RequestObject[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const { hole_address } = useParams();
  const navigate = useNavigate();
  const holeFullUrl = holeCaptureUrl(hole_address ?? "");

  useEffect(() => {
    let current = true;

    setLoadState("loading");
    holeService
      .getRequests(hole_address ?? "")
      .then((holeData) => {
        if (!current) return;
        setHoleRequests(holeData);
        setLoadState("loaded");
      })
      .catch((error) => {
        console.error(error);
        if (current) setLoadState("failed");
      });

    const sse = new EventSource(
      `${holeService.BASE_URL}/api/hole/${hole_address}/events`,
    );
    sse.onmessage = (event) => {
      setHoleRequests((prev) => [...prev, JSON.parse(event.data)]);
    };
    sse.onerror = () => {
      sse.close();
    };
    return () => {
      current = false;
      sse.close();
    };
  }, [hole_address]);

  const handleDeleteRequest = (request_address: string) => {
    const handler: MouseEventHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      holeService
        .deleteRequest(request_address)
        .then((isDeleted) => {
          if (isDeleted) {
            setHoleRequests((prevRequests) =>
              prevRequests.filter(
                (request) => request.request_address !== request_address,
              ),
            );
          }
        })
        .catch((error) => console.error(error));
    };
    return handler;
  };

  const requestLink = (request: RequestObject) =>
    `/view/${hole_address}/${request.request_address}`;

  const requestTable = () => (
    <div className="scroll-pane">
      <table className="table-pin-rows table w-full">
        <thead>
          <tr className="bg-base-200 text-base-content/60">
            <th scope="col" className="w-24">
              Method
            </th>
            <th scope="col" className="w-1/4">
              Path
            </th>
            <th scope="col">Params</th>
            <th scope="col" className="w-48">
              Created
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {holeRequests.map((request) => {
            const params = formatQueryParams(request.query_params);
            // The row is clickable for the mouse; the path cell carries the one
            // link, so the keyboard gets a single stop per row rather than four
            // identical ones.
            return (
              <tr
                key={request.request_address}
                onClick={() => navigate(requestLink(request))}
                className="hover:bg-base-200/60 border-base-300 cursor-pointer"
              >
                <td>
                  <MethodBadge method={request.method} />
                </td>
                <td className="max-w-0">
                  <Link
                    to={requestLink(request)}
                    className="address text-base-content block truncate hover:underline"
                    title={request.request_path}
                  >
                    {request.request_path}
                  </Link>
                </td>
                <td className="address text-base-content/70 max-w-0 truncate">
                  <span title={params}>{params || "—"}</span>
                </td>
                <td>
                  <span
                    className="text-caption text-base-content/60 font-mono whitespace-nowrap"
                    title={request.created}
                  >
                    {formatTimestamp(request.created)}
                  </span>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-error"
                    onClick={handleDeleteRequest(request.request_address)}
                  >
                    delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const listing = () => {
    if (loadState === "loading") {
      return (
        <p className="text-body text-base-content/50" role="status">
          Loading requests…
        </p>
      );
    }
    if (loadState === "failed") {
      return (
        <EmptyState
          title="Couldn't load this hole's requests"
          description="The backend didn't answer. Check that it's running, then reload."
        />
      );
    }
    if (holeRequests.length === 0) {
      return (
        <EmptyState
          title="No requests captured yet"
          description="Send any HTTP request to this hole's capture URL and it will appear here, live."
        >
          <code className="address text-secondary bg-base-300/50 px-snug py-tight rounded-field">
            {holeFullUrl}
          </code>
          <span className="text-caption text-base-content/50">
            Any method, any body — GET, POST, PUT, anything.
          </span>
        </EmptyState>
      );
    }
    return requestTable();
  };

  if (holeFullUrl === null) {
    return (
      <div className="gap-gutter flex h-full flex-col">
        <nav className="breadcrumbs text-caption py-0">
          <ul>
            <li>
              <Link to="/" className="text-base-content/60 hover:text-primary">
                All holes
              </Link>
            </li>
          </ul>
        </nav>
        <EmptyState
          title="That's not a valid hole address"
          description="A hole address is exactly six letters or digits. Check the link you followed."
        >
          <Link to="/" className="btn btn-sm btn-primary">
            Back to all holes
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="gap-gutter flex h-full flex-col">
      <nav className="breadcrumbs text-caption py-0">
        <ul>
          <li>
            <Link to="/" className="text-base-content/60 hover:text-primary">
              All holes
            </Link>
          </li>
          <li className="text-base-content/40">
            <span>
              Hole <span className="address">{hole_address}</span>
            </span>
          </li>
        </ul>
      </nav>

      <div className="gap-snug flex flex-col">
        <h1 className="page-title">
          Hole <span className="text-primary address">{hole_address}</span>
        </h1>
        <div className="border-base-300 bg-base-200/50 gap-snug px-gutter py-tight rounded-box flex flex-wrap items-center border">
          <span className="section-label">Capture URL</span>
          <code className="address text-secondary grow overflow-x-auto">
            {holeFullUrl}
          </code>
          <CopyButton value={holeFullUrl} label="Copy URL" />
        </div>
      </div>

      {listing()}
    </div>
  );
};

export default Hole;
