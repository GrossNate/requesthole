import Database from "better-sqlite3";
import RequestBroadcaster from "./RequestBroadcaster";

/**
 * Deleting holes is one operation with two callers — the API's hole delete
 * and the retention sweep — that differ only in which holes. Both need the
 * same choreography: list the requests the cascade is about to take, delete
 * the holes in the same transaction, then tell each hole's viewers, because
 * a stream that never drops never takes a fresh snapshot.
 *
 * `where` is a predicate over `holes` (qualify columns as `holes.x`) with a
 * single `?` placeholder; the returned function runs it with that value and
 * reports how many holes went.
 */
export default function prepareHoleRemoval(
  db: Database.Database,
  requestBroadcaster: RequestBroadcaster,
  where: string,
): (value: string) => number {
  const selectDoomedRequests = db.prepare(
    `SELECT holes.hole_address, requests.request_address
     FROM requests INNER JOIN holes USING (hole_id)
     WHERE ${where}
     ORDER BY requests.created, requests.request_id`,
  );
  const deleteHoles = db.prepare(`DELETE FROM holes WHERE ${where}`);
  const remove = db.transaction((value: string) => {
    const doomed = selectDoomedRequests.all(value) as {
      hole_address: string;
      request_address: string;
    }[];
    const { changes } = deleteHoles.run(value);
    return { doomed, changes };
  });

  return (value: string) => {
    const { doomed, changes } = remove(value);
    for (const { hole_address, request_address } of doomed) {
      requestBroadcaster.broadcastDelete(hole_address, request_address);
    }
    return changes;
  };
}
