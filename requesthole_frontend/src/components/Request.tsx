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
          <div className="p-3">
            <h2>Body</h2>
            <img
              src={`${holeService.BASE_URL}/api/request/${request_address}/body`}
            />
          </div>
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
          <div className="p-3">
            <h2>Body</h2>
            <div>{requestBody}</div>
          </div>
        );
      }
      if (/application\/json/.test(request.headersObject["content-type"])) {
        holeService
          .getBody(request_address ?? "")
          .then((data) => setRequestBody(data));
        return (
          <div className="p-3">
            <h2>Body</h2>
            <div>{JSON.stringify(requestBody)}</div>
          </div>
        );
      }
      if (/application\/pdf/.test(request.headersObject["content-type"])) {
        return (
          <div className="p-3">
            <h2>Body</h2>
            <div>
              <Link
                to={`${holeService.BASE_URL}/api/request/${request_address}/body`}
                target="_blank"
              >
                📄 PDF
              </Link>
            </div>
          </div>
        );
      }
    } else {
      return;
    }
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
            <Link to={`/view/${hole_address}`} className="btn btn-ghost">
              Hole {hole_address}
            </Link>
          </li>
          <li>
            <div className="btn btn-ghost btn-disabled">
              Request {(request ?? { request_address: "" }).request_address}
            </div>
          </li>
        </ul>
      </div>
      <h1 className="pl-3">
        {request?.method} {request?.request_path}
      </h1>
      <div className="h-full overflow-y-auto pb-16">
        <RequestHeaders headers={request?.headersObject ?? {}} />
        <RequestBody />
      </div>
    </>
  );
};

export default Request;
