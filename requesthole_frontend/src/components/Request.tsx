import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import holeService from "../services";
import { type RequestObject } from "../types";

const Request = () => {
  const [request, setRequest] = useState<RequestObject>();
  const { request_address, hole_address } = useParams();

  useEffect(() => {
    const refreshRequest = () => {
      holeService
        .getRequest(request_address ?? "")
        .then((requestData) => {
          setRequest(requestData);
        })
        .catch((error) => console.error(error));
    };
    refreshRequest();
  }, [request_address]);

  const RequestHeaders = ({ headers }) => {
    const headerKeys = Object.keys(headers);

    return (
      <table>
        <tbody>
          {headerKeys.map((key) => (
            <tr key={key}>
              <th>{key}</th>
              <td>{headers[key]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <>
      <div className="prose p-5">
        <h1>
          <Link to={`/view/${hole_address}`}>{hole_address}</Link> &gt;{" "}
          {(request ?? { request_address: "" }).request_address}
        </h1>
        <p>
          {request?.method} {request?.request_path}
        </p>
        <RequestHeaders headers={JSON.parse(request?.headers ?? "{}")} />
      </div>
    </>
  );
};

export default Request;
