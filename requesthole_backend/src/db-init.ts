import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";

export default fp(
  async (fastify: FastifyInstance) => {
    await fastify.pg.query(`
      CREATE TABLE IF NOT EXISTS holes (
        hole_id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        hole_address text NOT NULL,
        created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS requests (
        request_id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        request_address text NOT NULL,
        hole_id bigint NOT NULL REFERENCES holes (hole_id) ON DELETE CASCADE,
        created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        method text NOT NULL,
        request_path text NOT NULL,
        query_params text,
        body bytea
      );
    `);
    fastify.log.info("Database schema initialized");
  },
  { name: "db-init", dependencies: ["@fastify/postgres"] },
);
