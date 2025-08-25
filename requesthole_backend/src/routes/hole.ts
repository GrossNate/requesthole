import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";

interface HoleParams {
  hole_address: string;
}

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: "^[a-zA-Z0-9]{5,6}$" },
  },
  required: ["hole_address"],
};

function routes(fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.get<{ Params: HoleParams }>(
    "/api/hole/:hole_address",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { hole_address } = request.params;
      const client = await fastify.pg.connect();
      try {
        const { rows } = await client.query(
          "SELECT hole_address, created FROM holes WHERE hole_address = $1;",
          [hole_address],
        );
        reply.send(rows);
      } finally {
        client.release();
      }
    },
  );

  fastify.post("/api/hole", options, async (_, reply) => {
    const client = await fastify.pg.connect();
    try {
      const { rows } = await client.query(
        "INSERT INTO holes (hole_address) VALUES ($1) RETURNING created, hole_address;",
        [generateAddress()],
      );
      reply.send(rows);
    } finally {
      client.release();
    }
  });

  fastify.delete<{ Params: HoleParams }>(
    "/api/hole/:hole_address",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { hole_address } = request.params;
      const client = await fastify.pg.connect();
      try {
        const { rowCount } = await client.query(
          "DELETE FROM holes WHERE hole_address = $1;",
          [hole_address],
        );
        reply.code(((rowCount ?? 0) > 0) ? 204 : 404);
      } finally {
        client.release();
      }
    },
  );

  fastify.get<{ Params: HoleParams }>(
    "/api/hole/:hole_address/requests",
    { ...options, schema: { params } },
    async (request, reply) => {
      const { hole_address } = request.params;
      const client = await fastify.pg.connect();
      try {
        const { rows } = await client.query(
          `
            SELECT
              request_address,
              r.created,
              method,
              request_path,
              query_params,
              headers,
              body
            FROM holes AS h
            INNER JOIN requests AS r USING (hole_id)
            WHERE hole_address = $1
          `,
          [hole_address],
        );
        reply.send(rows);
      } finally {
        client.release();
      }
    },
  );
}

export default routes;
