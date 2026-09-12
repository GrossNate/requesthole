import Database from "better-sqlite3";
import RequestBroadcaster from "./RequestBroadcaster";

/**
 * Deleting holes is one operation with two callers — the API's hole delete
 * and the retention sweep — that differ only in which holes. Both need the
 * same choreography: find the doomed holes, delete them in one transaction
 * (their requests go with them through the cascade), then tell each hole's
 * viewers which requests went, because a stream that never drops never takes
 * a fresh snapshot.
 *
 * Requests are listed only for holes someone is watching. A week-old hole
 * almost never is, and listing its rows only to address frames to nobody was
 * up to cap x holes rows per sweep.
 *
 * `where` is a predicate over `holes` (qualify columns as `holes.x`) with a
 * single `?` placeholder. Callers pass it as a literal, never built from
 * input; the value is always bound. The returned function runs it with that
 * value and reports how many holes went.
 */
export default function prepareHoleRemoval(
  db: Database.Database,
  requestBroadcaster: RequestBroadcaster,
  where: string,
): (value: string | null) => number {
  const selectDoomedHoles = db.prepare(
    `SELECT holes.hole_id, holes.hole_address FROM holes WHERE ${where}`,
  );
  const selectHoleRequests = db.prepare(
    `SELECT request_address FROM requests
     WHERE hole_id = ?
     ORDER BY created, request_id`,
  );
  const deleteHoles = db.prepare(`DELETE FROM holes WHERE ${where}`);

  const remove = db.transaction((value: string | null) => {
    const doomed = selectDoomedHoles.all(value) as {
      hole_id: number;
      hole_address: string;
    }[];
    const notices = doomed
      .filter(({ hole_address }) => requestBroadcaster.isWatched(hole_address))
      .map(({ hole_id, hole_address }) => ({
        hole_address,
        request_addresses: (
          selectHoleRequests.all(hole_id) as { request_address: string }[]
        ).map((row) => row.request_address),
      }));
    const { changes } = deleteHoles.run(value);
    return { notices, changes };
  });

  return (value: string | null) => {
    const { notices, changes } = remove(value);
    for (const { hole_address, request_addresses } of notices) {
      for (const request_address of request_addresses) {
        requestBroadcaster.broadcastDelete(hole_address, request_address);
      }
    }
    return changes;
  };
}
