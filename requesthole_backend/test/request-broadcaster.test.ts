import { describe, it, expect, vi } from "vitest";
import type { FastifyReply } from "fastify";
import RequestBroadcaster from "../src/RequestBroadcaster";
import type RequestSansBody from "../src/schemas";

// The spy is kept beside the reply rather than reached back through it: a
// FastifyReply's `sse` is a method, and asserting on it unbound trips
// @typescript-eslint/unbound-method.
const subscriber = () => {
  const sent = vi.fn();
  return { sent, reply: { sse: sent } as unknown as FastifyReply };
};

// A whole row, not a cast-away partial: the payload's shape is the contract
// between the broadcast and the client that parses it, and a fixture opted out
// of the type cannot notice when that shape changes.
const captured = (
  overrides: Partial<RequestSansBody> = {},
): RequestSansBody => ({
  request_address: "req001",
  created: "2026-07-25T14:03:22.145Z",
  method: "POST",
  request_path: "/aaaaaa",
  query_params: '{"probe":"1"}',
  headers: '{"user-agent":"curl/8.7.1"}',
  ...overrides,
});

// An emptied Map entry is invisible from the outside — there is no send you
// can watch to prove it was reclaimed — so the test reaches for the field
// itself rather than the server growing a method only a test would call.
const trackedHoles = (broadcaster: RequestBroadcaster) =>
  (broadcaster as unknown as { holes: Map<string, Set<FastifyReply>> }).holes
    .size;

describe("RequestBroadcaster", () => {
  it("sends a captured request to every subscriber of that hole", () => {
    const broadcaster = new RequestBroadcaster();
    const first = subscriber();
    const second = subscriber();
    const elsewhere = subscriber();
    broadcaster.addClient("aaaaaa", first.reply);
    broadcaster.addClient("aaaaaa", second.reply);
    broadcaster.addClient("bbbbbb", elsewhere.reply);

    broadcaster.broadcastRequest("aaaaaa", captured());

    expect(first.sent).toHaveBeenCalledTimes(1);
    // The whole row, serialised: the client parses this into the object its
    // list is built from, so a field dropped here is a field missing there.
    expect(first.sent).toHaveBeenCalledWith({
      data: JSON.stringify(captured()),
    });
    expect(second.sent).toHaveBeenCalledTimes(1);
    expect(elsewhere.sent).not.toHaveBeenCalled();
  });

  it("stops sending to a subscriber that has gone", () => {
    const broadcaster = new RequestBroadcaster();
    const leaving = subscriber();
    broadcaster.addClient("aaaaaa", leaving.reply);

    broadcaster.deleteClient("aaaaaa", leaving.reply);
    broadcaster.broadcastRequest("aaaaaa", captured());

    expect(leaving.sent).not.toHaveBeenCalled();
  });

  // Addresses are attacker-supplied and need not name a real hole: anyone can
  // open a stream for any six characters. Keeping the emptied Set meant one
  // permanent Map entry per address ever probed, which is memory a stranger
  // gets to grow by connecting and hanging up.
  it("forgets a hole once its last subscriber leaves", () => {
    const broadcaster = new RequestBroadcaster();
    const passing = subscriber();

    broadcaster.addClient("aaaaaa", passing.reply);
    broadcaster.deleteClient("aaaaaa", passing.reply);

    expect(trackedHoles(broadcaster)).toBe(0);
  });

  it("keeps a hole while any subscriber is still listening", () => {
    const broadcaster = new RequestBroadcaster();
    const staying = subscriber();
    const leaving = subscriber();
    broadcaster.addClient("aaaaaa", staying.reply);
    broadcaster.addClient("aaaaaa", leaving.reply);

    broadcaster.deleteClient("aaaaaa", leaving.reply);

    expect(trackedHoles(broadcaster)).toBe(1);
  });
});
