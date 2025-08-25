import Fastify from "fastify";
import fastifyPostgres from "@fastify/postgres";
import holesRoute from "./routes/holes";
import holeRoutes from "./routes/hole";
import collectRoute from "./routes/collect";
import dbInit from "./db-init";

const fastify = Fastify({
  logger: true,
});
fastify.register(fastifyPostgres, {
  connectionString: process.env.POSTGRES_URI,
});
fastify.register(dbInit);

fastify.register(holesRoute);
fastify.register(holeRoutes);
fastify.register(collectRoute);

fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
