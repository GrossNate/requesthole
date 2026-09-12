import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { Config } from "./config";
import RequestBroadcaster from "./RequestBroadcaster";

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
 * Age-based retention. An hourly timer deletes holes past the TTL; their
 * requests go with them through `ON DELETE CASCADE` (the db plugin turns
 * `foreign_keys` on). The timer is unref'd and cleared on close so it never
 * keeps a process, or the test runner, alive.
 */
export default fp(
  (fastify: FastifyInstance, options: RetentionOptions, done: () => void) => {
    const cutoff = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)";
    // Listed before the delete: the cascade takes the rows silently, and a
    // viewer of a swept hole still needs to hear that its requests are gone.
    const selectDoomedRequests = fastify.db.prepare(
      `SELECT h.hole_address, r.request_address
       FROM requests AS r INNER JOIN holes AS h USING (hole_id)
       WHERE h.created < ${cutoff}
       ORDER BY r.created, r.request_id`,
    );
    const deleteExpired = fastify.db.prepare(
      `DELETE FROM holes WHERE created < ${cutoff}`,
    );
    const modifier = `-${options.config.retentionDays} days`;
    const sweep = fastify.db.transaction(() => {
      const doomed = selectDoomedRequests.all(modifier) as {
        hole_address: string;
        request_address: string;
      }[];
      const { changes } = deleteExpired.run(modifier);
      return { doomed, changes };
    });

    const sweepExpiredHoles = () => {
      const { doomed, changes } = sweep();
      for (const { hole_address, request_address } of doomed) {
        options.requestBroadcaster.broadcastDelete(
          hole_address,
          request_address,
        );
      }
      if (changes > 0) {
        fastify.log.info({ holes: changes }, "swept expired holes");
      }
      return changes;
    };

    fastify.decorate("sweepExpiredHoles", sweepExpiredHoles);
    const timer = setInterval(sweepExpiredHoles, SWEEP_INTERVAL_MS);
    timer.unref();
    fastify.addHook("onClose", () => {
      clearInterval(timer);
    });
    done();
  },
  { name: "retention", dependencies: ["db"] },
);
