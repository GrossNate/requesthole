import { describe, it, expect, afterEach, vi } from "vitest";
import buildApp, { AppOptions } from "../src/app";
import RequestBroadcaster from "../src/RequestBroadcaster";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { backdate, createHole, listRequests } from "./helpers";

describe("resource bounds", () => {
  const apps: FastifyInstance[] = [];

  const start = async (options: AppOptions = {}) => {
    const app = buildApp({ databasePath: ":memory:", ...options });
    await app.ready();
    apps.push(app);
    return app;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("indexes requests by hole", async () => {
    const app = await start();
    const indexes = app.db.prepare("PRAGMA index_list('requests')").all() as {
      name: string;
    }[];
    const columns = indexes.flatMap(
      (index) =>
        app.db.prepare(`PRAGMA index_info('${index.name}')`).all() as {
          name: string;
        }[],
    );
    expect(columns.map((column) => column.name)).toContain("hole_id");
  });

  describe("per-hole cap", () => {
    it("evicts the oldest request once a hole is over the cap", async () => {
      const app = await start({ config: { maxRequestsPerHole: 3 } });
      const hole = await createHole(app);
      for (const n of [1, 2, 3, 4]) {
        await app.inject({ method: "POST", url: `/${hole}?n=${n}` });
      }
      const requests = await listRequests(app, hole);
      expect(requests.map((request) => request.request_path)).toEqual([
        `/${hole}?n=2`,
        `/${hole}?n=3`,
        `/${hole}?n=4`,
      ]);
    });

    it("never lets the stored count exceed the cap", async () => {
      const app = await start({ config: { maxRequestsPerHole: 2 } });
      const hole = await createHole(app);
      for (let n = 0; n < 10; n++) {
        await app.inject({ method: "POST", url: `/${hole}?n=${n}` });
        expect((await listRequests(app, hole)).length).toBeLessThanOrEqual(2);
      }
    });

    it("leaves other holes alone", async () => {
      const app = await start({ config: { maxRequestsPerHole: 1 } });
      const quiet = await createHole(app);
      const busy = await createHole(app);
      await app.inject({ method: "POST", url: `/${quiet}` });
      await app.inject({ method: "POST", url: `/${busy}?n=1` });
      await app.inject({ method: "POST", url: `/${busy}?n=2` });
      expect(await listRequests(app, quiet)).toHaveLength(1);
      expect(await listRequests(app, busy)).toHaveLength(1);
    });
  });

  describe("rate limits", () => {
    const createFrom = (app: FastifyInstance, ip: string) =>
      app.inject({
        method: "POST",
        url: "/api/hole",
        headers: { "x-forwarded-for": ip },
      });

    it("limits hole creation per client IP", async () => {
      const app = await start({ config: { holeCreateRateLimit: 2 } });
      expect((await createFrom(app, "10.0.0.1")).statusCode).toBe(201);
      expect((await createFrom(app, "10.0.0.1")).statusCode).toBe(201);
      expect((await createFrom(app, "10.0.0.1")).statusCode).toBe(429);
    });

    it("keys on the forwarded client IP, not the proxy's", async () => {
      const app = await start({ config: { holeCreateRateLimit: 1 } });
      expect((await createFrom(app, "10.0.0.1")).statusCode).toBe(201);
      expect((await createFrom(app, "10.0.0.1")).statusCode).toBe(429);
      // Same socket, different forwarded address: an independent budget.
      expect((await createFrom(app, "10.0.0.2")).statusCode).toBe(201);
    });

    it("trusts only the hop nginx wrote, so a spoofed X-Forwarded-For buys nothing", async () => {
      const app = await start({ config: { holeCreateRateLimit: 1 } });
      // nginx appends the real peer to whatever the client sent, so the
      // client's entry is leftmost and nginx's is rightmost. Only the
      // rightmost may be the key, or every request could pick its own bucket.
      expect((await createFrom(app, "1.1.1.1, 9.9.9.9")).statusCode).toBe(201);
      expect((await createFrom(app, "2.2.2.2, 9.9.9.9")).statusCode).toBe(429);
      expect((await createFrom(app, "3.3.3.3, 8.8.8.8")).statusCode).toBe(201);
    });

    it("limits capture per client IP", async () => {
      const app = await start({ config: { captureRateLimit: 1 } });
      const hole = await createHole(app);
      const captureFrom = (ip: string) =>
        app.inject({
          method: "POST",
          url: `/${hole}`,
          headers: { "x-forwarded-for": ip },
        });
      expect((await captureFrom("10.0.0.1")).statusCode).toBe(200);
      expect((await captureFrom("10.0.0.1")).statusCode).toBe(429);
      expect((await captureFrom("10.0.0.2")).statusCode).toBe(200);
      expect(await listRequests(app, hole)).toHaveLength(2);
    });

    it("shares one capture budget between the bare address and sub-paths", async () => {
      const app = await start({ config: { captureRateLimit: 2 } });
      const hole = await createHole(app);
      const capture = (url: string) =>
        app.inject({
          method: "POST",
          url,
          headers: { "x-forwarded-for": "10.0.0.1" },
        });
      expect((await capture(`/${hole}`)).statusCode).toBe(200);
      expect((await capture(`/${hole}/x`)).statusCode).toBe(200);
      expect((await capture(`/${hole}`)).statusCode).toBe(429);
      expect((await capture(`/${hole}/y`)).statusCode).toBe(429);
    });

    it("does not meter junk paths against the capture budget", async () => {
      const app = await start({ config: { captureRateLimit: 1 } });
      const hole = await createHole(app);
      const from = { "x-forwarded-for": "10.0.0.1" };
      await app.inject({ method: "GET", url: "/api/nope/x", headers: from });
      await app.inject({ method: "GET", url: "/api/nope/y", headers: from });
      const real = await app.inject({
        method: "POST",
        url: `/${hole}/hook`,
        headers: from,
      });
      expect(real.statusCode).toBe(200);
    });

    it("does not limit reading", async () => {
      const app = await start({
        config: { holeCreateRateLimit: 1, captureRateLimit: 1 },
      });
      for (let n = 0; n < 5; n++) {
        const listed = await app.inject({
          method: "GET",
          url: "/api/holes",
          headers: { "x-forwarded-for": "10.0.0.1" },
        });
        expect(listed.statusCode).toBe(200);
      }
    });
  });

  describe("hole ceiling", () => {
    it("refuses creation at the ceiling without evicting anyone", async () => {
      const app = await start({ config: { maxHoles: 2 } });
      const first = await createHole(app);
      const second = await createHole(app);

      const refused = await app.inject({ method: "POST", url: "/api/hole" });
      expect(refused.statusCode).toBe(503);

      const holes = await app.inject({ method: "GET", url: "/api/holes" });
      expect(holes.json<{ hole_address: string }[]>()).toEqual([
        { hole_address: first },
        { hole_address: second },
      ]);
    });

    it("accepts creation again once a hole is deleted", async () => {
      const app = await start({ config: { maxHoles: 1 } });
      const only = await createHole(app);
      expect(
        (await app.inject({ method: "POST", url: "/api/hole" })).statusCode,
      ).toBe(503);
      await app.inject({ method: "DELETE", url: `/api/hole/${only}` });
      expect(
        (await app.inject({ method: "POST", url: "/api/hole" })).statusCode,
      ).toBe(201);
    });
  });

  describe("body limit", () => {
    it("rejects a body over the configured limit with 413", async () => {
      const app = await start({ config: { maxBodyBytes: 16 } });
      const hole = await createHole(app);
      const capture = (body: string) =>
        app.inject({
          method: "POST",
          url: `/${hole}`,
          headers: { "content-type": "text/plain" },
          body,
        });
      expect((await capture("x".repeat(16))).statusCode).toBe(200);
      expect((await capture("x".repeat(17))).statusCode).toBe(413);
      expect(await listRequests(app, hole)).toHaveLength(1);
    });
  });

  describe("sub-path capture", () => {
    it("captures a sub-path with its full path", async () => {
      const app = await start();
      const hole = await createHole(app);
      const response = await app.inject({
        method: "POST",
        url: `/${hole}/webhook`,
        headers: { "content-type": "text/plain" },
        body: "hi",
      });
      expect(response.statusCode).toBe(200);
      expect(
        (await listRequests(app, hole)).map((r) => r.request_path),
      ).toEqual([`/${hole}/webhook`]);
    });

    it("captures a deep sub-path with a query string", async () => {
      const app = await start();
      const hole = await createHole(app);
      await app.inject({
        method: "PUT",
        url: `/${hole}/v2/events/123?dry=1`,
      });
      expect(
        (await listRequests(app, hole)).map((r) => r.request_path),
      ).toEqual([`/${hole}/v2/events/123?dry=1`]);
    });

    it("still captures at the bare address", async () => {
      const app = await start();
      const hole = await createHole(app);
      await app.inject({ method: "GET", url: `/${hole}` });
      expect(
        (await listRequests(app, hole)).map((r) => r.request_path),
      ).toEqual([`/${hole}`]);
    });

    it("answers 404 for a sub-path of a hole that does not exist", async () => {
      const app = await start();
      const response = await app.inject({ method: "POST", url: "/nohole/x" });
      expect(response.statusCode).toBe(404);
    });

    it("answers 404, not 400, for an unknown multi-segment path", async () => {
      const app = await start();
      const response = await app.inject({ method: "GET", url: "/api/nope/x" });
      expect(response.statusCode).toBe(404);
    });

    it("does not swallow /api paths", async () => {
      const app = await start();
      const response = await app.inject({ method: "GET", url: "/api/holes" });
      expect(response.json()).toEqual([]);
    });
  });

  describe("delete frames", () => {
    const startSpied = async (config: AppOptions["config"] = {}) => {
      const broadcaster = new RequestBroadcaster();
      const deletes = vi.spyOn(broadcaster, "broadcastDelete");
      const app = await start({ requestBroadcaster: broadcaster, config });
      return { app, deletes };
    };

    it("broadcasts a user delete to the hole's viewers", async () => {
      const { app, deletes } = await startSpied();
      const hole = await createHole(app);
      await app.inject({ method: "POST", url: `/${hole}` });
      const request_address = (await listRequests(app, hole))[0]
        ?.request_address;

      await app.inject({
        method: "DELETE",
        url: `/api/request/${request_address}`,
      });

      expect(deletes).toHaveBeenCalledExactlyOnceWith(hole, request_address);
    });

    it("does not broadcast a delete that found nothing", async () => {
      const { app, deletes } = await startSpied();
      await app.inject({ method: "DELETE", url: "/api/request/nosuch" });
      expect(deletes).not.toHaveBeenCalled();
    });

    it("broadcasts an insert-time eviction", async () => {
      const { app, deletes } = await startSpied({ maxRequestsPerHole: 1 });
      const hole = await createHole(app);
      await app.inject({ method: "POST", url: `/${hole}?n=1` });
      const evicted = (await listRequests(app, hole))[0]?.request_address;

      await app.inject({ method: "POST", url: `/${hole}?n=2` });

      expect(deletes).toHaveBeenCalledExactlyOnceWith(hole, evicted);
    });

    it("broadcasts every request a hole delete takes with it", async () => {
      const { app, deletes } = await startSpied();
      const hole = await createHole(app);
      await app.inject({ method: "POST", url: `/${hole}?n=1` });
      await app.inject({ method: "POST", url: `/${hole}?n=2` });
      const addresses = (await listRequests(app, hole)).map(
        (r) => r.request_address,
      );

      const response = await app.inject({
        method: "DELETE",
        url: `/api/hole/${hole}`,
      });

      expect(response.statusCode).toBe(204);
      expect(deletes.mock.calls).toEqual(
        addresses.map((address) => [hole, address]),
      );
    });

    it("broadcasts every request a sweep takes with its hole", async () => {
      const { app, deletes } = await startSpied({ retentionDays: 1 });
      const stale = await createHole(app);
      await app.inject({ method: "POST", url: `/${stale}?n=1` });
      await app.inject({ method: "POST", url: `/${stale}?n=2` });
      const addresses = (await listRequests(app, stale)).map(
        (r) => r.request_address,
      );
      backdate(app, stale, 2);

      app.sweepExpiredHoles();

      expect(deletes.mock.calls).toEqual(
        addresses.map((address) => [stale, address]),
      );
    });
  });

  it("delivers a delete frame over the live SSE stream", async () => {
    const app = await start();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const serverAddress = app.server.address();
    const port =
      typeof serverAddress === "object" && serverAddress
        ? serverAddress.port
        : 0;
    const hole = await createHole(app);
    await app.inject({ method: "POST", url: `/${hole}` });
    const request_address = (await listRequests(app, hole))[0]?.request_address;

    // Subscribe over a real socket: `inject` cannot read a live stream. Wait
    // for `stream-open` so the subscriber is registered before the delete.
    let opened: () => void = () => {};
    const streamOpen = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const frame = new Promise<string>((resolve, reject) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: `/api/hole/${hole}/events` },
        (res) => {
          res.setEncoding("utf8");
          let buffer = "";
          res.on("data", (chunk: string) => {
            buffer += chunk;
            if (/^event: stream-open/m.test(buffer)) opened();
            if (/^event: delete/m.test(buffer)) {
              req.destroy();
              resolve(buffer);
            }
          });
        },
      );
      req.on("error", reject);
      setTimeout(() => {
        req.destroy();
        reject(new Error("no delete frame arrived within the timeout"));
      }, 8000).unref();
    });
    await streamOpen;

    await app.inject({
      method: "DELETE",
      url: `/api/request/${request_address}`,
    });

    const payload = await frame;
    const deleteFrame = payload
      .split("\n\n")
      .find((block) => block.includes("event: delete"))!;
    expect(deleteFrame).toContain(
      `data: ${JSON.stringify({ request_address })}`,
    );
  }, 15000);

  describe("retention sweep", () => {
    it("deletes holes past the TTL, requests and all, and keeps newer ones", async () => {
      const app = await start({ config: { retentionDays: 7 } });
      const stale = await createHole(app);
      const fresh = await createHole(app);
      await app.inject({ method: "POST", url: `/${stale}` });
      backdate(app, stale, 8);
      backdate(app, fresh, 6);

      app.sweepExpiredHoles();

      const holes = await app.inject({ method: "GET", url: "/api/holes" });
      expect(holes.json<{ hole_address: string }[]>()).toEqual([
        { hole_address: fresh },
      ]);
      expect(
        app.db.prepare("SELECT COUNT(*) AS n FROM requests").get(),
      ).toEqual({ n: 0 });
    });

    it("sweeps once at startup, not only after the first hour", async () => {
      const databasePath = join(
        mkdtempSync(join(tmpdir(), "requesthole-test-")),
        "requesthole.db",
      );
      const first = await start({ databasePath, config: { retentionDays: 1 } });
      const stale = await createHole(first);
      backdate(first, stale, 2);
      await first.close();
      apps.splice(0);

      const second = await start({
        databasePath,
        config: { retentionDays: 1 },
      });
      const holes = await second.inject({ method: "GET", url: "/api/holes" });
      expect(holes.json()).toEqual([]);
    });

    it("runs hourly and stops when the server closes", async () => {
      vi.useFakeTimers();
      try {
        const app = await start({ config: { retentionDays: 1 } });
        // Straight into the table: `inject` arms a timer of its own, which
        // would muddy the count checked after close.
        app.db
          .prepare("INSERT INTO holes (hole_address) VALUES ('stale1')")
          .run();
        backdate(app, "stale1", 2);
        const countHoles = () =>
          (
            app.db.prepare("SELECT COUNT(*) AS n FROM holes").get() as {
              n: number;
            }
          ).n;

        vi.advanceTimersByTime(60 * 60 * 1000 - 1);
        expect(countHoles()).toBe(1);
        vi.advanceTimersByTime(1);
        expect(countHoles()).toBe(0);

        await app.close();
        apps.splice(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
