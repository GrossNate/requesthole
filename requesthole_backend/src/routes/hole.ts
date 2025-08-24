import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import { v4 } from "uuid";
import { crc32 } from "node:zlib";
import base62 from "base62";

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
      const uuid = v4();
      const holeAddress = base62.encode(crc32(uuid));
      const { rows } = await client.query(
        "INSERT INTO holes (hole_address) VALUES ($1) RETURNING created, hole_address;",
        [holeAddress],
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
        reply.code((rowCount ?? 0 > 0) ? 204 : 404);
      } finally {
        client.release();
      }
    },
  );
}

export default routes;
