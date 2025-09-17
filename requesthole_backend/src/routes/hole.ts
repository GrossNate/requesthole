import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";
import RequestBroadcaster from "../RequestBroadcaster";
import { HoleParams } from "../schemas";

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: "^[a-zA-Z0-9]{5,6}$" },
  },
  required: ["hole_address"],
};

function routesWrapper(requestBroadcaster: RequestBroadcaster) {
  return function routes(
    fastify: FastifyInstance,
    options: RouteShorthandOptions,
  ) {
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
        reply.code(201);
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
          reply.code((rowCount ?? 0) > 0 ? 204 : 404);
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
              headers
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

    fastify.get<{ Params: HoleParams }>(
      "/api/hole/:hole_address/events",
      { ...options, schema: { params } },
      (request, reply) => {
        const { hole_address } = request.params;
        requestBroadcaster.addClient(hole_address, reply);
        request.socket.on("close", () => {
          reply.sse({ event: "close" });
          requestBroadcaster.deleteClient(hole_address, reply);
        });
      },
    );
  };
}

export default routesWrapper;
