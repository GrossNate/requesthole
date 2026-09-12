import { FastifyReply } from "fastify";
import RequestSansBody from "./schemas";

class RequestBroadcaster {
  private holes: Map<string, Set<FastifyReply>>;

  constructor() {
    this.holes = new Map();
  }

  addClient(holeAddress: string, reply: FastifyReply) {
    if (!this.holes.has(holeAddress)) {
      this.holes.set(holeAddress, new Set<FastifyReply>());
    }
    this.holes.get(holeAddress)?.add(reply);
  }

  deleteClient(holeAddress: string, reply: FastifyReply) {
    const subscribers = this.holes.get(holeAddress);
    if (!subscribers) return;
    subscribers.delete(reply);
    // Drop the key with the last subscriber. A stream can be opened for any
    // six characters, real hole or not, so leaving emptied Sets behind meant
    // one permanent Map entry per address anyone ever probed.
    if (subscribers.size === 0) this.holes.delete(holeAddress);
  }

  /** Whether anyone is subscribed to this hole's stream right now. */
  isWatched(holeAddress: string) {
    return this.holes.has(holeAddress);
  }

  broadcastRequest(holeAddress: string, request: RequestSansBody) {
    this.holes.get(holeAddress)?.forEach((reply) => {
      reply.sse({ data: JSON.stringify(request) });
    });
  }

  /**
   * Tells a hole's viewers a request is gone — a user delete, an insert-time
   * eviction, or the retention sweep. A named event: the default channel is
   * for rows to render, and a client only ever learns of a deletion this way
   * (a stream that never drops never takes a fresh snapshot).
   */
  broadcastDelete(holeAddress: string, requestAddress: string) {
    this.holes.get(holeAddress)?.forEach((reply) => {
      reply.sse({
        event: "delete",
        data: JSON.stringify({ request_address: requestAddress }),
      });
    });
  }
}

export default RequestBroadcaster;
