import { describe, it, expect } from "vitest";
import { filterBody, type BodyDrop } from "../src/body-filter";

const text = (value: string) => Buffer.from(value, "utf8");
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe("filterBody", () => {
  it("keeps a JSON webhook unchanged", () => {
    const body = text('{"event":"ping"}');
    const result = filterBody(body, { "content-type": "application/json" });
    expect(result.dropped).toBeNull();
    expect(result.body).toEqual(body);
  });

  it("drops a PNG and describes it", () => {
    const result = filterBody(PNG, { "content-type": "image/png" });
    expect(result.body).toBeNull();
    expect(result.dropped).toEqual({
      reason: "type",
      bytes: PNG.length,
      contentType: "image/png",
    });
  });

  describe("content-type parsing", () => {
    const body = text("hello");

    it.each([
      "text",
      "/plain",
      "text/",
      "text /plain",
      "te xt/plain",
      "text/pl@in",
      "text/plain, image/png",
      "text/plain garbage",
      "text/plain; charset",
      "text/plain; charset=",
      "text/plain; =utf-8",
      'text/plain; charset="utf-8',
      "text/plain; charset=utf 8",
      "",
    ])("drops the malformed type %j", (contentType) => {
      expect(filterBody(body, { "content-type": contentType }).dropped).toEqual(
        { reason: "malformed", bytes: 5, contentType },
      );
    });

    it.each(["*/*", "text/*", "*/plain"])(
      "drops the wildcard %j",
      (contentType) => {
        expect(
          (
            filterBody(body, { "content-type": contentType })
              .dropped as BodyDrop | null
          )?.reason,
        ).toBe("malformed");
      },
    );

    it("drops a request carrying more than one content-type", () => {
      expect(
        filterBody(body, { "content-type": ["text/plain", "image/png"] })
          .dropped,
      ).toEqual({
        reason: "malformed",
        bytes: 5,
        contentType: "text/plain, image/png",
      });
    });

    it("drops a duplicated parameter, whatever its case", () => {
      expect(
        (
          filterBody(body, {
            "content-type": "text/plain; charset=utf-8; CHARSET=latin1",
          }).dropped as BodyDrop | null
        )?.reason,
      ).toBe("malformed");
    });

    it.each([
      "utf-7",
      "UTF-7",
      "utf-16",
      "utf-16le",
      "UTF-16BE",
      "utf-32",
      "utf-32le",
      '"utf-7"',
    ])("drops the charset %s", (charset) => {
      expect(
        (
          filterBody(body, { "content-type": `text/plain; charset=${charset}` })
            .dropped as BodyDrop | null
        )?.reason,
      ).toBe("type");
    });

    it.each([
      "text/plain",
      "TEXT/Plain",
      "text/plain;charset=utf-8",
      "text/plain ; charset=UTF-8",
      'text/plain; charset="utf-8"',
      'text/plain; name="a \\"quoted\\" ; value"',
      "text/plain;",
      "text/plain; ; charset=utf-8",
      "text/plain; charset=iso-8859-1",
      "\ttext/plain\t",
    ])("accepts the well-formed %j", (contentType) => {
      const result = filterBody(body, { "content-type": contentType });
      expect(result.dropped).toBeNull();
      expect(result.body).toEqual(body);
    });

    // Pub/Sub unwrapped push sends no content-type at all: legitimate, and
    // gated as text/plain.
    it("gates a missing content-type as text/plain", () => {
      const result = filterBody(body, {});
      expect(result.dropped).toBeNull();
      expect(result.body).toEqual(body);
    });
  });

  describe("encodings", () => {
    const body = text('{"a":1}');
    const json = { "content-type": "application/json" };

    it.each(["", "identity", "IDENTITY", " identity "])(
      "keeps content-encoding %j",
      (encoding) => {
        const result = filterBody(body, {
          ...json,
          "content-encoding": encoding,
        });
        expect(result.dropped).toBeNull();
        expect(result.body).toEqual(body);
      },
    );

    it.each(["gzip", "br", "deflate", "gzip, identity", "identity, gzip"])(
      "drops content-encoding %j without decompressing",
      (encoding) => {
        expect(
          filterBody(body, { ...json, "content-encoding": encoding }).dropped,
        ).toEqual({
          reason: "encoding",
          bytes: body.length,
          contentType: "application/json",
          contentEncoding: encoding,
        });
      },
    );

    it("drops a content-encoding sent twice when either names a coding", () => {
      expect(
        (
          filterBody(body, {
            ...json,
            "content-encoding": ["identity", "gzip"],
          }).dropped as BodyDrop | null
        )?.reason,
      ).toBe("encoding");
    });

    it.each(["chunked", "Chunked"])(
      "keeps transfer-encoding %j, which Node decodes",
      (encoding) => {
        expect(
          filterBody(body, { ...json, "transfer-encoding": encoding }).dropped,
        ).toBeNull();
      },
    );

    it.each(["gzip, chunked", "deflate", "chunked, gzip"])(
      "drops transfer-encoding %j",
      (encoding) => {
        expect(
          filterBody(body, { ...json, "transfer-encoding": encoding }).dropped,
        ).toEqual({
          reason: "encoding",
          bytes: body.length,
          contentType: "application/json",
          contentEncoding: encoding,
        });
      },
    );
  });

  describe("declared-type allowlist", () => {
    const body = text("plain text");
    const verdict = (contentType: string) =>
      (
        filterBody(body, { "content-type": contentType })
          .dropped as BodyDrop | null
      )?.reason ?? "kept";

    // The top-level gate runs before suffix rules: each of these would match a
    // +json/+xml rule if it did not.
    it.each([
      "image/png",
      "image/svg+xml",
      "audio/mpeg",
      "video/mp4",
      "video/lottie+json",
      "font/woff2",
      "model/gltf+json",
      "haptics/ivs",
      "message/rfc822",
      "example/foo",
      "multipart/mixed",
      "multipart/related",
      "multipart/alternative",
      "chemical/x-pdb",
      "x-custom/json",
    ])("drops the top-level type of %s", (contentType) => {
      expect(verdict(contentType)).toBe("type");
    });

    it.each([
      "text/rtf",
      "text/vcard",
      "text/x-vcard",
      "text/directory",
      "text/calendar",
      "text/uuencode",
      "text/x-uuencode",
    ])("drops %s, which opens with embedded images decoded", (contentType) => {
      expect(verdict(contentType)).toBe("type");
    });

    it.each([
      "text/plain",
      "text/html",
      "text/csv",
      "text/markdown",
      "text/xml",
      "text/javascript",
      "text/x-anything",
    ])("keeps %s", (contentType) => {
      expect(verdict(contentType)).toBe("kept");
    });

    it.each([
      "application/vnd.api+json",
      "application/problem+json",
      "application/cloudevents+json",
      "application/atom+xml",
      "application/xhtml+xml",
      "application/vnd.foo+yaml",
      "application/foo+csv",
      "application/foo+jwt",
      "application/foo+sd-jwt",
      "application/foo+jws",
    ])("keeps the structured-suffix type %s", (contentType) => {
      expect(verdict(contentType)).toBe("kept");
    });

    it.each(["application/smil+xml", "application/dash+xml"])(
      "drops %s despite its +xml suffix",
      (contentType) => {
        expect(verdict(contentType)).toBe("type");
      },
    );

    it.each([
      "json",
      "x-json",
      "x-www-form-urlencoded",
      "xml",
      "xml-dtd",
      "xml-external-parsed-entity",
      "ndjson",
      "x-ndjson",
      "jsonl",
      "jsonlines",
      "x-jsonlines",
      "yaml",
      "x-yaml",
      "toml",
      "x-toml",
      "javascript",
      "x-javascript",
      "ecmascript",
      "csp-report",
      "graphql",
      "sql",
      "csv",
      "jwt",
      "jose",
      "x-sh",
      "x-shellscript",
      "jsonpath",
      "sparql-query",
      "sparql-update",
      "n-triples",
      "n-quads",
      "trig",
      "x-amz-json-1.0",
      "x-amz-json-1.1",
    ])("keeps application/%s", (subtype) => {
      expect(verdict(`application/${subtype}`)).toBe("kept");
    });

    it.each([
      "pdf",
      "postscript",
      "rtf",
      "mbox",
      "octet-stream",
      "protobuf",
      "json-seq",
      "zip",
      "x-unlisted",
    ])("drops application/%s", (subtype) => {
      expect(verdict(`application/${subtype}`)).toBe("type");
    });
  });

  describe("byte check", () => {
    const plain = { "content-type": "text/plain" };
    const bytes = (...values: number[]) => Buffer.from(values);

    it.each([
      ["NUL", bytes(0x61, 0x00, 0x62)],
      ["a C0 control (BEL)", bytes(0x61, 0x07)],
      ["ESC", bytes(0x1b, 0x5b, 0x33, 0x31, 0x6d)],
      ["a lone continuation byte", bytes(0x61, 0x80)],
      ["an overlong form", bytes(0xc0, 0xaf)],
      ["a UTF-16 surrogate", bytes(0xed, 0xa0, 0x80)],
      ["a truncated sequence", bytes(0x61, 0xe2, 0x82)],
      ["a byte never valid in UTF-8", bytes(0xff, 0xfe)],
    ])("drops a body containing %s", (_, body) => {
      expect(filterBody(body, plain).dropped).toEqual({
        reason: "bytes",
        bytes: body.length,
        contentType: "text/plain",
      });
    });

    it.each([
      ["tab, LF, CR and form feed", text("a\tb\nc\r\nd\fe")],
      ["DEL", bytes(0x61, 0x7f)],
      ["a C1 control", text("a\u0085b")],
      ["a leading BOM", text("\ufeffhello")],
      ["multi-byte text", text("héllo — 世界 🎉")],
    ])("keeps %s", (_, body) => {
      const result = filterBody(body, plain);
      expect(result.dropped).toBeNull();
      expect(result.body).toEqual(body);
    });

    it("keeps an empty body and records nothing, whatever its type", () => {
      expect(
        filterBody(Buffer.alloc(0), { "content-type": "image/png" }),
      ).toEqual({ body: Buffer.alloc(0), dropped: null });
      expect(filterBody(null, { "content-type": "image/png" })).toEqual({
        body: null,
        dropped: null,
      });
    });

    it("drops binary bytes sent with no content-type, recording none", () => {
      expect(filterBody(PNG, {}).dropped).toEqual({
        reason: "bytes",
        bytes: PNG.length,
        contentType: null,
      });
    });
  });

  describe("signature check", () => {
    const plain = { "content-type": "text/plain" };

    it.each([
      ["pdf", "%PDF-1.7\n1 0 obj"],
      ["postscript", "%!PS-Adobe-3.0\n"],
      ["rtf", "{\\rtf1\\ansi hello}"],
      ["svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      ["svg", "<SVG></SVG>"],
      [
        "svg",
        '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
      ],
      [
        "svg",
        '<?xml version="1.0"?><!-- made by hand --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [ <!ENTITY a "b"> ]>\n<svg/>',
      ],
      ["svg", "<!-- a comment first -->\n<svg></svg>"],
      ["xpm", '/* XPM */\nstatic char * x[] = {"1 1 1 1"};'],
      ["xbm", "#define icon_width 16\n#define icon_height 16\n"],
      ["netpbm", "P1\n2 2\n0 1\n1 0\n"],
      ["netpbm", "P2 4 4 15\n"],
      ["netpbm", "P3\n# a comment\n1 1\n255\n255 0 0\n"],
      [
        "vcard",
        "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A\r\nPHOTO;ENCODING=b:AAAA\r\nEND:VCARD\r\n",
      ],
      [
        "vcard",
        "begin:vcard\nitem1.photo:data:image/png;base64,AAAA\nend:vcard\n",
      ],
      ["uuencode", "begin 644 cat.png\nM4$Y'\n`\nend\n"],
      ["mime", "MIME-Version: 1.0\r\nContent-Type: multipart/mixed\r\n\r\n"],
      ["mime", "mime-version: 1.0\r\n"],
    ])("drops a body that starts like %s", (signature, value) => {
      const body = text(value);
      expect(filterBody(body, plain).dropped).toEqual({
        reason: "signature",
        bytes: body.length,
        contentType: "text/plain",
        signature,
      });
    });

    it("looks past a BOM and leading whitespace", () => {
      for (const prefix of ["\uFEFF", "  \r\n\t", "\uFEFF\n\n"]) {
        expect(
          (
            filterBody(text(`${prefix}<svg></svg>`), plain)
              .dropped as BodyDrop | null
          )?.signature,
        ).toBe("svg");
        expect(
          (
            filterBody(text(`${prefix}%PDF-1.4`), plain)
              .dropped as BodyDrop | null
          )?.signature,
        ).toBe("pdf");
      }
    });

    // Signatures are anchored (PDF and PostScript to a line start): scanning
    // the body would contradict the accepted base64 limit and break
    // legitimate JSON.
    it.each([
      ["JSON carrying a data: URI", '{"avatar":"data:image/png;base64,iVBOR"}'],
      [
        "HTML with inline SVG",
        "<!DOCTYPE html><html><body><svg></svg></body></html>",
      ],
      ["XML whose root is not svg", '<?xml version="1.0"?><feed><svg/></feed>'],
      ["prose starting with P1", "P1 is the priority"],
      ["prose starting with a P-number", "P500 errors overnight"],
      ["prose starting with P7", "P7 is the plan"],
      ["prose starting with PF", "PF is short for power factor"],
      [
        "a vCard without a photo",
        "BEGIN:VCARD\nVERSION:4.0\nFN:Ada\nEND:VCARD\n",
      ],
      ["a #define that is not an XBM", "#define DEBUG 1\n"],
      ["prose starting with begin", "begin the process now"],
    ])("keeps %s", (_, value) => {
      const body = text(value);
      const result = filterBody(body, plain);
      expect(result.dropped).toBeNull();
      expect(result.body).toEqual(body);
    });
  });

  describe("multipart/form-data, part by part", () => {
    const form = { "content-type": "multipart/form-data; boundary=XyZ" };
    const crlf = (...lines: string[]) => lines.join("\r\n");
    const field = (name: string, value: string) =>
      crlf(
        "--XyZ",
        `Content-Disposition: form-data; name="${name}"`,
        "",
        value,
      );

    const imageForm = Buffer.concat([
      text(crlf("preamble bytes", field("title", "hello"), "--XyZ")),
      text("\r\n"),
      text(
        crlf(
          'Content-Disposition: form-data; name="avatar"; filename="me.png"',
          "Content-Type: image/png",
          "",
          "",
        ),
      ),
      PNG,
      text("\r\n"),
      text(crlf(field("note", "bye"), "--XyZ--", "epilogue junk")),
    ]);

    it("keeps text fields and a dropped file's headers, and records the drop", () => {
      const result = filterBody(imageForm, form);
      expect(result.body!.toString("utf8")).toBe(
        crlf(
          field("title", "hello"),
          "--XyZ",
          'Content-Disposition: form-data; name="avatar"; filename="me.png"',
          "Content-Type: image/png",
          "",
          "",
          field("note", "bye"),
          "--XyZ--",
          "",
        ),
      );
      expect(result.dropped).toEqual({
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
    });

    it("stores a rebuilt body the filter then leaves alone", () => {
      const once = filterBody(imageForm, form).body!;
      const twice = filterBody(once, form);
      expect(twice.body).toEqual(once);
      expect(twice.dropped).toBeNull();
    });

    it("discards preamble and epilogue even when every part is kept", () => {
      const body = text(
        crlf("preamble", field("a", "1"), "--XyZ--", "epilogue"),
      );
      const result = filterBody(body, form);
      expect(result.dropped).toBeNull();
      expect(result.body!.toString("utf8")).toBe(
        crlf(field("a", "1"), "--XyZ--", ""),
      );
    });

    it("keeps a part with an empty header block", () => {
      const body = text(crlf("--XyZ", "", "bare", "--XyZ--", ""));
      expect(filterBody(body, form)).toEqual({ body, dropped: null });
    });

    it.each([
      [
        "a part with no content-type holding binary",
        ['Content-Disposition: form-data; name="f"'],
        PNG,
        { contentType: null, reason: "bytes" },
      ],
      [
        "a part carrying Content-Transfer-Encoding",
        [
          'Content-Disposition: form-data; name="f"',
          "Content-Transfer-Encoding: base64",
        ],
        text("aGVsbG8="),
        { contentType: null, reason: "encoding" },
      ],
      [
        "a nested multipart part",
        [
          'Content-Disposition: form-data; name="f"',
          "Content-Type: multipart/mixed; boundary=in",
        ],
        text("--in\r\n\r\nx\r\n--in--"),
        { contentType: "multipart/mixed; boundary=in", reason: "type" },
      ],
      [
        "a part with two content-types",
        [
          'Content-Disposition: form-data; name="f"',
          "Content-Type: text/plain",
          "Content-Type: image/png",
        ],
        text("x"),
        { contentType: "text/plain, image/png", reason: "malformed" },
      ],
      [
        "an SVG sent as a text/plain part",
        [
          'Content-Disposition: form-data; name="f"',
          "Content-Type: text/plain",
        ],
        text("<svg></svg>"),
        { contentType: "text/plain", reason: "signature", signature: "svg" },
      ],
    ])("drops %s", (_, headerLines, content, expected) => {
      const body = Buffer.concat([
        text(crlf("--XyZ", ...headerLines, "", "")),
        content,
        text("\r\n--XyZ--\r\n"),
      ]);
      expect(filterBody(body, form).dropped).toEqual({
        parts: [
          {
            index: 0,
            name: "f",
            filename: null,
            bytes: content.length,
            ...expected,
          },
        ],
      });
    });

    // Fail closed: a form that cannot be parsed into parts is dropped whole
    // as malformed. Whole-body checks cannot see an SVG or base64 part inside
    // it, so falling back to them would let those through.
    it.each([
      ["no boundary parameter", "multipart/form-data"],
      ["a boundary that never appears", "multipart/form-data; boundary=nope"],
      [
        "a boundary longer than RFC 2046's 70 characters",
        `multipart/form-data; boundary=${"q".repeat(71)}`,
      ],
    ])("drops a form with %s as unparseable", (_, contentType) => {
      for (const body of [imageForm, text("just some text")]) {
        expect(filterBody(body, { "content-type": contentType })).toEqual({
          body: null,
          dropped: { reason: "form", bytes: body.length, contentType },
        });
      }
    });

    it("accepts a boundary of exactly 70 characters", () => {
      const boundary = "q".repeat(70);
      const body = text(`--${boundary}\r\n\r\nv\r\n--${boundary}--\r\n`);
      expect(
        filterBody(body, {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        }),
      ).toEqual({ body, dropped: null });
    });

    it("drops a form with an unparseable region whole", () => {
      const body = Buffer.concat([
        text(crlf("--XyZ", "no-blank-line", "")),
        PNG,
        text("\r\n"),
        text(crlf(field("ok", "fine"), "--XyZ--", "")),
      ]);
      expect(filterBody(body, form).dropped).toMatchObject({
        reason: "form",
      });
    });

    it("drops the body whole when a part's header block is not text", () => {
      const body = Buffer.concat([
        text("--XyZ\r\nX-Hidden: "),
        PNG.subarray(0, 4),
        text(
          '\r\nContent-Disposition: form-data; name="a"\r\n\r\nv\r\n--XyZ--\r\n',
        ),
      ]);
      expect(filterBody(body, form).dropped).toMatchObject({
        reason: "form",
      });
    });

    // Header blocks are stored verbatim, so they must be headers: a line with
    // no field name, or a bare CR or LF inside a line, is not.
    it.each([
      [
        "a line with no colon",
        'not a header\r\nContent-Disposition: form-data; name="a"',
      ],
      [
        "a bare LF inside a line",
        'X-A: 1\nsmuggled\r\nContent-Disposition: form-data; name="a"',
      ],
      [
        "an empty field name",
        ': value\r\nContent-Disposition: form-data; name="a"',
      ],
    ])("drops a form whose part header block has %s", (_, block) => {
      const body = text(`--XyZ\r\n${block}\r\n\r\nv\r\n--XyZ--\r\n`);
      expect(filterBody(body, form).dropped).toMatchObject({
        reason: "form",
      });
    });

    // Readers find a PDF or PostScript header anywhere in the first 1 KB, and
    // part headers are stored as sent.
    it.each([
      ["pdf", "%PDF-1.4"],
      ["postscript", "%!PS-Adobe-3.0"],
    ])(
      "drops a form carrying a %s header in a part header",
      (signature, marker) => {
        const body = text(
          `--XyZ\r\nContent-Disposition: form-data; name="${marker}"\r\n\r\nv\r\n--XyZ--\r\n`,
        );
        expect(filterBody(body, form).dropped).toMatchObject({
          reason: "signature",
          signature,
        });
      },
    );

    // The longest boundary the filter accepts, over a megabyte of filler that
    // almost matches it at every step: the delimiter search's worst case.
    it("stays fast on the longest accepted boundary with near-miss filler", () => {
      const boundary = "q".repeat(70);
      const filler = `--${"q".repeat(69)}z`.repeat(14_000);
      const body = text(
        `--${boundary}\r\n\r\n${filler}\r\n--${boundary}--\r\n`,
      );
      const started = performance.now();
      const result = filterBody(body, {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      });
      expect(performance.now() - started).toBeLessThan(500);
      expect(result).toEqual({ body, dropped: null });
    });

    // RFC 2046 allows spaces or tabs after a delimiter, before its CRLF.
    it("keeps a form whose delimiter lines carry transport padding", () => {
      const body = text(
        '--XyZ  \r\nContent-Disposition: form-data; name="x"\r\n\r\nhi\r\n--XyZ--\t\r\n',
      );
      const result = filterBody(body, form);
      expect(result.dropped).toBeNull();
      expect(result.body!.toString("utf8")).toBe(
        '--XyZ\r\nContent-Disposition: form-data; name="x"\r\n\r\nhi\r\n--XyZ--\r\n',
      );
    });

    // RFC 2046 bchars: digits, letters and '()+_,-./:=? and space (not last).
    // Anything else is not a boundary, and would reach storage verbatim in
    // every delimiter line.
    it.each([
      ["a percent sign", "%PDF-1.4"],
      ["an exclamation mark", "%!PS"],
      ["a trailing space", "abc "],
      ["an asterisk", "a*b"],
    ])("drops a form whose boundary has %s", (_, boundary) => {
      expect(
        (
          filterBody(text(`--${boundary}\r\n\r\nv\r\n--${boundary}--\r\n`), {
            "content-type": `multipart/form-data; boundary="${boundary}"`,
          }).dropped as BodyDrop | null
        )?.reason,
      ).toBe("form");
    });

    it("accepts a boundary using every RFC 2046 character", () => {
      const boundary = "aZ09'()+_,-./:=? x";
      const body = text(`--${boundary}\r\n\r\nv\r\n--${boundary}--\r\n`);
      expect(
        filterBody(body, {
          "content-type": `multipart/form-data; boundary="${boundary}"`,
        }),
      ).toEqual({ body, dropped: null });
    });
  });

  // Review fixes (task 0008 review): the parsers see up to MAX_BODY_BYTES of
  // sender-controlled text at capture and again on every body read, so each
  // must stay linear.
  describe("parser cost", () => {
    const form = { "content-type": "multipart/form-data; boundary=b" };
    const withinASecond = (run: () => void) => {
      const started = performance.now();
      run();
      expect(performance.now() - started).toBeLessThan(1000);
    };

    it("parses a part content-type padded with a megabyte of whitespace quickly", () => {
      const body = text(
        `--b\r\nContent-Type: text/plain${" ".repeat(1_000_000)}x\r\n\r\nhi\r\n--b--\r\n`,
      );
      withinASecond(() => {
        expect(filterBody(body, form).dropped).toMatchObject({
          parts: [{ reason: "malformed" }],
        });
      });
    });

    it("parses a top-level content-type padded with whitespace quickly", () => {
      withinASecond(() => {
        expect(
          (
            filterBody(text("hi"), {
              "content-type": `text/plain${" ".repeat(100_000)}x`,
            }).dropped as BodyDrop | null
          )?.reason,
        ).toBe("malformed");
      });
    });

    it("parses a content-disposition of a megabyte of empty parameters quickly", () => {
      const body = text(
        `--b\r\nContent-Disposition: form-data${";".repeat(1_000_000)}name=x\r\n\r\nhi\r\n--b--\r\n`,
      );
      withinASecond(() => {
        expect(filterBody(body, form).dropped).toBeNull();
      });
    });
  });

  describe("signature check, review fixes", () => {
    const plain = { "content-type": "text/plain" };
    const signatureOf = (value: string) =>
      (filterBody(text(value), plain).dropped as BodyDrop | null)?.signature;

    it.each([
      [
        "a quoted '>' in the doctype",
        '<!DOCTYPE svg SYSTEM "a>b"><svg xmlns="http://www.w3.org/2000/svg"/>',
      ],
      [
        "a ']' inside an entity value",
        '<!DOCTYPE svg [<!ENTITY x "]">]><svg xmlns="http://www.w3.org/2000/svg"/>',
      ],
      [
        "a comment and a PI in the internal subset",
        "<!DOCTYPE svg [<!-- ]> --><?pi ]>?>]><svg/>",
      ],
      [
        "a namespace-prefixed root",
        '<s:svg xmlns:s="http://www.w3.org/2000/svg"/>',
      ],
      [
        "a prolog longer than 1 KB",
        `<?xml version="1.0"?><!-- ${"pad ".repeat(400)} --><svg/>`,
      ],
    ])("drops an SVG behind %s", (_, value) => {
      expect(signatureOf(value)).toBe("svg");
    });

    // Readers accept these headers anywhere in the first 1024 bytes.
    it.each([
      ["pdf", "hello\n%PDF-1.4\n1 0 obj"],
      ["postscript", "junk line\n%!PS-Adobe-3.0\n"],
    ])("drops a %s whose header starts a later line", (signature, value) => {
      expect(signatureOf(value)).toBe(signature);
    });

    it("keeps text that mentions %PDF- only after the first 1024 bytes", () => {
      expect(signatureOf(`${"x".repeat(1024)}\n%PDF-1.4`)).toBeUndefined();
    });

    // Only a header that starts a line counts, so text that mentions one is
    // kept.
    it.each([
      ["prose", "see the attached %PDF-1.4 file"],
      ["JSON", '{"note":"file starts with %PDF-1.7 header"}'],
      ["a printer note", "the printer wants %!PS input"],
    ])("keeps %s mentioning a header mid-line", (_, value) => {
      expect(signatureOf(value)).toBeUndefined();
    });

    it.each([
      ["a raw P6 pixmap", "P6\n2 1\n126\n~~~~~~"],
      ["a raw P5 graymap", "P5\n2 1\n126\n~~"],
      ["a P4 bitmap", "P4\n8 1\n~"],
      ["a P7 PAM", "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 1\nMAXVAL 126\nENDHDR\n~"],
      ["a comment right after the magic", "P3#c\n2 2\n1\n0 0 0\n"],
      ["a CR-terminated comment", "P3\r#c\r2 2\r1\r0 0 0\r"],
    ])("drops %s", (_, value) => {
      expect(signatureOf(value)).toBe("netpbm");
    });

    it.each([
      ["LOGO", "LOGO;ENCODING=b;TYPE=PNG:iVBOR"],
      ["SOUND", "SOUND;ENCODING=b;TYPE=OGG:T2dn"],
    ])("drops a vCard carrying a %s", (_, property) => {
      expect(
        signatureOf(
          `BEGIN:VCARD\r\nVERSION:3.0\r\n${property}\r\nEND:VCARD\r\n`,
        ),
      ).toBe("vcard");
    });

    it("drops a vCard whose image property is folded across lines", () => {
      expect(
        signatureOf(
          "BEGIN:VCARD\r\nVERSION:4.0\r\nPHOTO\r\n :data:image/png;base64,AAAA\r\nEND:VCARD\r\n",
        ),
      ).toBe("vcard");
    });

    it.each([
      [
        "a space after P7",
        "P7 \nWIDTH 96\nHEIGHT 1\nDEPTH 1\nMAXVAL 126\nENDHDR\n~",
      ],
      ["the width right after the magic", "P596 120\n126\n~~"],
      ["a PFM float map", "Pf\n96 120\n-1.0\nAAA?"],
      ["a colour PFM", "PF\n2 1\n1.0\nAAA?"],
    ])("drops a Netpbm image with %s", (_, value) => {
      expect(signatureOf(value)).toBe("netpbm");
    });

    it("drops a FITS image", () => {
      const cards = [
        "SIMPLE  =                    T",
        "BITPIX  =                    8",
        "NAXIS   =                    2",
        "NAXIS1  =                    2",
        "NAXIS2  =                    1",
        "END",
      ]
        .map((card) => card.padEnd(80))
        .join("")
        .padEnd(2880);
      expect(signatureOf(`${cards}~~`)).toBe("fits");
    });

    it("drops a bare %! PostScript header at a line start", () => {
      expect(signatureOf("%!\n100 100 translate showpage\n")).toBe(
        "postscript",
      );
      expect(signatureOf("junk\n%!\nshowpage\n")).toBe("postscript");
    });

    it("drops an SVG whose root has a non-ASCII namespace prefix", () => {
      expect(
        signatureOf(
          '<é:svg xmlns:é="http://www.w3.org/2000/svg"><rect/></é:svg>',
        ),
      ).toBe("svg");
    });

    it("drops a raw email whose MIME-Version is not its first header", () => {
      expect(
        signatureOf(
          "Received: from x\r\nFrom: a@b\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\n",
        ),
      ).toBe("mime");
    });

    it("keeps text that mentions MIME-Version after its first paragraph", () => {
      expect(
        signatureOf("Notes\n\nMIME-Version: 1.0 is the header we saw\n"),
      ).toBeUndefined();
    });
  });

  describe("charset labels that decode as UTF-16", () => {
    // The viewer hands the declared charset to TextDecoder, which knows these
    // WHATWG labels as UTF-16 even though they do not say so.
    it.each([
      "ucs-2",
      "unicode",
      "csunicode",
      "iso-10646-ucs-2",
      "unicodefeff",
      "unicodefffe",
    ])("drops charset=%s", (charset) => {
      expect(
        (
          filterBody(text("hello"), {
            "content-type": `text/plain; charset=${charset}`,
          }).dropped as BodyDrop | null
        )?.reason,
      ).toBe("type");
    });

    it("still keeps a charset TextDecoder does not know", () => {
      expect(
        filterBody(text("hello"), {
          "content-type": "text/plain; charset=x-made-up",
        }).dropped,
      ).toBeNull();
    });
  });

  describe("multipart without a close delimiter", () => {
    const form = { "content-type": "multipart/form-data; boundary=b" };
    const open = (tail: Buffer) =>
      Buffer.concat([
        text(
          '--b\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello\r\n--b\r\nContent-Disposition: form-data; name="c"\r\n\r\n',
        ),
        tail,
      ]);

    it.each([
      ["text", text("second field text")],
      ["binary", PNG],
      ["an SVG part", text('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ])("drops it as unparseable when the tail is %s", (_, tail) => {
      const body = open(tail);
      expect(filterBody(body, form)).toEqual({
        body: null,
        dropped: {
          reason: "form",
          bytes: body.length,
          contentType: "multipart/form-data; boundary=b",
        },
      });
    });
  });
});
