import Fastify from "fastify";
import fastifyPostgres from "@fastify/postgres";
import holesRoute from "./routes/holes";
import holeRoutes from "./routes/hole";
import collectRoute from "./routes/collect";
import requestRoutes from "./routes/request";
import dbInit from "./db-init";
import cors from "@fastify/cors";
import { FastifySSEPlugin } from "fastify-sse-v2";
import RequestBroadcaster from "./RequestBroadcaster";


const fastify = Fastify({
  logger: true,
});

fastify.register(FastifySSEPlugin);
fastify.register(cors, { methods: ["GET", "POST", "DELETE"] });
fastify.register(fastifyPostgres, {
  connectionString: process.env.POSTGRES_URI,
});
fastify.register(dbInit);

const requestBroadcaster = new RequestBroadcaster();
fastify.register(holesRoute);
fastify.register(holeRoutes(requestBroadcaster));
fastify.register(requestRoutes);
fastify.register(collectRoute(requestBroadcaster));

fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
