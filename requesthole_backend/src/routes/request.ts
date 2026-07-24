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
          body: Buffer | string;
          headers: string;
        };
        const buffer = body instanceof Buffer ? body : Buffer.from(body);
        const headersObject = JSON.parse(headers) as Partial<{
          "content-type": string;
        }>;
        reply.header("content-type", headersObject["content-type"]);
        reply.send(buffer);
      }
    },
  );
}

export default routes;
