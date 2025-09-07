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
      console.log("Hole set added");
    }
    this.holes.get(holeAddress)?.add(reply);
    console.log("Hole listener added");
  }

  deleteClient(holeAddress: string, reply: FastifyReply) {
    this.holes.get(holeAddress)?.delete(reply);
    console.log("Hole listener deleted");
  }

  broadcastRequest(holeAddress: string, request: RequestSansBody) {
    this.holes.get(holeAddress)?.forEach((reply) => {
      reply.sse({ data: JSON.stringify(request) });
      console.log("Broadcast sent");
    });
  }
}

export default RequestBroadcaster;
