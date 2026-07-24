import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import buildApp from "../src/app";
import RequestBroadcaster from "../src/RequestBroadcaster";
import type { FastifyInstance } from "fastify";

describe("holes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({ databasePath: ":memory:" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a hole and returns its address and creation time", async () => {
    const response = await app.inject({ method: "POST", url: "/api/hole" });

    expect(response.statusCode).toBe(201);
    const rows = response.json<{ hole_address: string; created: string }[]>();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hole_address).toMatch(/^[a-zA-Z0-9]{6}$/);
    expect(rows[0]?.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("lists created holes", async () => {
    const first = await createHole(app);
    const second = await createHole(app);

    const response = await app.inject({ method: "GET", url: "/api/holes" });

    expect(response.statusCode).toBe(200);
    const rows = response.json<{ hole_address: string }[]>();
    expect(rows.map((row) => row.hole_address)).toEqual([first, second]);
  });

  it("fetches a single hole by address", async () => {
    const address = await createHole(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/hole/${address}`,
    });

    expect(response.statusCode).toBe(200);
    const rows = response.json<{ hole_address: string; created: string }[]>();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hole_address).toBe(address);
  });

  it("returns an empty list for an unknown hole address", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/hole/zzzzzz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("deletes a hole with 204, and 404s when it does not exist", async () => {
    const address = await createHole(app);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/hole/${address}`,
    });
    expect(deleted.statusCode).toBe(204);

    const deletedAgain = await app.inject({
      method: "DELETE",
      url: `/api/hole/${address}`,
    });
    expect(deletedAgain.statusCode).toBe(404);
  });
});

describe("request capture", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({ databasePath: ":memory:" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("captures a request posted to a hole address", async () => {
    const address = await createHole(app);

    const response = await app.inject({
      method: "POST",
      url: `/${address}?probe=1`,
      headers: { "content-type": "text/plain" },
      body: "hello hole",
    });

    expect(response.statusCode).toBe(200);
  });

  it("broadcasts a captured request to SSE subscribers", async () => {
    const broadcaster = new RequestBroadcaster();
    const broadcast = vi.spyOn(broadcaster, "broadcastRequest");
    const sseApp = buildApp({
      databasePath: ":memory:",
      requestBroadcaster: broadcaster,
    });
    await sseApp.ready();

    const address = await createHole(sseApp);
    await sseApp.inject({
      method: "POST",
      url: `/${address}`,
      headers: { "content-type": "text/plain" },
      body: "broadcast me",
    });

    expect(broadcast).toHaveBeenCalledOnce();
    const [broadcastAddress, payload] = broadcast.mock.calls[0]!;
    expect(broadcastAddress).toBe(address);
    expect(typeof payload.created).toBe("string");
    expect(payload.method).toBe("POST");

    await sseApp.close();
  });

  it("404s a request to an unknown hole address", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/zzzzzz",
      headers: { "content-type": "text/plain" },
      body: "nobody home",
    });

    expect(response.statusCode).toBe(404);
  });

  it("lists a hole's captured requests", async () => {
    const address = await createHole(app);
    await app.inject({
      method: "POST",
      url: `/${address}`,
      headers: { "content-type": "text/plain" },
      body: "first",
    });
    await app.inject({
      method: "GET",
      url: `/${address}`,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/hole/${address}/requests`,
    });

    expect(response.statusCode).toBe(200);
    const rows = response.json<
      {
        request_address: string;
        created: string;
        method: string;
        request_path: string;
        query_params: string;
        headers: string;
      }[]
    >();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.method).sort()).toEqual(["GET", "POST"]);
    const capturedHeaders = JSON.parse(rows[0]!.headers) as Record<
      string,
      string
    >;
    expect(capturedHeaders["content-type"]).toBe("text/plain");
    expect(JSON.parse(rows[0]!.query_params)).toEqual({
      hole_address: address,
    });
  });
});

describe("requests", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({ databasePath: ":memory:" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("fetches a single captured request, 404 when unknown", async () => {
    const requestAddress = await captureRequest(app, "some payload");

    const response = await app.inject({
      method: "GET",
      url: `/api/request/${requestAddress}`,
    });

    expect(response.statusCode).toBe(200);
    const row = response.json<{ request_address: string; method: string }>();
    expect(row.request_address).toBe(requestAddress);
    expect(row.method).toBe("POST");

    const missing = await app.inject({
      method: "GET",
      url: "/api/request/zzzzzz",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("round-trips a binary body with its content-type", async () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const requestAddress = await captureRequest(
      app,
      binary,
      "application/octet-stream",
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/request/${requestAddress}/body`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.rawPayload).toEqual(binary);
  });

  it("deletes a request with 204, and 404s when it does not exist", async () => {
    const requestAddress = await captureRequest(app, "delete me");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/request/${requestAddress}`,
    });
    expect(deleted.statusCode).toBe(204);

    const deletedAgain = await app.inject({
      method: "DELETE",
      url: `/api/request/${requestAddress}`,
    });
    expect(deletedAgain.statusCode).toBe(404);
  });

  it("cascades hole deletion to its captured requests", async () => {
    const holeAddress = await createHole(app);
    await app.inject({
      method: "POST",
      url: `/${holeAddress}`,
      headers: { "content-type": "text/plain" },
      body: "orphan me",
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/hole/${holeAddress}/requests`,
    });
    const requestAddress =
      listed.json<{ request_address: string }[]>()[0]?.request_address;
    expect(requestAddress).toBeDefined();

    await app.inject({ method: "DELETE", url: `/api/hole/${holeAddress}` });

    const orphan = await app.inject({
      method: "GET",
      url: `/api/request/${requestAddress}`,
    });
    expect(orphan.statusCode).toBe(404);
  });
});

describe("persistence", () => {
  it("keeps data across app restarts when backed by a file", async () => {
    const databasePath = join(
      mkdtempSync(join(tmpdir(), "requesthole-test-")),
      "data",
      "requesthole.db",
    );

    const firstApp = buildApp({ databasePath });
    await firstApp.ready();
    const address = await createHole(firstApp);
    await firstApp.close();

    const secondApp = buildApp({ databasePath });
    await secondApp.ready();
    const response = await secondApp.inject({
      method: "GET",
      url: "/api/holes",
    });
    expect(
      response
        .json<{ hole_address: string }[]>()
        .map((row) => row.hole_address),
    ).toContain(address);
    await secondApp.close();
  });
});

async function captureRequest(
  app: FastifyInstance,
  body: string | Buffer,
  contentType = "text/plain",
): Promise<string> {
  const holeAddress = await createHole(app);
  await app.inject({
    method: "POST",
    url: `/${holeAddress}`,
    headers: { "content-type": contentType },
    body,
  });
  const listed = await app.inject({
    method: "GET",
    url: `/api/hole/${holeAddress}/requests`,
  });
  const requestAddress =
    listed.json<{ request_address: string }[]>()[0]?.request_address;
  if (requestAddress === undefined) {
    throw new Error("request capture failed");
  }
  return requestAddress;
}

async function createHole(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/hole" });
  const rows = response.json<{ hole_address: string }[]>();
  const address = rows[0]?.hole_address;
  if (address === undefined) {
    throw new Error("hole creation failed");
  }
  return address;
}
