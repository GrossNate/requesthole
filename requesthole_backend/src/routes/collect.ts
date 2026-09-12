import {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteHandlerMethod,
  RouteShorthandOptions,
} from "fastify";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";
import insertWithUniqueAddress from "../utils/unique-insert";
import RequestBroadcaster from "../RequestBroadcaster";
import RequestSansBody from "../schemas";
import { Config } from "../config";

interface HoleParams {
  hole_address: string;
}

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: "^[a-zA-Z0-9]{6}$" },
  },
  required: ["hole_address"],
};

function routesWrapper(
  requestBroadcaster: RequestBroadcaster,
  config: Pick<Config, "maxRequestsPerHole" | "captureRateLimit">,
) {
  return function routes(
    fastify: FastifyInstance,
    options: RouteShorthandOptions,
  ) {
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser(
      "*",
      { parseAs: "buffer" },
      (_, body, done) => {
        done(null, body);
      },
    );

    // Prepared once per registration and reused across requests — this is the
    // hot capture path, so rebuilding the statements per request is wasteful.
    const selectHoleId = fastify.db.prepare(
      "SELECT hole_id FROM holes WHERE hole_address = ?",
    );
    const insertRequest = fastify.db.prepare(
      `
        INSERT INTO requests
          (hole_id, request_address, method, request_path, query_params,
            headers, body)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // Trims the hole back to its cap right after every capture, in the same
    // transaction as the insert, so the table is bounded continuously rather
    // than between sweeps. Oldest first by insertion order; the millisecond
    // `created` default can tie, so the primary key breaks the tie.
    const trimHole = fastify.db.prepare(
      `
        DELETE FROM requests
        WHERE request_id IN (
          SELECT request_id FROM requests
          WHERE hole_id = ?
          ORDER BY created DESC, request_id DESC
          LIMIT -1 OFFSET ?
        )
        RETURNING request_address`,
    );
    const captureAndTrim = fastify.db.transaction(
      (holeId: number, address: string, ...values: unknown[]) => {
        insertRequest.run(holeId, address, ...values);
        return (
          trimHole.all(holeId, config.maxRequestsPerHole) as {
            request_address: string;
          }[]
        ).map((row) => row.request_address);
      },
    );
    const selectCapturedRequest = fastify.db.prepare(
      `
        SELECT
          request_address,
          created,
          method,
          request_path,
          query_params,
          headers
        FROM requests
        WHERE request_address = ?
      `,
    );

    const collect: RouteHandlerMethod<
      RawServerDefault,
      RawRequestDefaultExpression,
      RawReplyDefaultExpression,
      { Params: HoleParams }
    > = async (request, reply) => {
      fastify.log.info("called collection route");
      const { hole_address } = request.params;
      const hole = selectHoleId.get(hole_address) as
        | { hole_id: number }
        | undefined;
      if (!hole) {
        reply.code(404);
      } else {
        let evicted: string[] = [];
        const newRequestAddress = insertWithUniqueAddress(
          generateAddress,
          (address) => {
            evicted = captureAndTrim(
              hole.hole_id,
              address,
              request.method,
              // The full URL as sent, sub-path and query string included.
              request.url,
              JSON.stringify(request.query),
              JSON.stringify(request.headers),
              (request.body as Buffer | undefined) ?? null,
            );
            return address;
          },
        );
        const row = selectCapturedRequest.get(newRequestAddress);
        const parseResult = RequestSansBody.safeParse(row);
        if (!parseResult.success) {
          fastify.log.error(parseResult.error);
        } else {
          requestBroadcaster.broadcastRequest(hole_address, parseResult.data);
        }
        // Evictions are announced after the capture that caused them, so a
        // viewer sees the new row arrive before the oldest one goes.
        for (const address of evicted) {
          requestBroadcaster.broadcastDelete(hole_address, address);
        }
        reply.code(200);
      }
    };

    // One limiter, built once and attached to both routes below. A per-route
    // `config.rateLimit` would give each route its own store, and so a client
    // double the documented budget by alternating the bare address and a
    // sub-path. Run as a preHandler, after validation, so a stray path that
    // fails the address pattern is never metered against captures.
    const limitCaptures = fastify.rateLimit({
      max: config.captureRateLimit,
      timeWindow: "1 minute",
    });

    // The bare address and anything beneath it: webhook configs get pasted
    // with sub-paths (`/abc123/webhook`), and those must land in the same
    // hole. `/api/*` routes are static and so win over the parametric
    // wildcard in Fastify's router — but the wildcard is now the catch-all
    // for any unknown multi-segment path, and those should read as not
    // found, not as a malformed address.
    for (const url of ["/:hole_address", "/:hole_address/*"]) {
      fastify.all<{ Params: HoleParams }>(
        url,
        {
          ...options,
          schema: { params },
          // Callback form rather than async: the route-options type accepts
          // both, and the lint rule against promise-valued properties cannot
          // tell. The limiter is itself a Fastify hook and wants the instance
          // as `this`.
          preHandler: (request, reply, done) => {
            limitCaptures
              .call(fastify, request, reply)
              .then(() => done(), done);
          },
          errorHandler: (error, _request, reply) => {
            if (error.validation) {
              reply.code(404);
              reply.send();
              return;
            }
            reply.send(error);
          },
        },
        collect,
      );
    }
  };
}

export default routesWrapper;
