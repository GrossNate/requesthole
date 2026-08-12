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

  broadcastRequest(holeAddress: string, request: RequestSansBody) {
    this.holes.get(holeAddress)?.forEach((reply) => {
      reply.sse({ data: JSON.stringify(request) });
    });
  }
}

export default RequestBroadcaster;
