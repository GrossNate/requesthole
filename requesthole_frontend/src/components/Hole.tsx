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
    const refreshInterval = setInterval(() => refreshHole(), 60000);
    return () => clearInterval(refreshInterval);
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
            <tr key={request.request_address}>
              <td>{request.method}</td>
              <td>{request.request_path}</td>
              <td>{request.query_params}</td>
              <td>{request.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Hole;
