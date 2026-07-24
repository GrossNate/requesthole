import { FastifyInstance, RouteShorthandOptions } from "fastify";

function route(fastify: FastifyInstance, options: RouteShorthandOptions) {
  // Tie-break on the primary key: the millisecond `created` default can collide
  // for holes made in the same millisecond, and without a stable secondary sort
  // SQLite may return them in any order. Prepared once, reused per request.
  const selectHoles = fastify.db.prepare(
    "SELECT hole_address FROM holes ORDER BY created, hole_id;",
  );
  fastify.get("/api/holes", options, async (_, reply) => {
    reply.send(selectHoles.all());
  });
}

export default route;
