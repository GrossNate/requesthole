import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import RequestBroadcaster from "../RequestBroadcaster";
import { Config } from "../config";
import { filterBody, FilterHeaders } from "../body-filter";

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

function routesWrapper(
  requestBroadcaster: RequestBroadcaster,
  config: Pick<Config, "allowMedia">,
) {
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
        headers,
        body_dropped
      FROM requests
      WHERE request_address = ?
    `,
    );
    const selectRequestBody = fastify.db.prepare(
      `SELECT headers, body, body_checked FROM requests
       WHERE request_address = ?`,
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
          const { body, headers, body_checked } = row as {
            body: Buffer | string | null;
            headers: string;
            body_checked: number | null;
          };
          const buffer =
            body === null
              ? Buffer.alloc(0)
              : body instanceof Buffer
                ? body
                : Buffer.from(body);
          const headersObject = JSON.parse(headers) as FilterHeaders;
          // Serve captured bodies inertly. The stored content is untrusted, so
          // a stored `<script>` must never execute on this origin: `nosniff`
          // stops the browser inferring an executable type, and `attachment`
          // makes direct navigation download rather than render.
          reply.header("x-content-type-options", "nosniff");
          reply.header("content-disposition", "attachment");

          if (!config.allowMedia) {
            // Rows captured while media was on (or before the gate existed)
            // stay until the retention sweep, and must not be served, so the
            // filter runs again for them. A row the gate already checked at
            // capture is served as stored: re-running it on every unmetered
            // read would let one costly stored form tie up the server.
            // Every body goes out as plain text, whatever the sender claimed,
            // and CORP stops other origins embedding it as an image.
            reply.header("content-type", "text/plain; charset=utf-8");
            reply.header("cross-origin-resource-policy", "same-origin");
            const filtered =
              body_checked === 1
                ? { body: buffer, dropped: null }
                : filterBody(buffer, headersObject);
            if (
              filtered.dropped !== null ||
              !buffer.equals(filtered.body ?? Buffer.alloc(0))
            ) {
              reply.header("x-requesthole-body-withheld", "true");
              reply.send(Buffer.alloc(0));
              return;
            }
            reply.send(buffer);
            return;
          }

          // Media on, the sender's type is kept so the viewer can show images
          // inline: `<img>` sub-resource loads ignore both headers above.
          const contentType = headersObject["content-type"];
          reply.header(
            "content-type",
            typeof contentType === "string"
              ? contentType
              : "application/octet-stream",
          );
          reply.send(buffer);
        }
      },
    );
  };
}

export default routesWrapper;
