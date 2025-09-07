import { useState, useEffect } from "react";
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

  return (
    <div className="prose p-5">
      <h1>{hole_address}</h1>
      <table className="table table-lg">
        <thead>
          <th>Method</th>
          <th>Path</th>
          <th>Params</th>
          <th>Created</th>
        </thead>
        <tbody>
          {holeRequests.map((request) => (
            <Link to={`/view/${hole_address}/${request.request_address}`}>
              <tr key={request.request_address}>
                <td>{request.method}</td>
                <td>{request.request_path}</td>
                <td>{request.headers}</td>
                <td>{request.created}</td>
              </tr>
            </Link>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Hole;
