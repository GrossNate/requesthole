import Fastify, { FastifyInstance } from "fastify";
import holesRoute from "./routes/holes";
import holeRoutes from "./routes/hole";
import collectRoute from "./routes/collect";
import requestRoutes from "./routes/request";
import configRoute from "./routes/config";
import db from "./db";
import retention from "./retention";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { FastifySSEPlugin } from "fastify-sse-v2";
import RequestBroadcaster from "./RequestBroadcaster";
import loadConfig, { ConfigOverrides } from "./config";

export interface AppOptions {
  databasePath?: string;
  /** `true` for the default logger; an object for a level and stream (tests). */
  logger?: boolean | { level?: string; stream?: { write(line: string): void } };
  requestBroadcaster?: RequestBroadcaster;
  /** Operator knobs; anything omitted falls back to the environment, then defaults. */
  config?: ConfigOverrides;
}

export default function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = loadConfig(options.config);
  const fastify = Fastify({
    logger: options.logger ?? false,
    // The only path to the backend is through our own nginx, which sets
    // X-Forwarded-For to the peer address it saw, replacing anything the
    // client sent. Without proxy trust the limiter would see nginx's address
    // for every request and lump all clients into one bucket, so the first
    // person to hit a limit would lock out everybody. Exactly one hop, not
    // `true`, as defence in depth: should a chain ever arrive, trusting every
    // hop would make the client's own leftmost entry the key.
    trustProxy: 1,
    // Deadline for receiving a whole request, headers and body. nginx streams
    // capture bodies through unbuffered, so without one a client trickling
    // bytes holds a socket and a growing buffer forever; Fastify's default is
    // no deadline. Covers receipt only, so long-lived SSE responses are
    // unaffected.
    requestTimeout: 30_000,
    // Over the limit, Fastify's own content-type parsing answers 413.
    bodyLimit: config.maxBodyBytes,
  });
  if (config.allowMedia) {
    fastify.log.info(
      "ALLOW_MEDIA on: media and binary bodies are stored and served",
    );
  }

  // Per-route budgets only: each rate-limited route attaches its own limiter;
  // reads stay unmetered. Keyed on `request.ip`, which is the forwarded
  // client address thanks to `trustProxy` above.
  fastify.register(rateLimit, { global: false });

  fastify.register(FastifySSEPlugin);
  fastify.register(cors, {
    methods: ["GET", "POST", "DELETE"],
    // The hourly limiter's 429 names its wait in Retry-After, and that is
    // how the page tells it from a share refusal. Browsers hide it from a
    // cross-origin page (the dev server) unless it is exposed.
    // The body endpoint marks a body it will not serve (ALLOW_MEDIA off) with
    // x-requesthole-body-withheld, which the viewer reads the same way.
    exposedHeaders: ["retry-after", "x-requesthole-body-withheld"],
  });
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
  fastify.register(requestRoutes(requestBroadcaster, config));
  fastify.register(configRoute(config));
  fastify.register(collectRoute(requestBroadcaster, config));

  return fastify;
}
