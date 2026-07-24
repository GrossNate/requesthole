import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";

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

function routes(fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.delete<{ Params: RequestParams }>(
    "/api/request/:request_address",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { request_address } = request.params;
      const { changes } = fastify.db
        .prepare("DELETE FROM requests WHERE request_address = ?;")
        .run(request_address);
      reply.code(changes > 0 ? 204 : 404);
    },
  );

  fastify.get<{ Params: RequestParams }>(
    "/api/request/:request_address",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { request_address } = request.params;
      const row = fastify.db
        .prepare(
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
        )
        .get(request_address);
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
      const { request_address } = request.params;
      const row = fastify.db
        .prepare(
          `SELECT headers, body FROM requests WHERE request_address = ?`,
        )
        .get(request_address);
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
        // direct navigation download rather than render. The viewer still
        // renders images because `<img>` sub-resource loads ignore both.
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
}

export default routes;
