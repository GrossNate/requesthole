import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";
import RequestBroadcaster from "../RequestBroadcaster";
import RequestSansBody from "../schemas";

interface HoleParams {
  hole_address: string;
}

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
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser(
      "*",
      { parseAs: "buffer" },
      (_, body, done) => {
        done(null, body);
      },
    );

    fastify.all<{ Params: HoleParams }>(
      "/:hole_address",
      { ...options, schema: { params } },
      async (request, reply) => {
        fastify.log.info("called collection route");
        const { hole_address } = request.params;
        const client = await fastify.pg.connect();
        try {
          const result = await client.query<{ hole_id: string }>(
            "SELECT hole_id FROM holes WHERE hole_address = $1",
            [hole_address],
          );
          if (!result.rows[0] || (result.rowCount && result.rowCount < 1)) {
            reply.code(404);
          } else {
            const newRequestAddress = generateAddress();
            await client.query(
              `
              INSERT INTO requests
                (hole_id, request_address, method, request_path, query_params,
                  headers, body)
              VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                result.rows[0].hole_id,
                newRequestAddress,
                request.method,
                request.url,
                request.params,
                request.headers,
                request.body,
              ],
            );
            const { rows } = await client.query(
              `
                SELECT
                  request_address,
                  created,
                  method,
                  request_path,
                  query_params,
                  headers
                FROM requests
                WHERE request_address = $1
              `,
              [newRequestAddress],
            );
            const parseResult = RequestSansBody.safeParse(rows[0]);
            if (!parseResult.success) {
              fastify.log.error(parseResult.error);
            } else {
              requestBroadcaster.broadcastRequest(
                hole_address,
                parseResult.data,
              );
            }
            reply.code(200);
          }
        } finally {
          client.release();
        }
      },
    );
  };
}

export default routesWrapper;
