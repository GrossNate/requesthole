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
import { filterBody } from "../body-filter";

interface HoleParams {
  hole_address: string;
}

// One definition for the schema below and the limiter's own check, which
// runs before validation and so has to test the address itself.
const ADDRESS_PATTERN = "^[a-zA-Z0-9]{6}$";
const ADDRESS = new RegExp(ADDRESS_PATTERN);
const isAddress = (value: string) => ADDRESS.test(value);

// Decodes `%XX` escapes one by one rather than with `decodeURIComponent`,
// which throws on the first malformed escape; a fallback to the raw path
// would switch the check off for `..%2Fapi/x%zz`. Fastify refuses malformed
// escapes with 400 before routing today, so this is defence in depth, not
// the only guard. Byte-wise decoding garbles multi-byte characters, but only
// `.` and `/` matter here, and those are single bytes.
const decodeEscapes = (path: string) =>
  path.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

// Decoded first, then split: nginx turns `%2F` into a separator before it
// resolves dot segments, so `..%2Fapi` is a dot segment by the time nginx
// picks a location. Only `/` counts: nginx on Linux does not treat `\` as a
// separator, so `..\api` stays in the collect location as one segment and is
// a real capture.
const hasDotSegment = (url: string) =>
  decodeEscapes(url.split("?", 1)[0] ?? "")
    .split("/")
    .some((segment) => segment === "." || segment === "..");

// Every value of every header, names lowercased. Node's parsed headers keep
// only the first of a repeated Content-Type, so the raw list is the source.
const headersAsSent = (rawHeaders: string[]) => {
  const headers: Record<string, string[]> = {};
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    (headers[rawHeaders[i]!.toLowerCase()] ??= []).push(rawHeaders[i + 1]!);
  }
  return headers;
};

const params: JSONSchemaType<HoleParams> = {
  type: "object",
  properties: {
    hole_address: { type: "string", pattern: ADDRESS_PATTERN },
  },
  required: ["hole_address"],
};

function routesWrapper(
  requestBroadcaster: RequestBroadcaster,
  config: Pick<
    Config,
    "maxRequestsPerHole" | "captureRateLimit" | "allowMedia"
  >,
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
            headers, body, body_dropped, body_checked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Trims the hole back to its cap right after every capture, in the same
    // transaction as the insert, so the table is bounded continuously rather
    // than between sweeps. Oldest first by arrival, which is the primary key:
    // `created` is wall-clock time, and a clock stepping back would make the
    // newest capture look oldest and evict it in the transaction that stored
    // it, while the sender got a 200.
    const trimHole = fastify.db.prepare(
      `
        DELETE FROM requests
        WHERE request_id IN (
          SELECT request_id FROM requests
          WHERE hole_id = ?
          ORDER BY request_id DESC
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
          headers,
          body_dropped
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
        const received = (request.body as Buffer | undefined) ?? null;
        // Media off, the filter decides what is stored. It reads the headers
        // as sent: Node keeps only the first of a repeated Content-Type, and
        // a repeat is itself grounds to drop.
        const { body, dropped } = config.allowMedia
          ? { body: received, dropped: null }
          : filterBody(received, headersAsSent(request.raw.rawHeaders));
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
              body,
              dropped === null ? null : JSON.stringify(dropped),
              config.allowMedia ? null : 1,
            );
            return address;
          },
        );
        if (dropped !== null) {
          // Enough for an operator to spot file-hosting attempts; never any
          // content, and names and filenames stay out of the log.
          fastify.log.info(
            {
              hole: hole_address,
              request: newRequestAddress,
              contentType: request.headers["content-type"] ?? null,
              bytes: received?.length ?? 0,
              reason:
                "reason" in dropped
                  ? dropped.reason
                  : dropped.parts.map((part) => part.reason).join(","),
            },
            "dropped body",
          );
        }
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
      // A `.` or `..` segment is never a capture, whether written raw, as
      // `%2e`, or beside an encoded slash (`..%2F`).
      // nginx normalizes `/abc123/../api/x` to `/api/x` to choose a location,
      // then forwards the raw path, which Fastify does not normalize: such a
      // request would land in this hole by way of nginx's `/api/` location,
      // around every upload cap on the collect location.
      if (hasDotSegment(request.url)) {
        reply.code(404);
        reply.send();
        return;
      }
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
