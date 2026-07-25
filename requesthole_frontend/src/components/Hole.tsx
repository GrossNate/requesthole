import { useState, useEffect, type MouseEventHandler } from "react";
import { useParams, Link } from "react-router-dom";
import holeService from "../services";
import { type RequestObject } from "../types";
import { formatQueryParams, formatTimestamp } from "../utils/format";
import { holeCaptureUrl } from "../utils/holeUrl";
import CopyButton from "./CopyButton";
import EmptyState from "./EmptyState";
import MethodBadge from "./MethodBadge";

const Hole = () => {
  const [holeRequests, setHoleRequests] = useState<RequestObject[]>([]);
  const { hole_address } = useParams();
  const holeFullUrl = holeCaptureUrl(hole_address ?? "");

  useEffect(() => {
    const refreshHole = () => {
      holeService
        .getRequests(hole_address ?? "")
        .then((holeData) => {
          setHoleRequests(holeData);
        })
        .catch((error) => console.error(error));
    };
    refreshHole();

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
      sse.close();
    };
  }, [hole_address]);

  const handleDeleteRequest = (request_address: string) => {
    const handler: MouseEventHandler = (event) => {
      event.preventDefault();
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
            return (
              <tr
                key={request.request_address}
                className="hover:bg-base-200/60 border-base-300"
              >
                <td>
                  <Link to={requestLink(request)}>
                    <MethodBadge method={request.method} />
                  </Link>
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
                <td className="max-w-0">
                  <Link
                    to={requestLink(request)}
                    className="address text-base-content/70 block truncate"
                    title={params}
                  >
                    {params || "—"}
                  </Link>
                </td>
                <td>
                  <Link
                    to={requestLink(request)}
                    className="text-caption text-base-content/60 font-mono whitespace-nowrap"
                  >
                    {formatTimestamp(request.created)}
                  </Link>
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
        <div className="border-base-300 bg-base-200/50 gap-snug px-gutter py-tight flex flex-wrap items-center rounded-box border">
          <span className="section-label">Capture URL</span>
          <code className="address text-secondary grow overflow-x-auto">
            {holeFullUrl}
          </code>
          <CopyButton value={holeFullUrl} label="Copy URL" />
        </div>
      </div>

      {holeRequests.length === 0 ? (
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
      ) : (
        requestTable()
      )}
    </div>
  );
};

export default Hole;
