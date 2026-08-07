import { describe, it, expect } from "vitest";
import { parseMultipart } from "./multipart";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("parseMultipart", () => {
  it("splits a two-part body into named parts with their content", () => {
    const body = encode(
      [
        "--B",
        'content-disposition: form-data; name="alpha"',
        "",
        "first value",
        "--B",
        'content-disposition: form-data; name="beta"',
        "",
        "second value",
        "--B--",
        "",
      ].join("\r\n"),
    );

    const parts = parseMultipart(body, "B");
    expect(parts).toHaveLength(2);
    expect(parts![0].name).toBe("alpha");
    expect(decode(parts![0].bytes)).toBe("first value");
    expect(parts![1].name).toBe("beta");
    expect(decode(parts![1].bytes)).toBe("second value");
  });

  // A file upload carries a filename and its own content-type, and its bytes
  // may be binary — including CRLFs — so the part body must be taken verbatim
  // up to the boundary, not line-split.
  it("captures a file part's filename, content-type, and binary bytes", () => {
    const head = encode(
      [
        "--boundary77",
        'content-disposition: form-data; name="upload"; filename="tiny.png"',
        "content-type: image/png",
        "",
        "",
      ].join("\r\n"),
    );
    const fileBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const tail = encode("\r\n--boundary77--\r\n");
    const body = new Uint8Array([...head, ...fileBytes, ...tail]);

    const parts = parseMultipart(body, "boundary77");
    expect(parts).toHaveLength(1);
    expect(parts![0]).toMatchObject({
      name: "upload",
      filename: "tiny.png",
      contentType: "image/png",
    });
    expect(Array.from(parts![0].bytes)).toEqual(Array.from(fileBytes));
  });

  // The boundary comes from an attacker-controlled header; a body that does
  // not actually contain it must classify as unknown, never throw.
  it("returns undefined when the boundary never appears or no part is complete", () => {
    expect(parseMultipart(encode("no delimiters here"), "B")).toBeUndefined();
    expect(parseMultipart(encode("--B only one delimiter"), "B")).toBeUndefined();
    expect(parseMultipart(encode("anything"), "")).toBeUndefined();
  });
});
