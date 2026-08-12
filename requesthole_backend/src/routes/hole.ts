import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";
import insertWithUniqueAddress from "../utils/unique-insert";
import RequestBroadcaster from "../RequestBroadcaster";
import { HoleParams } from "../schemas";

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: "^[a-zA-Z0-9]{6}$" },
  },
  required: ["hole_address"],
};

function routesWrapper(requestBroadcaster: RequestBroadcaster) {
  return function routes(
    fastify: FastifyInstance,
    options: RouteShorthandOptions,
  ) {
    // Prepared once per registration and reused across requests — better-sqlite3
    // statements are meant to be prepared once, not rebuilt on the hot path.
    const selectHole = fastify.db.prepare(
      "SELECT hole_address, created FROM holes WHERE hole_address = ?;",
    );
    const insertHole = fastify.db.prepare(
      "INSERT INTO holes (hole_address) VALUES (?) RETURNING created, hole_address;",
    );
    const deleteHole = fastify.db.prepare(
      "DELETE FROM holes WHERE hole_address = ?;",
    );
    const selectHoleRequests = fastify.db.prepare(
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

    fastify.post("/api/hole", options, async (_, reply) => {
      const row = insertWithUniqueAddress(generateAddress, (address) =>
        insertHole.get(address),
      );
      reply.code(201);
      reply.send([row]);
    });

    fastify.delete<{ Params: HoleParams }>(
      "/api/hole/:hole_address",
      { ...options, schema: { params } },
      async (request, reply) => {
        const { hole_address } = request.params;
        const { changes } = deleteHole.run(hole_address);
        reply.code(changes > 0 ? 204 : 404);
      },
    );

    fastify.get<{ Params: HoleParams }>(
      "/api/hole/:hole_address/requests",
      { ...options, schema: { params } },
      async (request, reply) => {
        reply.send(selectHoleRequests.all(request.params.hole_address));
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
