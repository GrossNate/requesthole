import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { JSONSchemaType } from "ajv";
import generateAddress from "../utils/address-generator";
import insertWithUniqueAddress from "../utils/unique-insert";
import RequestBroadcaster from "../RequestBroadcaster";
import RequestSansBody from "../schemas";

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
        const hole = fastify.db
          .prepare("SELECT hole_id FROM holes WHERE hole_address = ?")
          .get(hole_address) as { hole_id: number } | undefined;
        if (!hole) {
          reply.code(404);
        } else {
          const insert = fastify.db.prepare(
            `
              INSERT INTO requests
                (hole_id, request_address, method, request_path, query_params,
                  headers, body)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
          );
          const newRequestAddress = insertWithUniqueAddress(
            generateAddress,
            (address) => {
              insert.run(
                hole.hole_id,
                address,
                request.method,
                request.url,
                JSON.stringify(request.query),
                JSON.stringify(request.headers),
                (request.body as Buffer | undefined) ?? null,
              );
              return address;
            },
          );
          const row = fastify.db
            .prepare(
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
            )
            .get(newRequestAddress);
          const parseResult = RequestSansBody.safeParse(row);
          if (!parseResult.success) {
            fastify.log.error(parseResult.error);
          } else {
            requestBroadcaster.broadcastRequest(hole_address, parseResult.data);
          }
          reply.code(200);
        }
      },
    );
  };
}

export default routesWrapper;
