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
    // The cutoff is computed once per sweep, in SQL rather than JS dates: a
    // retention longer than the calendar comes back NULL, which matches no
    // hole, where `Date#toISOString` would throw.
    const selectCutoff = fastify.db.prepare(
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) AS cutoff",
    );
    const modifier = `-${options.config.retentionDays} days`;

    const sweepExpiredHoles = () => {
      const { cutoff } = selectCutoff.get(modifier) as {
        cutoff: string | null;
      };
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
