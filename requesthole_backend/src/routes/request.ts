import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import RequestBroadcaster from "../RequestBroadcaster";

interface RequestParams {
  request_address: string;
}

const params: JSONSchemaType<RequestParams> = {
  type: "object",
  properties: {
    request_address: { type: "string", pattern: "^[a-zA-Z0-9]{6}$" },
  },
  required: ["request_address"],
};

function routesWrapper(requestBroadcaster: RequestBroadcaster) {
  return function routes(
    fastify: FastifyInstance,
    options: RouteShorthandOptions,
  ) {
    // Prepared once per registration and reused across requests.
    // The delete hands back the owning hole: the broadcaster is keyed by hole
    // address, and the row is the only thing that knows which hole it was in.
    const deleteRequest = fastify.db.prepare(
      `DELETE FROM requests WHERE request_address = ?
     RETURNING (SELECT hole_address FROM holes WHERE hole_id = requests.hole_id)
       AS hole_address;`,
    );
    const selectRequest = fastify.db.prepare(
      `
      SELECT
        request_address,
        created,
        method,
        request_path,
        query_params,
        headers
      FROM requests
      WHERE request_address = ?
    `,
    );
    const selectRequestBody = fastify.db.prepare(
      `SELECT headers, body FROM requests WHERE request_address = ?`,
    );

    fastify.delete<{ Params: RequestParams }>(
      "/api/request/:request_address",
      { ...options, schema: { params } },
      async (request, reply) => {
        const { request_address } = request.params;
        const deleted = deleteRequest.get(request_address) as
          | { hole_address: string }
          | undefined;
        if (deleted) {
          requestBroadcaster.broadcastDelete(
            deleted.hole_address,
            request_address,
          );
        }
        reply.code(deleted ? 204 : 404);
      },
    );

    fastify.get<{ Params: RequestParams }>(
      "/api/request/:request_address",
      { ...options, schema: { params } },
      async (request, reply) => {
        const row = selectRequest.get(request.params.request_address);
        if (row === undefined) {
          reply.code(404);
        } else {
          reply.send(row);
        }
      },
    );

    fastify.get<{ Params: RequestParams }>(
      "/api/request/:request_address/body",
      { ...options, schema: { params } },
      async (request, reply) => {
        const row = selectRequestBody.get(request.params.request_address);
        if (row === undefined) {
          reply.code(404);
        } else {
          const { body, headers } = row as {
            body: Buffer | string | null;
            headers: string;
          };
          const buffer =
            body === null
              ? Buffer.alloc(0)
              : body instanceof Buffer
                ? body
                : Buffer.from(body);
          const headersObject = JSON.parse(headers) as Partial<{
            "content-type": string;
          }>;
          // Serve captured bodies inertly. The stored content is untrusted, so a
          // stored `<script>` must never execute on this origin: `nosniff` stops
          // the browser inferring an executable type, and `attachment` makes
          // direct navigation download rather than render. The viewer still shows
          // images inline because `<img>` sub-resource loads ignore both headers;
          // the PDF link, which opened a tab, now downloads instead — the safe
          // trade for not rendering attacker-controlled documents same-origin.
          reply.header(
            "content-type",
            headersObject["content-type"] ?? "application/octet-stream",
          );
          reply.header("x-content-type-options", "nosniff");
          reply.header("content-disposition", "attachment");
          reply.send(buffer);
        }
      },
    );
  };
}

export default routesWrapper;
