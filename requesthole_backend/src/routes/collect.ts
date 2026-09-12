import {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteHandlerMethod,
  onRequestHookHandler,
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

// One definition for the schema below and the limiter's own check, which
// runs before validation and so has to test the address itself.
const ADDRESS_PATTERN = "^[a-zA-Z0-9]{6}$";
const ADDRESS = new RegExp(ADDRESS_PATTERN);
const isAddress = (value: string) => ADDRESS.test(value);

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: ADDRESS_PATTERN },
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
    // could double the documented budget by alternating the bare address and
    // a sub-path.
    const limitCaptures = fastify.rateLimit({
      max: config.captureRateLimit,
      timeWindow: "1 minute",
    });

    // At `onRequest`, before the body is read: an over-budget client is
    // turned away without its payload being buffered, and a body too big to
    // parse still counts against the budget. Validation has not run yet, so
    // a stray path that is not an address skips the limiter here instead.
    // Callback form rather than async: the lint rule against promise-valued
    // properties cannot tell the two apart. The limiter wants the instance as
    // `this`.
    const meterCapture: onRequestHookHandler<
      RawServerDefault,
      RawRequestDefaultExpression,
      RawReplyDefaultExpression,
      { Params: HoleParams }
    > = (request, reply, done) => {
      if (!isAddress(request.params.hole_address)) {
        done();
        return;
      }
      limitCaptures.call(fastify, request, reply).then(() => done(), done);
    };

    // The bare address: a malformed one is a bad request, as it always was.
    fastify.all<{ Params: HoleParams }>(
      "/:hole_address",
      { ...options, schema: { params }, onRequest: meterCapture },
      collect,
    );

    // Anything beneath an address: webhook configs get pasted with sub-paths
    // (`/abc123/webhook`), and those must land in the same hole. `/api/*`
    // routes are static and so win over this wildcard in Fastify's router,
    // but it is now the catch-all for every unknown multi-segment path. Those
    // are not malformed addresses, they are paths that do not exist: 404.
    fastify.all<{ Params: HoleParams }>(
      "/:hole_address/*",
      {
        ...options,
        schema: { params },
        onRequest: meterCapture,
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
  };
}

export default routesWrapper;
