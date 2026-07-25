import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import holeService from "../services";
import { type RequestObject, type RequestHeadersObject } from "../types";
import { formatQueryParams, formatTimestamp } from "../utils/format";
import MethodBadge from "./MethodBadge";

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

    if (headerKeys.length === 0) return null;

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

  const RequestQueryParams = () => {
    const params = formatQueryParams(request?.query_params);
    if (!params) return null;

    return (
      <section className="gap-tight flex flex-col">
        <h2 className="section-label">Query parameters</h2>
        <p className="address border-base-300 bg-base-200/50 px-gutter py-snug rounded-box border break-all whitespace-normal">
          {params}
        </p>
      </section>
    );
  };

  // Content-type dispatch stays as-is — task 0005 replaces this whole viewer.
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
          <section className="gap-tight flex flex-col">
            <h2 className="section-label">Body</h2>
            <img
              alt="Captured request body"
              className="border-base-300 rounded-box max-w-full border"
              src={`${holeService.BASE_URL}/api/request/${request_address}/body`}
            />
          </section>
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
          <section className="gap-tight flex flex-col">
            <h2 className="section-label">Body</h2>
            <div className="address border-base-300 bg-base-200/50 px-gutter py-snug rounded-box border break-all whitespace-pre-wrap">
              {requestBody}
            </div>
          </section>
        );
      }
      if (/application\/json/.test(request.headersObject["content-type"])) {
        holeService
          .getBody(request_address ?? "")
          .then((data) => setRequestBody(data));
        return (
          <section className="gap-tight flex flex-col">
            <h2 className="section-label">Body</h2>
            <div className="address border-base-300 bg-base-200/50 px-gutter py-snug rounded-box border break-all whitespace-pre-wrap">
              {JSON.stringify(requestBody)}
            </div>
          </section>
        );
      }
      if (/application\/pdf/.test(request.headersObject["content-type"])) {
        return (
          <section className="gap-tight flex flex-col">
            <h2 className="section-label">Body</h2>
            <div>
              <Link
                className="btn btn-sm btn-outline btn-primary"
                to={`${holeService.BASE_URL}/api/request/${request_address}/body`}
                target="_blank"
              >
                📄 Download PDF
              </Link>
            </div>
          </section>
        );
      }
    } else {
      return;
    }
  };

  return (
    <div className="gap-gutter flex h-full flex-col">
      <nav className="breadcrumbs text-caption py-0">
        <ul>
          <li>
            <Link to="/" className="text-base-content/60 hover:text-primary">
              All holes
            </Link>
          </li>
          <li>
            <Link
              to={`/view/${hole_address}`}
              className="text-base-content/60 hover:text-primary"
            >
              <span>
                Hole <span className="address">{hole_address}</span>
              </span>
            </Link>
          </li>
          <li className="text-base-content/40">
            <span>
              Request{" "}
              <span className="address">{request?.request_address}</span>
            </span>
          </li>
        </ul>
      </nav>

      <div className="gap-snug flex flex-wrap items-center">
        {request ? <MethodBadge method={request.method} /> : null}
        <h1 className="page-title address">{request?.request_path}</h1>
        <span className="text-caption text-base-content/50 ms-auto font-mono">
          {formatTimestamp(request?.created)}
        </span>
      </div>

      <div className="scroll-pane gap-gutter flex flex-col">
        <RequestQueryParams />
        <RequestHeaders headers={request?.headersObject ?? {}} />
        <RequestBody />
      </div>
    </div>
  );
};

export default Request;
