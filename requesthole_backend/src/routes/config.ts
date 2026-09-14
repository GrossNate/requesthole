import { FastifyInstance } from "fastify";
import { Config } from "../config";

/**
 * What the viewer needs to know about this instance. A viewer that cannot
 * fetch it behaves as if media were off, so a missing answer stays safe.
 */
function routesWrapper(config: Pick<Config, "allowMedia">) {
  return function routes(fastify: FastifyInstance) {
    fastify.get("/api/config", (_, reply) => {
      reply.send({ allowMedia: config.allowMedia });
    });
  };
}

export default routesWrapper;
