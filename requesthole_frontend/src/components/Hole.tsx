import { useState, useEffect, type MouseEventHandler } from "react";
import { useParams, Link } from "react-router-dom";
import holeService from "../services";
import { type RequestObject } from "../types";

const Hole = () => {
  const [holeRequests, setHoleRequests] = useState<RequestObject[]>([]);
  const { hole_address } = useParams();
  const holeFullUrl = `${holeService.BASE_URL}/${hole_address}`;

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

  const copyTextToClipboard = async (text: string) => {
    void (await navigator.clipboard.writeText(text));
  };

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

  return (
    <>
      <div className="breadcrumbs text-sm">
        <ul>
          <li>
            <Link to="/" className="btn btn-ghost">
              All holes
            </Link>
          </li>
          <li>
            <div className="btn btn-ghost btn-disabled">
              Hole {hole_address}
            </div>
          </li>
        </ul>
      </div>
      <h1 className="pl-3">
        {holeFullUrl}{" "}
        <button onClick={() => copyTextToClipboard(holeFullUrl)}>⿻</button>
      </h1>
      <div className="h-full overflow-y-auto pb-16">
        <table className="table table-md table-zebra table-pin-rows w-full">
          <thead>
            <tr>
              <td>Method</td>
              <td>Path</td>
              <td>Params</td>
              <td>Created</td>
              <td></td>
            </tr>
          </thead>
          <tbody>
            {holeRequests.map((request) => (
              <tr key={request.request_address}>
                <td>
                  <Link to={`/view/${hole_address}/${request.request_address}`}>
                    {request.method}
                  </Link>
                </td>
                <td>
                  <Link to={`/view/${hole_address}/${request.request_address}`}>
                    {request.request_path}
                  </Link>
                </td>
                <td>
                  <Link to={`/view/${hole_address}/${request.request_address}`}>
                    {request.headers}
                  </Link>
                </td>
                <td>
                  <Link to={`/view/${hole_address}/${request.request_address}`}>
                    {request.created}
                  </Link>
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-error"
                    onClick={handleDeleteRequest(request.request_address)}
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default Hole;
