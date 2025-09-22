import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import holeService from "../services";
import { type RequestObject, type RequestHeadersObject } from "../types";

const Request = () => {
  const [request, setRequest] = useState<RequestObject>();
  const { request_address, hole_address } = useParams();

  useEffect(() => {
    const refreshRequest = () => {
      holeService
        .getRequest(request_address ?? "")
        .then((requestData) => {
          const requestHeadersObject = JSON.parse(requestData.headers);
          setRequest({ ...requestData, headersObject: requestHeadersObject });
        })
        .catch((error) => console.error(error));
    };
    refreshRequest();
  }, [request_address]);

  const RequestHeaders = ({ headers }: { headers: RequestHeadersObject }) => {
    const headerKeys = Object.keys(headers);

    return (
      <table className="table table-zebra">
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

  const RequestBody = () => {
    const [requestBody, setRequestBody] = useState<Buffer>();
    if (
      request &&
      typeof request.headersObject === "object" &&
      request.headersObject["content-type"]
    ) {
      // image/png
      // image/jpeg
      // image/svg+xml
      // image/gif

      // text/plain

      // text/html
      // application/json
      // application/xml
      // application/javascript
      // multipart/form-data; boundary=--------------------------740515865934547368323480
      // application/x-www-form-urlencoded

      // application/pdf
      if (/image\//.test(request.headersObject["content-type"])) {
        return (
          <>
            <h2>Body</h2>
            <img
              src={`${holeService.BASE_URL}/api/request/${request_address}/body`}
            />
          </>
        );
      }
      if (
        /(text\/)|(application\/xml)|(application\/javascript)|(multipart\/form-data)|(application\/x-www-form-urlencoded)/.test(
          request.headersObject["content-type"],
        )
      ) {
        holeService
          .getBody(request_address ?? "")
          .then((data) => setRequestBody(data));
        return (
          <>
            <h2>Body</h2>
            <div>{requestBody}</div>
          </>
        );
      }
      if (/application\/json/.test(request.headersObject["content-type"])) {
        holeService
          .getBody(request_address ?? "")
          .then((data) => setRequestBody(data));
        return (
          <>
            <h2>Body</h2>
            <div>{JSON.stringify(requestBody)}</div>
          </>
        );
      }
      if (/application\/pdf/.test(request.headersObject["content-type"])) {
        return (
          <>
            <h2>Body</h2>
            <div>
              <Link
                to={`${holeService.BASE_URL}/api/request/${request_address}/body`}
                target="_blank"
              >
                📄 PDF
              </Link>
            </div>
          </>
        );
      }
    } else {
      return;
    }
  };

  return (
    <>
      <div className="prose p-5">
        <div className="breadcrumbs text-sm">
          <ul>
            <li>
              <Link to="/">All holes</Link>
            </li>
            <li>
              <Link to={`/view/${hole_address}`}>Hole {hole_address}</Link>
            </li>
            <li>
              Request {(request ?? { request_address: "" }).request_address}
            </li>
          </ul>
        </div>
        <h1>{(request ?? { request_address: "" }).request_address}</h1>
        <p>
          {request?.method} {request?.request_path}
        </p>
        <RequestHeaders headers={request?.headersObject ?? {}} />
        <RequestBody />
      </div>
    </>
  );
};

export default Request;
