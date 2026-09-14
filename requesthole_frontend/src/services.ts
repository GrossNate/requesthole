import axios from "axios";
import { HoleGoneError, HoleLimitError } from "./errors";
import type { InstanceConfig, RequestObject } from "./types";

export interface BodyBytes {
  bytes: ArrayBuffer;
  /** The backend refused to serve this body (media off). */
  withheld: boolean;
}
import { isAddress } from "./utils/address";

const BASE_URL = import.meta.env.DEV ? "http://localhost:3000" : "";

/**
 * How long the request-list snapshot may go without receiving a byte. The hole
 * view runs one snapshot at a time and queues anything asked for while one is
 * out, so a request that never answers would wedge that queue for good — no
 * re-sync, no recovery, until a reload. A rejection it can see beats a promise
 * it cannot.
 *
 * Idle, not total: `/requests` is unpaginated and returns every row with its
 * headers, so a whole-transfer deadline would make a busy hole on a slow link
 * permanently unloadable rather than merely slow — and it would abort at the
 * same point on every retry.
 */
const SNAPSHOT_IDLE_MS = 15_000;

/**
 * Addresses reach this layer from the route, where they are whatever a link
 * said they were, and every one of them is interpolated into a request path.
 * Encoding and checking here rather than at each call site means a new caller
 * cannot forget: `useParams` decodes, so "a%2F..%2Fapi" is a path the visitor
 * chose, not an address.
 */
function addressPath(address: string): string {
  if (!isAddress(address)) throw new Error("Not a valid address.");
  return encodeURIComponent(address);
}

async function addHole() {
  try {
    const response = await axios.post(`${BASE_URL}/api/hole`);
    if (response.status === 201) {
      return response.data;
    } else {
      throw new Error(`Failed to create hole. Status: ${response.status}`);
    }
  } catch (error) {
    // Refusals are the backend working as designed, not failing: say which.
    const response = (
      error as {
        response?: { status?: number; headers?: Record<string, unknown> };
      } | null
    )?.response;
    if (response?.status === 429) {
      // The hourly limiter names its wait; the share refusal never does.
      const wait = Number(response.headers?.["retry-after"]);
      if (Number.isFinite(wait) && wait > 0) {
        throw new HoleLimitError("rate-limit", wait);
      }
      throw new HoleLimitError("share");
    }
    if (response?.status === 503) throw new HoleLimitError("full");
    throw error;
  }
}

async function getHoles() {
  const response = await axios.get(`${BASE_URL}/api/holes`);
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error(`Failed to get holes. Status: ${response.status}`);
  }
}

async function getHole(holeAddress: string) {
  const response = await axios.get(
    `${BASE_URL}/api/hole/${addressPath(holeAddress)}`,
  );
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error(`Failed to get hole. Status: ${response.status}`);
  }
}

async function deleteHole(holeAddress: string): Promise<boolean> {
  const response = await axios.delete(
    `${BASE_URL}/api/hole/${addressPath(holeAddress)}`,
  );
  return response.status === 204;
}

async function getRequests(holeAddress: string): Promise<RequestObject[]> {
  const path = `${BASE_URL}/api/hole/${addressPath(holeAddress)}/requests`;
  const stalled = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  // Every chunk that lands is evidence the answer is still coming, so the
  // clock starts over rather than counting down against the whole transfer.
  const restartIdleClock = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stalled.abort(), SNAPSHOT_IDLE_MS);
  };
  restartIdleClock();
  try {
    const response = await axios.get(path, {
      signal: stalled.signal,
      onDownloadProgress: restartIdleClock,
    });
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error("Failed to get requests.");
    }
  } catch (error) {
    // 404 means the hole is gone, where an empty hole answers []. Worth a
    // type of its own: every other failure is retried, and this one never
    // will succeed.
    const status = (error as { response?: { status?: number } } | null)
      ?.response?.status;
    if (status === 404) throw new HoleGoneError();
    throw error;
  } finally {
    clearTimeout(idle);
  }
}

async function getRequest(requestAddress: string): Promise<RequestObject> {
  const response = await axios.get(
    `${BASE_URL}/api/request/${addressPath(requestAddress)}`,
  );
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error("Failed to get request.");
  }
}

async function deleteRequest(requestAddress: string): Promise<boolean> {
  const response = await axios.delete(
    `${BASE_URL}/api/request/${addressPath(requestAddress)}`,
  );
  return response.status === 204;
}

/**
 * The captured body as raw bytes — the viewer's single body fetch. Bytes, not
 * text, for two reasons: the viewer decodes text per the content-type's
 * charset itself (axios would guess), and downloads go through a blob the app
 * creates instead of navigating to the body endpoint.
 */
async function getBodyBytes(requestAddress: string): Promise<BodyBytes> {
  const response = await axios.get<ArrayBuffer>(
    `${BASE_URL}/api/request/${addressPath(requestAddress)}/body`,
    { responseType: "arraybuffer" },
  );
  return {
    bytes: response.data,
    // With ALLOW_MEDIA off the backend answers a body it will not serve
    // (captured while media was on) with an empty 200 and this header.
    withheld: response.headers?.["x-requesthole-body-withheld"] === "true",
  };
}

/**
 * What the viewer needs to know about the instance. Fail-closed: a failed
 * fetch or anything but a boolean `allowMedia` reads as media off, so a
 * missing answer can never switch image rendering on.
 */
async function getConfig(): Promise<InstanceConfig> {
  try {
    const response = await axios.get<unknown>(`${BASE_URL}/api/config`);
    const data = response.data as { allowMedia?: unknown } | null;
    return { allowMedia: data?.allowMedia === true };
  } catch (error) {
    console.error(error);
    return { allowMedia: false };
  }
}

export default {
  addHole,
  getHoles,
  getHole,
  deleteHole,
  getRequests,
  getRequest,
  deleteRequest,
  getBodyBytes,
  getConfig,
  BASE_URL,
};
