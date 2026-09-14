import { describe, it, expect } from "vitest";
import {
  describeDrop,
  describePartDrop,
  formatByteCount,
  parseBodyDropped,
  summarizeDrop,
} from "./bodyDropped";

const whole = (fields: Record<string, unknown>) =>
  parseBodyDropped(
    JSON.stringify({ reason: "type", bytes: 10, contentType: null, ...fields }),
  )!;

describe("parseBodyDropped", () => {
  it("reads a whole-body description", () => {
    expect(
      parseBodyDropped(
        '{"reason":"type","bytes":48213,"contentType":"image/png"}',
      ),
    ).toEqual({
      kind: "whole",
      reason: "type",
      bytes: 48213,
      contentType: "image/png",
    });
  });

  it("reads a multipart description", () => {
    expect(
      parseBodyDropped(
        '{"parts":[{"index":2,"name":"avatar","filename":"me.png","contentType":"image/png","bytes":48213,"reason":"type"}]}',
      ),
    ).toEqual({
      kind: "parts",
      parts: [
        {
          index: 2,
          name: "avatar",
          filename: "me.png",
          contentType: "image/png",
          bytes: 48213,
          reason: "type",
        },
      ],
    });
  });

  it.each([null, undefined, "", "not json", "{}", '{"parts":"x"}', "[]"])(
    "reads %j as nothing dropped",
    (text) => {
      expect(parseBodyDropped(text)).toBeUndefined();
    },
  );
});

describe("formatByteCount", () => {
  it.each([
    [1, "1 byte"],
    [512, "512 bytes"],
    [1024, "1 KB"],
    [48213, "47 KB"],
    [1048576, "1.0 MB"],
    [1572864, "1.5 MB"],
  ])("formats %d as %s", (bytes, expected) => {
    expect(formatByteCount(bytes)).toBe(expected);
  });
});

describe("describeDrop", () => {
  it.each([
    [
      { reason: "type", bytes: 48213, contentType: "image/png" },
      "Media/binary data dropped: 47 KB, image/png",
    ],
    [
      {
        reason: "encoding",
        bytes: 3072,
        contentType: "application/json",
        contentEncoding: "gzip",
      },
      "Media/binary data dropped: compressed body (gzip), 3 KB, application/json",
    ],
    [
      {
        reason: "signature",
        bytes: 46,
        contentType: "text/plain",
        signature: "svg",
      },
      "Media/binary data dropped: looks like an SVG image, 46 bytes, text/plain",
    ],
    [
      { reason: "bytes", bytes: 12, contentType: null },
      "Media/binary data dropped: not plain text, 12 bytes, no content-type",
    ],
    [
      { reason: "malformed", bytes: 5, contentType: "text/plain, image/png" },
      "Media/binary data dropped: unreadable content-type, 5 bytes, text/plain, image/png",
    ],
  ])("describes %j", (fields, expected) => {
    const dropped = whole(fields);
    expect(dropped.kind === "whole" && describeDrop(dropped)).toBe(expected);
  });

  it("says a form did not parse rather than blaming its content-type", () => {
    const dropped = whole({
      reason: "form",
      bytes: 62,
      contentType: "multipart/form-data; boundary=b",
    });
    expect(dropped.kind === "whole" && describeDrop(dropped)).toBe(
      "Media/binary data dropped: form did not parse, 62 bytes, multipart/form-data; boundary=b",
    );
  });

  it("names every embedded vCard medium, not only a photo", () => {
    const dropped = whole({ reason: "signature", signature: "vcard" });
    expect(dropped.kind === "whole" && describeDrop(dropped)).toContain(
      "looks like a vCard with embedded media",
    );
  });

  it("names a FITS image", () => {
    const dropped = whole({ reason: "signature", signature: "fits" });
    expect(dropped.kind === "whole" && describeDrop(dropped)).toContain(
      "looks like a FITS image",
    );
  });

  it("names a signature it does not know by its raw name", () => {
    const dropped = whole({ reason: "signature", signature: "newfmt" });
    expect(dropped.kind === "whole" && describeDrop(dropped)).toContain(
      "looks like newfmt",
    );
  });
});

describe("describePartDrop", () => {
  it("describes one part", () => {
    expect(
      describePartDrop({
        index: 1,
        name: "avatar",
        filename: "me.png",
        contentType: "image/png",
        bytes: 48213,
        reason: "type",
      }),
    ).toBe("Media/binary data dropped: 47 KB, image/png");
  });

  it("describes a part dropped for Content-Transfer-Encoding", () => {
    expect(
      describePartDrop({
        index: 0,
        name: "f",
        filename: null,
        contentType: null,
        bytes: 8,
        reason: "encoding",
      }),
    ).toBe("Media/binary data dropped: encoded part, 8 bytes, no content-type");
  });
});

describe("summarizeDrop", () => {
  it("summarizes a whole body as its description", () => {
    expect(
      summarizeDrop(whole({ bytes: 48213, contentType: "image/png" })),
    ).toBe("Media/binary data dropped: 47 KB, image/png");
  });

  it("summarizes dropped parts with a count and total size", () => {
    const part = {
      name: null,
      filename: null,
      contentType: "image/png",
      reason: "type",
    };
    expect(
      summarizeDrop(
        parseBodyDropped(
          JSON.stringify({
            parts: [
              { ...part, index: 0, bytes: 2048 },
              { ...part, index: 3, bytes: 1024 },
            ],
          }),
        )!,
      ),
    ).toBe("Media/binary data dropped from 2 parts: 3 KB, image/png");
    expect(
      summarizeDrop(
        parseBodyDropped(
          JSON.stringify({ parts: [{ ...part, index: 0, bytes: 2048 }] }),
        )!,
      ),
    ).toBe("Media/binary data dropped from 1 part: 2 KB, image/png");
  });
});

describe("summarizeDrop with several parts", () => {
  it("names each distinct part type", () => {
    const part = { name: null, filename: null, reason: "type" };
    expect(
      summarizeDrop(
        parseBodyDropped(
          JSON.stringify({
            parts: [
              { ...part, index: 0, bytes: 2048, contentType: "image/png" },
              { ...part, index: 1, bytes: 1024, contentType: "video/mp4" },
              { ...part, index: 2, bytes: 1024, contentType: "image/png" },
              { ...part, index: 3, bytes: 1024, contentType: null },
            ],
          }),
        )!,
      ),
    ).toBe(
      "Media/binary data dropped from 4 parts: 5 KB, image/png, video/mp4, no content-type",
    );
  });
});
