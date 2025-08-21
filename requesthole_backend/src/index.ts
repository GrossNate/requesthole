import Fastify from "fastify";
import holesRoute from "./holes";

const fastify = Fastify({
  logger: true,
});

fastify.register(holesRoute);

fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
