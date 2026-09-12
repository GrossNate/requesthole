import Fastify, { FastifyInstance } from "fastify";
import holesRoute from "./routes/holes";
import holeRoutes from "./routes/hole";
import collectRoute from "./routes/collect";
import requestRoutes from "./routes/request";
import db from "./db";
import retention from "./retention";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { FastifySSEPlugin } from "fastify-sse-v2";
import RequestBroadcaster from "./RequestBroadcaster";
import loadConfig, { ConfigOverrides } from "./config";

export interface AppOptions {
  databasePath?: string;
  logger?: boolean;
  requestBroadcaster?: RequestBroadcaster;
  /** Operator knobs; anything omitted falls back to the environment, then defaults. */
  config?: ConfigOverrides;
}

export default function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = loadConfig(options.config);
  const fastify = Fastify({
    logger: options.logger ?? false,
    // The only path to the backend is through our own nginx, which forwards
    // X-Forwarded-For. Without this the limiter would see nginx's address for
    // every request and lump all clients into one bucket, so the first person
    // to hit a limit would lock out everybody.
    trustProxy: true,
    // Over the limit, Fastify's own content-type parsing answers 413.
    bodyLimit: config.maxBodyBytes,
  });

  // Per-route budgets only: each rate-limited route declares its own
  // `config.rateLimit`; reads stay unmetered. Keyed on `request.ip`, which
  // is the forwarded client address thanks to `trustProxy` above.
  fastify.register(rateLimit, { global: false });

  fastify.register(FastifySSEPlugin);
  fastify.register(cors, { methods: ["GET", "POST", "DELETE"] });
  fastify.register(
    db,
    options.databasePath !== undefined
      ? { databasePath: options.databasePath }
      : {},
  );

  const requestBroadcaster =
    options.requestBroadcaster ?? new RequestBroadcaster();
  fastify.register(retention, { config, requestBroadcaster });
  fastify.register(holesRoute);
  fastify.register(holeRoutes(requestBroadcaster, config));
  fastify.register(requestRoutes(requestBroadcaster));
  fastify.register(collectRoute(requestBroadcaster, config));

  return fastify;
}
