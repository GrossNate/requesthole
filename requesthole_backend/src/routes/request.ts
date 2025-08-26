import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";

interface RequestParams {
  request_address: string;
}

const params: JSONSchemaType<RequestParams> = {
  type: "object",
  properties: {
    request_address: { type: "string", pattern: "^[a-zA-Z0-9]{5,6}$" },
  },
  required: ["request_address"],
};

function routes(fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.delete<{ Params: RequestParams }>(
    "/api/request/:request_address",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { request_address } = request.params;
      const client = await fastify.pg.connect();
      try {
        const { rowCount } = await client.query(
          "DELETE FROM requests WHERE request_address = $1;",
          [request_address],
        );
        reply.code((rowCount ?? 0) > 0 ? 204 : 404);
      } finally {
        client.release();
      }
    },
  );

  fastify.get<{ Params: RequestParams }>(
    "/api/request/:request_address",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { request_address } = request.params;
      const client = await fastify.pg.connect();
      try {
        const { rows } = await client.query(
          `
            SELECT
              request_address,
              created,
              method,
              request_path,
              query_params,
              headers,
              body
            FROM requests
            WHERE request_address = $1
          `,
          [request_address],
        );
        if (rows.length < 1) {
          reply.code(404);
        } else {
          reply.send(rows);
        }
      } finally {
        client.release();
      }
    },
  );
}

export default routes;
