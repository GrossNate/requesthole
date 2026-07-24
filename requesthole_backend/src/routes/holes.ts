import { FastifyInstance, RouteShorthandOptions } from "fastify";

function route(fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.get("/api/holes", options, async (_, reply) => {
    const rows = fastify.db
      .prepare("SELECT hole_address FROM holes ORDER BY created;")
      .all();
    reply.send(rows);
  });
}

export default route;
