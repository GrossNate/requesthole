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
    throw new Error(`Failed to get requests.`);
  }
  
}

export default { addHole, getHoles, getHole, deleteHole, getRequests };
