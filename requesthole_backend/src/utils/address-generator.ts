import { v4 } from "uuid";
import { crc32 } from "node:zlib";
import base62 from "base62";

function generateAddress() {
  return base62.encode(crc32(v4()));
}

export default generateAddress;