import Database from "better-sqlite3";
import RequestBroadcaster from "./RequestBroadcaster";

/**
 * Deleting holes is one operation with two callers — the API's hole delete
 * and the retention sweep — that differ only in which holes. Both delete the
 * holes (their requests go with them through the cascade) and tell each
 * hole's viewers, once, that it is gone: a stream that never drops never
 * takes a fresh snapshot, so without the frame a viewer would keep a hole
 * that no longer exists.
 *
 * `where` is a predicate over `holes` with a single `?` placeholder. Callers
 * pass it as a literal, never built from input; the value is always bound.
 * The returned function runs it with that value and reports how many holes
 * went.
 */
export default function prepareHoleRemoval(
  db: Database.Database,
  requestBroadcaster: RequestBroadcaster,
  where: string,
): (value: string | null) => number {
  // One statement: the rows it reports are exactly the rows it deleted.
  const deleteHoles = db.prepare(
    `DELETE FROM holes WHERE ${where} RETURNING hole_address`,
  );

  return (value: string | null) => {
    const removed = deleteHoles.all(value) as { hole_address: string }[];
    for (const { hole_address } of removed) {
      requestBroadcaster.broadcastHoleDeleted(hole_address);
    }
    return removed.length;
  };
}
