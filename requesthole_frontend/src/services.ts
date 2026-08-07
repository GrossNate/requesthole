import axios from "axios";
import type { RequestObject } from "./types";

const BASE_URL = import.meta.env.DEV ? "http://localhost:3000" : "";

async function addHole() {
  const response = await axios.post(`${BASE_URL}/api/hole`);
  if (response.status === 201) {
    return response.data;
  } else {
    throw new Error(`Failed to create hole. Status: ${response.status}`);
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
  const response = await axios.get(`${BASE_URL}/api/hole/${holeAddress}`);
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error(`Failed to get hole. Status: ${response.status}`);
  }
}

async function deleteHole(holeAddress: string): Promise<boolean> {
  const response = await axios.delete(`${BASE_URL}/api/hole/${holeAddress}`);
  return response.status === 204;
}

async function getRequests(holeAddress: string): Promise<RequestObject[]> {
  const response = await axios.get(
    `${BASE_URL}/api/hole/${holeAddress}/requests`,
  );
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error("Failed to get requests.");
  }
}

async function getRequest(requestAddress: string): Promise<RequestObject> {
  const response = await axios.get(`${BASE_URL}/api/request/${requestAddress}`);
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error("Failed to get request.");
  }
}

async function deleteRequest(requestAddress: string): Promise<boolean> {
  const response = await axios.delete(
    `${BASE_URL}/api/request/${requestAddress}`,
  );
  return response.status === 204;
}

/**
 * The captured body as text, exactly as it was sent.
 *
 * `responseType: "text"` with an identity transform is load-bearing: axios
 * otherwise JSON-parses any string body it can, so a captured `text/plain`
 * body of `"hello"` would arrive with its quotes stripped and `123` would
 * arrive as a number. This is a request inspector — the bytes must render
 * verbatim.
 */
async function getBody(requestAddress: string): Promise<string> {
  const response = await axios.get<string>(
    `${BASE_URL}/api/request/${requestAddress}/body`,
    { responseType: "text", transformResponse: [(data: string) => data] },
  );
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error("Failed to get request body.");
  }
}

/**
 * The captured body as raw bytes, for content the viewer hands over as a file
 * rather than rendering. Fetching the bytes is what lets the download go
 * through a blob the app creates, instead of navigating to the body endpoint.
 */
async function getBodyBytes(requestAddress: string): Promise<ArrayBuffer> {
  const response = await axios.get<ArrayBuffer>(
    `${BASE_URL}/api/request/${requestAddress}/body`,
    { responseType: "arraybuffer" },
  );
  return response.data;
}

export default {
  addHole,
  getHoles,
  getHole,
  deleteHole,
  getRequests,
  getRequest,
  deleteRequest,
  getBody,
  getBodyBytes,
  BASE_URL,
};
