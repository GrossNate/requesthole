import Fastify from "fastify";
import fastifyPostgres from "@fastify/postgres";
import holesRoute from "./routes/holes";
import holeRoutes from "./routes/hole";
import collectRoute from "./routes/collect";
import requestRoutes from "./routes/request";
import dbInit from "./db-init";
import cors from "@fastify/cors";

const fastify = Fastify({
  logger: true,
});

fastify.register(cors, { methods: ["GET", "POST", "DELETE"] });
fastify.register(fastifyPostgres, {
  connectionString: process.env.POSTGRES_URI,
});
fastify.register(dbInit);

fastify.register(holesRoute);
fastify.register(holeRoutes);
fastify.register(requestRoutes);
fastify.register(collectRoute);

fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
