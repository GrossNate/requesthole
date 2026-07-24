import Fastify, { FastifyInstance } from "fastify";
import holesRoute from "./routes/holes";
import holeRoutes from "./routes/hole";
import collectRoute from "./routes/collect";
import requestRoutes from "./routes/request";
import db from "./db";
import cors from "@fastify/cors";
import { FastifySSEPlugin } from "fastify-sse-v2";
import RequestBroadcaster from "./RequestBroadcaster";

export interface AppOptions {
  databasePath?: string;
  logger?: boolean;
  requestBroadcaster?: RequestBroadcaster;
}

export default function buildApp(options: AppOptions = {}): FastifyInstance {
  const fastify = Fastify({
    logger: options.logger ?? false,
  });

  fastify.register(FastifySSEPlugin);
  fastify.register(cors, { methods: ["GET", "POST", "DELETE"] });
  fastify.register(db,
    options.databasePath !== undefined
      ? { databasePath: options.databasePath }
      : {});

  const requestBroadcaster =
    options.requestBroadcaster ?? new RequestBroadcaster();
  fastify.register(holesRoute);
  fastify.register(holeRoutes(requestBroadcaster));
  fastify.register(requestRoutes);
  fastify.register(collectRoute(requestBroadcaster));

  return fastify;
}
