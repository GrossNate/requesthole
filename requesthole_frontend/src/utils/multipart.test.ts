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

    const { parts, skipped } = parseMultipart(body, "B")!;
    expect(parts).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(parts[0].name).toBe("alpha");
    expect(decode(parts[0].bytes)).toBe("first value");
    expect(parts[1].name).toBe("beta");
    expect(decode(parts[1].bytes)).toBe("second value");
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

    const { parts } = parseMultipart(body, "boundary77")!;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      name: "upload",
      filename: "tiny.png",
      contentType: "image/png",
    });
    expect(Array.from(parts[0].bytes)).toEqual(Array.from(fileBytes));
  });

  // RFC 2046 only forbids CRLF+"--boundary" inside part content; a bare
  // "--B" mid-line is legal content and must not split the part — that would
  // silently show wrong content in an inspector.
  it("does not split on a boundary sequence inside part content", () => {
    const body = encode(
      [
        "--B",
        'content-disposition: form-data; name="alpha"',
        "",
        "dashes --B here",
        "--B--",
        "",
      ].join("\r\n"),
    );

    const { parts } = parseMultipart(body, "B")!;
    expect(parts).toHaveLength(1);
    expect(decode(parts[0].bytes)).toBe("dashes --B here");
  });

  // A part with no headers at all is legal (empty header block, then the
  // blank line); it must be kept, not dropped.
  it("keeps a part whose header block is empty", () => {
    const body = encode("--B\r\n\r\nbare value\r\n--B--\r\n");

    const { parts } = parseMultipart(body, "B")!;
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBeUndefined();
    expect(decode(parts[0].bytes)).toBe("bare value");
  });

  // An inspector must not silently omit content: a region that cannot be
  // parsed is counted so the viewer can say so.
  it("counts unparseable regions instead of dropping them silently", () => {
    const body = encode(
      [
        "--B",
        "header-with-no-blank-line-and-no-body",
        "--B",
        'content-disposition: form-data; name="ok"',
        "",
        "good part",
        "--B--",
        "",
      ].join("\r\n"),
    );

    const { parts, skipped } = parseMultipart(body, "B")!;
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("ok");
    expect(skipped).toBe(1);
  });

  // The boundary comes from an attacker-controlled header; a body that does
  // not actually contain it must classify as unknown, never throw.
  it("returns undefined when the boundary never appears or no part is complete", () => {
    expect(parseMultipart(encode("no delimiters here"), "B")).toBeUndefined();
    expect(
      parseMultipart(encode("--B only one delimiter"), "B"),
    ).toBeUndefined();
    expect(parseMultipart(encode("anything"), "")).toBeUndefined();
  });
});
