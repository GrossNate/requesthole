import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { Config } from "./config";
import RequestBroadcaster from "./RequestBroadcaster";
import prepareHoleRemoval from "./hole-removal";

declare module "fastify" {
  interface FastifyInstance {
    /** Deletes every hole older than the retention TTL. Requests cascade. */
    sweepExpiredHoles: () => number;
  }
}

export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface RetentionOptions {
  config: Pick<Config, "retentionDays">;
  requestBroadcaster: RequestBroadcaster;
}

/**
 * Age-based retention. A sweep at startup and then an hourly timer delete
 * holes past the TTL; their requests go with them through `ON DELETE CASCADE`
 * (the db plugin turns `foreign_keys` on). The timer is unref'd and cleared
 * on close so it never keeps a process, or the test runner, alive.
 */
export default fp(
  (fastify: FastifyInstance, options: RetentionOptions, done: () => void) => {
    const removeOlderThan = prepareHoleRemoval(
      fastify.db,
      options.requestBroadcaster,
      "holes.created < ?",
    );
    const ttlMs = options.config.retentionDays * 24 * 60 * 60 * 1000;

    const sweepExpiredHoles = () => {
      // One cutoff, computed here and bound to both statements inside the
      // removal, so the listing and the delete agree on which holes are
      // expired. `toISOString` matches the column's `%Y-%m-%dT%H:%M:%fZ`
      // format, so the comparison is a plain string compare.
      const cutoff = new Date(Date.now() - ttlMs).toISOString();
      const changes = removeOlderThan(cutoff);
      if (changes > 0) {
        fastify.log.info({ holes: changes }, "swept expired holes");
      }
      return changes;
    };

    fastify.decorate("sweepExpiredHoles", sweepExpiredHoles);
    // Once at startup as well: an interval alone resets on every boot, so a
    // process restarted more often than hourly would never sweep at all.
    fastify.addHook("onReady", () => {
      sweepExpiredHoles();
    });
    const timer = setInterval(sweepExpiredHoles, SWEEP_INTERVAL_MS);
    timer.unref();
    fastify.addHook("onClose", () => {
      clearInterval(timer);
    });
    done();
  },
  { name: "retention", dependencies: ["db"] },
);
