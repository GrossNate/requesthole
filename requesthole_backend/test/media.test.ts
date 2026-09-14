import { describe, it, expect, afterEach, vi } from "vitest";
import buildApp, { AppOptions } from "../src/app";
import RequestBroadcaster from "../src/RequestBroadcaster";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import net from "node:net";
import { createHole, listRequests } from "./helpers";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

interface StoredRequest {
  request_address: string;
  body_dropped: string | null;
}

describe("media gate", () => {
  const apps: FastifyInstance[] = [];

  const start = async (options: AppOptions = {}) => {
    const app = buildApp({ databasePath: ":memory:", ...options });
    await app.ready();
    apps.push(app);
    return app;
  };

  /** Log lines as parsed JSON, via a stream the logger writes to. */
  const logSink = () => {
    const lines: Record<string, unknown>[] = [];
    const logger = {
      level: "info",
      stream: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    };
    return { lines, logger };
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const send = async (
    app: FastifyInstance,
    hole: string,
    body: string | Buffer,
    headers: Record<string, string>,
  ) => {
    const response = await app.inject({
      method: "POST",
      url: `/${hole}`,
      headers,
      body,
    });
    expect(response.statusCode).toBe(200);
    const listed = await listRequests(app, hole);
    return listed[listed.length - 1]!.request_address;
  };

  const fetchRequest = async (app: FastifyInstance, address: string) =>
    (
      await app.inject({ method: "GET", url: `/api/request/${address}` })
    ).json<StoredRequest>();

  const fetchBody = (app: FastifyInstance, address: string) =>
    app.inject({ method: "GET", url: `/api/request/${address}/body` });

  const svgAsText = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const xbmAsText = "#define icon_width 1\n#define icon_height 1\n";

  describe("with ALLOW_MEDIA unset", () => {
    it.each([
      ["a PNG", PNG, { "content-type": "image/png" }, { reason: "type" }],
      [
        "a gzip body",
        Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
        { "content-type": "application/json", "content-encoding": "gzip" },
        { reason: "encoding", contentEncoding: "gzip" },
      ],
      [
        "a PDF",
        Buffer.from("%PDF-1.7\n"),
        { "content-type": "application/pdf" },
        { reason: "type" },
      ],
      [
        "an SVG sent as text/plain",
        Buffer.from(svgAsText),
        { "content-type": "text/plain" },
        { reason: "signature", signature: "svg" },
      ],
      [
        "an XBM sent as text/plain",
        Buffer.from(xbmAsText),
        { "content-type": "text/plain" },
        { reason: "signature", signature: "xbm" },
      ],
    ])(
      "stores %s with an empty body and a description",
      async (_, body, headers, expected) => {
        const app = await start();
        const hole = await createHole(app);
        const address = await send(app, hole, body, headers);

        const stored = await fetchRequest(app, address);
        expect(JSON.parse(stored.body_dropped!)).toEqual({
          bytes: body.length,
          contentType: headers["content-type"],
          ...expected,
        });
        const served = await fetchBody(app, address);
        expect(served.rawPayload).toHaveLength(0);
      },
    );

    it.each([
      ["a JSON", '{"event":"ping"}', "application/json"],
      ["a form", "a=1&b=two", "application/x-www-form-urlencoded"],
      ["a text/plain", "hello", "text/plain"],
      ["an HTML", "<p>hi</p>", "text/html"],
    ])("stores %s webhook unchanged", async (_, body, contentType) => {
      const app = await start();
      const hole = await createHole(app);
      const address = await send(app, hole, body, {
        "content-type": contentType,
      });
      expect((await fetchRequest(app, address)).body_dropped).toBeNull();
      expect((await fetchBody(app, address)).body).toBe(body);
    });

    // Over a real socket: `inject` folds a repeated header into one line, which
    // would pass for the wrong reason. Node keeps only the first Content-Type
    // of two real lines, so only the raw headers can see the second.
    it("refuses a request that repeats its content-type", async () => {
      const app = await start();
      const hole = await createHole(app);
      await app.listen({ port: 0, host: "127.0.0.1" });
      const { port } = app.server.address() as { port: number };
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.end(
            [
              `POST /${hole} HTTP/1.1`,
              "Host: 127.0.0.1",
              "Content-Type: text/plain",
              "Content-Type: image/png",
              "Content-Length: 5",
              "Connection: close",
              "",
              "hello",
            ].join("\r\n"),
          );
        });
        let answer = "";
        socket.on("data", (chunk) => (answer += chunk.toString()));
        socket.on("end", () =>
          answer.startsWith("HTTP/1.1 200")
            ? resolve()
            : reject(new Error(answer)),
        );
        socket.on("error", reject);
      });

      const [captured] = await listRequests(app, hole);
      expect(
        JSON.parse(
          (await fetchRequest(app, captured!.request_address)).body_dropped!,
        ),
      ).toEqual({
        reason: "malformed",
        bytes: 5,
        contentType: "text/plain, image/png",
      });
    });

    it("stores a multipart form's text fields and a dropped file's headers", async () => {
      const app = await start();
      const hole = await createHole(app);
      const body = Buffer.concat([
        Buffer.from(
          [
            "preamble",
            "--XyZ",
            'Content-Disposition: form-data; name="title"',
            "",
            "hello",
            "--XyZ",
            'Content-Disposition: form-data; name="avatar"; filename="me.png"',
            "Content-Type: image/png",
            "",
            "",
          ].join("\r\n"),
        ),
        PNG,
        Buffer.from("\r\n--XyZ--\r\nepilogue"),
      ]);
      const address = await send(app, hole, body, {
        "content-type": "multipart/form-data; boundary=XyZ",
      });

      expect(
        JSON.parse((await fetchRequest(app, address)).body_dropped!),
      ).toEqual({
        parts: [
          {
            index: 1,
            name: "avatar",
            filename: "me.png",
            contentType: "image/png",
            bytes: PNG.length,
            reason: "type",
          },
        ],
      });
      expect((await fetchBody(app, address)).body).toBe(
        [
          "--XyZ",
          'Content-Disposition: form-data; name="title"',
          "",
          "hello",
          "--XyZ",
          'Content-Disposition: form-data; name="avatar"; filename="me.png"',
          "Content-Type: image/png",
          "",
          "",
          "--XyZ--",
          "",
        ].join("\r\n"),
      );
    });

    it("drops an unparseable multipart body holding binary whole", async () => {
      const app = await start();
      const hole = await createHole(app);
      const address = await send(app, hole, PNG, {
        "content-type": "multipart/form-data; boundary=nowhere",
      });
      expect(
        JSON.parse((await fetchRequest(app, address)).body_dropped!),
      ).toMatchObject({ reason: "bytes", bytes: PNG.length });
    });

    it("carries body_dropped in the list and the SSE frame", async () => {
      const broadcaster = new RequestBroadcaster();
      const broadcast = vi.spyOn(broadcaster, "broadcastRequest");
      const app = await start({ requestBroadcaster: broadcaster });
      const hole = await createHole(app);
      await send(app, hole, PNG, { "content-type": "image/png" });
      await send(app, hole, "hi", { "content-type": "text/plain" });

      const listed = (
        await app.inject({ method: "GET", url: `/api/hole/${hole}/requests` })
      ).json<StoredRequest[]>();
      expect(listed.map((row) => row.body_dropped !== null)).toEqual([
        true,
        false,
      ]);

      const frames = broadcast.mock.calls.map(([, payload]) => payload);
      expect(frames).toHaveLength(2);
      expect(JSON.parse(frames[0]!.body_dropped!)).toMatchObject({
        reason: "type",
      });
      expect(frames[1]!.body_dropped).toBeNull();
    });

    it("logs each drop once, without any content", async () => {
      const { lines, logger } = logSink();
      const app = await start({ logger });
      const hole = await createHole(app);
      const address = await send(app, hole, svgAsText, {
        "content-type": "text/plain",
      });
      await send(app, hole, "kept", { "content-type": "text/plain" });

      const drops = lines.filter((line) => line["msg"] === "dropped body");
      expect(drops).toHaveLength(1);
      expect(drops[0]).toMatchObject({
        hole: hole,
        request: address,
        contentType: "text/plain",
        bytes: svgAsText.length,
        reason: "signature",
      });
      expect(JSON.stringify(lines)).not.toContain("<svg");
    });

    it("logs a multipart drop once, without names, filenames or content", async () => {
      const { lines, logger } = logSink();
      const app = await start({ logger });
      const hole = await createHole(app);
      const address = await send(
        app,
        hole,
        Buffer.concat([
          Buffer.from(
            '--B\r\nContent-Disposition: form-data; name="secret-field"; filename="holiday.png"\r\nContent-Type: image/png\r\n\r\n',
          ),
          PNG,
          Buffer.from(
            '\r\n--B\r\nContent-Disposition: form-data; name="note"\r\n\r\nkept words\r\n--B--\r\n',
          ),
        ]),
        { "content-type": "multipart/form-data; boundary=B" },
      );

      const drops = lines.filter((line) => line["msg"] === "dropped body");
      expect(drops).toHaveLength(1);
      expect(drops[0]).toMatchObject({
        hole,
        request: address,
        contentType: "multipart/form-data; boundary=B",
        reason: "type",
      });
      const logged = JSON.stringify(lines);
      for (const leaked of [
        "secret-field",
        "holiday.png",
        "kept words",
        "PNG",
      ]) {
        expect(logged).not.toContain(leaked);
      }
    });
  });

  it("refuses to start on ALLOW_MEDIA=yes", () => {
    vi.stubEnv("ALLOW_MEDIA", "yes");
    try {
      expect(() => buildApp({ databasePath: ":memory:" })).toThrow(
        "ALLOW_MEDIA",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("brings a database from before body_dropped up to date", async () => {
    const databasePath = join(
      mkdtempSync(join(tmpdir(), "requesthole-test-")),
      "requesthole.db",
    );
    // The requests table as it shipped before this task: no body_dropped.
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE holes (
        hole_id INTEGER PRIMARY KEY,
        hole_address TEXT NOT NULL UNIQUE,
        created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        creator_ip TEXT
      );
      CREATE TABLE requests (
        request_id INTEGER PRIMARY KEY,
        request_address TEXT NOT NULL UNIQUE,
        hole_id INTEGER NOT NULL REFERENCES holes (hole_id) ON DELETE CASCADE,
        created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        method TEXT NOT NULL,
        request_path TEXT NOT NULL,
        query_params TEXT,
        headers TEXT,
        body BLOB
      );
      INSERT INTO holes (hole_address) VALUES ('old001');
      INSERT INTO requests
        (request_address, hole_id, method, request_path, query_params, headers)
        VALUES ('req001', 1, 'POST', '/old001', '{}', '{}');
    `);
    legacy.close();

    const app = await start({ databasePath });
    expect((await fetchRequest(app, "req001")).body_dropped).toBeNull();
    const address = await send(app, "old001", PNG, {
      "content-type": "image/png",
    });
    expect((await fetchRequest(app, address)).body_dropped).not.toBeNull();
  });

  describe("read side, media off", () => {
    it("serves a kept body as inert text", async () => {
      const app = await start();
      const hole = await createHole(app);
      const address = await send(app, hole, "<script>alert(1)</script>", {
        "content-type": "text/html",
      });
      const served = await fetchBody(app, address);
      expect(served.statusCode).toBe(200);
      expect(served.body).toBe("<script>alert(1)</script>");
      expect(served.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      expect(served.headers["content-disposition"]).toBe("attachment");
      expect(served.headers["cross-origin-resource-policy"]).toBe(
        "same-origin",
      );
      expect(served.headers["x-requesthole-body-withheld"]).toBeUndefined();
    });

    it("serves an empty body as text, withholding nothing", async () => {
      const app = await start();
      const hole = await createHole(app);
      await app.inject({ method: "GET", url: `/${hole}` });
      const [captured] = await listRequests(app, hole);
      const served = await fetchBody(app, captured!.request_address);
      expect(served.statusCode).toBe(200);
      expect(served.rawPayload).toHaveLength(0);
      expect(served.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(served.headers["x-requesthole-body-withheld"]).toBeUndefined();
    });

    // Rows captured while media was on stay until the retention sweep; the
    // filter runs again at read time so they are never served.
    it.each([
      ["a binary body", PNG, "image/png"],
      [
        "a body the filter would rebuild",
        Buffer.from(
          'preamble\r\n--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nv\r\n--B--\r\n',
        ),
        "multipart/form-data; boundary=B",
      ],
    ])(
      "withholds %s captured while media was on",
      async (_, body, contentType) => {
        const databasePath = join(
          mkdtempSync(join(tmpdir(), "requesthole-test-")),
          "requesthole.db",
        );
        const before = await start({
          databasePath,
          config: { allowMedia: true },
        });
        const hole = await createHole(before);
        const address = await send(before, hole, body, {
          "content-type": contentType,
        });
        await before.close();

        const after = await start({ databasePath });
        const served = await fetchBody(after, address);
        expect(served.statusCode).toBe(200);
        expect(served.rawPayload).toHaveLength(0);
        expect(served.headers["x-requesthole-body-withheld"]).toBe("true");
        expect(served.headers["content-type"]).toBe(
          "text/plain; charset=utf-8",
        );
      },
    );

    it("lets a cross-origin page read the withheld header", async () => {
      const app = await start();
      const hole = await createHole(app);
      const address = await send(app, hole, "hi", {
        "content-type": "text/plain",
      });
      const served = await app.inject({
        method: "GET",
        url: `/api/request/${address}/body`,
        headers: { origin: "http://localhost:5173" },
      });
      expect(
        String(served.headers["access-control-expose-headers"]).toLowerCase(),
      ).toContain("x-requesthole-body-withheld");
    });
  });

  describe("GET /api/config", () => {
    it.each([
      [{}, false],
      [{ allowMedia: false }, false],
      [{ allowMedia: true }, true],
    ])("with %j reports allowMedia %s", async (config, allowMedia) => {
      const app = await start({ config });
      const response = await app.inject({ method: "GET", url: "/api/config" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ allowMedia });
    });
  });

  describe("with ALLOW_MEDIA on", () => {
    it("says so once at startup", async () => {
      const { lines, logger } = logSink();
      await start({ logger, config: { allowMedia: true } });
      expect(
        lines.filter(
          (line) =>
            line["msg"] ===
            "ALLOW_MEDIA on: media and binary bodies are stored and served",
        ),
      ).toHaveLength(1);
    });

    it("is silent about media at startup when off", async () => {
      const { lines, logger } = logSink();
      await start({ logger });
      expect(JSON.stringify(lines)).not.toContain("ALLOW_MEDIA");
    });

    it("stores and serves a PNG as today, under the sender's type", async () => {
      const app = await start({ config: { allowMedia: true } });
      const hole = await createHole(app);
      const address = await send(app, hole, PNG, {
        "content-type": "image/png",
      });
      expect((await fetchRequest(app, address)).body_dropped).toBeNull();
      const served = await fetchBody(app, address);
      expect(served.rawPayload).toEqual(PNG);
      expect(served.headers["content-type"]).toBe("image/png");
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      expect(served.headers["content-disposition"]).toBe("attachment");
      expect(served.headers["cross-origin-resource-policy"]).toBeUndefined();
      expect(served.headers["x-requesthole-body-withheld"]).toBeUndefined();
    });

    it("keeps a multipart body byte for byte, preamble and all", async () => {
      const app = await start({ config: { allowMedia: true } });
      const hole = await createHole(app);
      const body = Buffer.concat([
        Buffer.from(
          'preamble\r\n--B\r\nContent-Disposition: form-data; name="f"\r\nContent-Type: image/png\r\n\r\n',
        ),
        PNG,
        Buffer.from("\r\n--B--\r\n"),
      ]);
      const address = await send(app, hole, body, {
        "content-type": "multipart/form-data; boundary=B",
      });
      expect((await fetchBody(app, address)).rawPayload).toEqual(body);
    });
  });
});
