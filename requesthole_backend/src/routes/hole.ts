import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { normalizeIP } from "@fastify/rate-limit";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";
import insertWithUniqueAddress from "../utils/unique-insert";
import RequestBroadcaster from "../RequestBroadcaster";
import { HoleParams } from "../schemas";
import { Config } from "../config";
import prepareHoleRemoval from "../hole-removal";

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: "^[a-zA-Z0-9]{6}$" },
  },
  required: ["hole_address"],
};

function routesWrapper(
  requestBroadcaster: RequestBroadcaster,
  config: Pick<Config, "holeCreateRateLimit" | "maxHoles" | "maxHolesPerIp">,
) {
  return function routes(
    fastify: FastifyInstance,
    options: RouteShorthandOptions,
  ) {
    // Prepared once per registration and reused across requests — better-sqlite3
    // statements are meant to be prepared once, not rebuilt on the hot path.
    const selectHole = fastify.db.prepare(
      "SELECT hole_address, created FROM holes WHERE hole_address = ?;",
    );
    const holeExists = fastify.db.prepare(
      "SELECT 1 FROM holes WHERE hole_address = ?;",
    );
    // The creator is stored but deliberately left out of RETURNING: nothing
    // any route sends back names who made a hole.
    const insertHole = fastify.db.prepare(
      "INSERT INTO holes (hole_address, creator_ip) VALUES (?, ?) RETURNING created, hole_address;",
    );
    const countHoles = fastify.db.prepare("SELECT COUNT(*) AS n FROM holes;");
    const countHolesFrom = fastify.db.prepare(
      "SELECT COUNT(*) AS n FROM holes WHERE creator_ip = ?;",
    );
    const removeHole = prepareHoleRemoval(
      fastify.db,
      requestBroadcaster,
      "holes.hole_address = ?",
    );
    const selectHoleRequests = fastify.db.prepare(
      `
      SELECT
        request_address,
        r.created,
        method,
        request_path,
        query_params,
        headers,
        body_dropped
      FROM holes AS h
      INNER JOIN requests AS r USING (hole_id)
      WHERE hole_address = ?
      ORDER BY r.created, r.request_id
    `,
    );

    fastify.get<{ Params: HoleParams }>(
      "/api/hole/:hole_address",
      { ...options, schema: { params } },
      async (request, reply) => {
        const { hole_address } = request.params;
        reply.send(selectHole.all(hole_address));
      },
    );

    fastify.post(
      "/api/hole",
      {
        ...options,
        config: {
          rateLimit: { max: config.holeCreateRateLimit, timeWindow: "1 hour" },
        },
      },
      async (request, reply) => {
        // Keyed exactly as the rate limiter keys this client: IPv4 as is,
        // IPv6 grouped by /64, so one subscriber is one client for both.
        const creator = normalizeIP(request.ip);
        // A client at its share is refused before the global ceiling is
        // even consulted: the failure lands on the one holding the most.
        // Bare statuses, like every other error in this API. Read-then-insert
        // is safe because better-sqlite3 is synchronous on one connection, so
        // no other creation can interleave between the counts and the insert.
        const mine = (countHolesFrom.get(creator) as { n: number }).n;
        if (mine >= config.maxHolesPerIp) {
          reply.code(429);
          return;
        }
        // At the ceiling nothing is evicted to make room: no one's live hole
        // disappears underneath them.
        const { n } = countHoles.get() as { n: number };
        if (n >= config.maxHoles) {
          reply.code(503);
          return;
        }
        const row = insertWithUniqueAddress(generateAddress, (address) =>
          insertHole.get(address, creator),
        );
        reply.code(201);
        reply.send([row]);
      },
    );

    fastify.delete<{ Params: HoleParams }>(
      "/api/hole/:hole_address",
      { ...options, schema: { params } },
      async (request, reply) => {
        const { hole_address } = request.params;
        const changes = removeHole(hole_address);
        reply.code(changes > 0 ? 204 : 404);
      },
    );

    fastify.get<{ Params: HoleParams }>(
      "/api/hole/:hole_address/requests",
      { ...options, schema: { params } },
      async (request, reply) => {
        const { hole_address } = request.params;
        // A missing hole is not an empty one. A viewer that reconnects after
        // its hole was swept or deleted has to be able to tell the two apart,
        // or it shows an empty, still-Live hole that no capture can reach.
        if (!holeExists.get(hole_address)) {
          reply.code(404);
          return;
        }
        reply.send(selectHoleRequests.all(hole_address));
      },
    );

    fastify.get<{ Params: HoleParams }>(
      "/api/hole/:hole_address/events",
      { ...options, schema: { params } },
      (request, reply) => {
        const { hole_address } = request.params;
        requestBroadcaster.addClient(hole_address, reply);
        // Attached before anything is written, so reclamation never depends on
        // how much happens first. Every subscriber leaves through here.
        request.socket.on("close", () => {
          reply.sse({ event: "close" });
          requestBroadcaster.deleteClient(hole_address, reply);
        });
        // Flushes the response headers straight away, which is what makes a
        // browser's EventSource report the stream as open. Without it the
        // headers wait for the first capture, and a live stream is
        // indistinguishable from one that never connected.
        //
        // Named `stream-open` rather than `open`: EventSource has a built-in
        // event of that name, and a frame naming it would be dispatched to
        // `onopen`'s listeners the moment it carried a `data` field — a second
        // open per connection, which queues another snapshot and arms another
        // settle timer. Nothing here should depend on the frame staying empty.
        reply.sse({ event: "stream-open" });
      },
    );
  };
}

export default routesWrapper;
