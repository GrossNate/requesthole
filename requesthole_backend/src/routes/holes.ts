import { FastifyInstance, RouteShorthandOptions } from "fastify";

function route(fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.get("/api/holes", options, async (_, reply) => {
    const client = await fastify.pg.connect();
    try {
      const { rows } = await client.query(`
        SELECT hole_address FROM holes ORDER BY created;
      `);
      reply.send(rows);
    } finally {
      client.release();
    }
  });
}

export default route;
