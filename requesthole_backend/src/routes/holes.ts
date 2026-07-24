import { FastifyInstance, RouteShorthandOptions } from "fastify";

function route(fastify: FastifyInstance, options: RouteShorthandOptions) {
  fastify.get("/api/holes", options, async (_, reply) => {
    const rows = fastify.db
      .prepare(
        // Tie-break on the primary key: the millisecond `created` default can
        // collide for holes made in the same millisecond, and without a stable
        // secondary sort SQLite may return them in any order.
        "SELECT hole_address FROM holes ORDER BY created, hole_id;",
      )
      .all();
    reply.send(rows);
  });
}

export default route;
