import { useState, useEffect, type MouseEventHandler } from "react";
import { useParams, Link } from "react-router-dom";
import holeService from "../services";
import { type RequestObject } from "../types";

const Hole = () => {
  const [holeRequests, setHoleRequests] = useState<RequestObject[]>([]);
  const { hole_address } = useParams();

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

  return (
    <div className="prose p-5">
      <h1>{hole_address}</h1>
      <table className="table table-lg">
        <thead>
          <th>Method</th>
          <th>Path</th>
          <th>Params</th>
          <th>Created</th>
          <th></th>
        </thead>
        <tbody>
          {holeRequests.map((request) => (
            <Link to={`/view/${hole_address}/${request.request_address}`}>
              <tr key={request.request_address}>
                <td>{request.method}</td>
                <td>{request.request_path}</td>
                <td>{request.headers}</td>
                <td>{request.created}</td>
                <td>
                  <button
                    className="btn btn-sm btn-error"
                    onClick={handleDeleteRequest(request.request_address)}
                  >
                    delete
                  </button>
                </td>
              </tr>
            </Link>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Hole;
