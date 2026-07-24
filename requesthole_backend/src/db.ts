import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import initSchema from "./db-init";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
  }
}

export interface DbOptions {
  databasePath?: string;
}

export default fp(
  (fastify: FastifyInstance, options: DbOptions, done: () => void) => {
    const databasePath =
      options.databasePath ?? process.env.DATABASE_PATH ?? "";
    if (databasePath === "") {
      throw new Error("DATABASE_PATH is not set");
    }
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    const db = new Database(databasePath);
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    initSchema(db);
    fastify.log.info("Database schema initialized");
    fastify.decorate("db", db);
    fastify.addHook("onClose", () => {
      db.close();
    });
    done();
  },
  { name: "db" },
);
