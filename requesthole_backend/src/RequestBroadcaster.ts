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
    this.holes.get(holeAddress)?.delete(reply);
  }

  broadcastRequest(holeAddress: string, request: RequestSansBody) {
    this.holes.get(holeAddress)?.forEach((reply) => {
      reply.sse({ data: JSON.stringify(request) });
    });
  }
}

export default RequestBroadcaster;
