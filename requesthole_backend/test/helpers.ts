import type { FastifyInstance } from "fastify";

/** Creates a hole through the API and returns its address. */
export async function createHole(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/hole" });
  const rows = response.json<{ hole_address: string }[]>();
  const address = rows[0]?.hole_address;
  if (address === undefined) {
    throw new Error("hole creation failed");
  }
  return address;
}

/** The hole's requests as the list endpoint reports them, oldest first. */
export async function listRequests(app: FastifyInstance, holeAddress: string) {
  const listed = await app.inject({
    method: "GET",
    url: `/api/hole/${holeAddress}/requests`,
  });
  return listed.json<{ request_address: string; request_path: string }[]>();
}

/** Creates a hole, captures one request into it, returns the request address. */
export async function captureRequest(
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
  const requestAddress = (await listRequests(app, holeAddress))[0]
    ?.request_address;
  if (requestAddress === undefined) {
    throw new Error("request capture failed");
  }
  return requestAddress;
}

/** Rewrites a hole's `created` to `days` ago, straight into the table. */
export function backdate(
  app: FastifyInstance,
  holeAddress: string,
  days: number,
) {
  app.db
    .prepare(
      `UPDATE holes
       SET created = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
       WHERE hole_address = ?`,
    )
    .run(`-${days} days`, holeAddress);
}
