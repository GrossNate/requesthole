import { v4 } from "uuid";
import { crc32 } from "node:zlib";
import base62 from "base62";

// crc32 is a 32-bit unsigned value, so its base62 encoding is at most 6 chars
// (62^5 < 2^32 < 62^6). Left-pad with base62 zeros to guarantee a fixed 6-char
// address — the collect route and its Nginx mirror both match exactly ^[a-zA-Z0-9]{6}$.
export const ADDRESS_LENGTH = 6;

function generateAddress() {
  return base62.encode(crc32(v4())).padStart(ADDRESS_LENGTH, "0");
}

export default generateAddress;