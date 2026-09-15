import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import holeService from "../services";
import RequestBody, {
  DISPLAY_CAP_BYTES,
  MAX_RENDERED_ROWS,
} from "./RequestBody";
import { MediaConfigContext } from "../mediaConfigContext";
import { parseBodyDropped, type BodyDropped } from "../utils/bodyDropped";

vi.mock("../services", () => ({
  default: {
    BASE_URL: "",
    getBodyBytes: vi.fn(),
  },
}));

const toBytes = (text: string) => {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(0, encoded.byteLength) as ArrayBuffer;
};

/** The bytes the body endpoint answered with, not withheld. */
const served = (bytes: ArrayBuffer) => ({ bytes, withheld: false });

// These tests document the viewer with ALLOW_MEDIA on — the behaviour the
// gate leaves exactly as it was. Media off is its own describe block below.
const renderBody = (
  contentType: string | undefined,
  {
    allowMedia = true,
    dropped,
  }: { allowMedia?: boolean; dropped?: BodyDropped } = {},
) =>
  render(
    <MediaConfigContext.Provider value={allowMedia}>
      <RequestBody
        requestAddress="req001"
        contentType={contentType}
        dropped={dropped}
      />
    </MediaConfigContext.Provider>,
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  vi.mocked(holeService.getBodyBytes).mockResolvedValue(
    served(new ArrayBuffer(0)),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("JSON bodies", () => {
  it("pretty-prints and highlights a JSON body, fetching it exactly once", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes('{"hello":"world"}')),
    );
    const { container } = renderBody("application/json");

    await screen.findByText(/"hello"/);
    expect(container.textContent).toContain('{\n  "hello": "world"\n}');
    expect(
      container.querySelectorAll("span[class^='hljs-']").length,
    ).toBeGreaterThan(0);

    // The fetch used to run during render — an unbounded request loop.
    await settle();
    expect(holeService.getBodyBytes).toHaveBeenCalledTimes(1);
  });

  // Substring matching sent vendor subtypes to a blank panel; GitHub-style
  // webhooks use them routinely.
  it("treats a vendor +json subtype with a charset parameter as JSON", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes('{"id":7}')),
    );
    const { container } = renderBody("application/vnd.api+json; charset=utf-8");

    await screen.findByText(/"id"/);
    expect(container.textContent).toContain('{\n  "id": 7\n}');
  });

  it("decodes the body per the charset parameter", async () => {
    // "é" in latin-1 is the single byte 0xe9 — decoded as UTF-8 it would be
    // a replacement character.
    const latin1 = new Uint8Array([34, 99, 97, 102, 0xe9, 34]); // "café"
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(latin1.buffer as ArrayBuffer),
    );
    const { container } = renderBody("application/json; charset=iso-8859-1");

    await screen.findByText(/café/);
    expect(container.textContent).toContain('"café"');
  });

  // A body that claims JSON but is not must still be shown — raw, with an
  // explicit note, never a thrown error or a silent nothing.
  it("falls back to raw text with a note when the JSON does not parse", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes('{"unclosed":')),
    );
    const { container } = renderBody("application/json");

    await screen.findByText(/couldn't be formatted as JSON/i);
    expect(container.textContent).toContain('{"unclosed":');
  });

  // A network error used to render nothing at all — the blank panel this
  // viewer exists to eliminate, with no way to tell it from an empty body.
  it("reports a failed body load instead of rendering nothing", async () => {
    vi.mocked(holeService.getBodyBytes).mockRejectedValue(new Error("offline"));
    renderBody("application/json");

    expect(await screen.findByText(/couldn't load this body/i)).toBeVisible();
  });

  // The charset label is attacker-controlled; an unknown label must fall
  // back to UTF-8, never let TextDecoder's RangeError take the view down.
  it("falls back to UTF-8 when the charset label is junk", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes('{"ok":true}')),
    );
    const { container } = renderBody(
      "application/json; charset=x-attacker-junk",
    );

    await screen.findByText(/"ok"/);
    expect(container.textContent).toContain('"ok": true');
  });
});

describe("other structured text bodies", () => {
  it("indents and highlights an XML body", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("<order><id>7</id></order>")),
    );
    const { container } = renderBody("application/xml");

    // hljs splits tags across token spans, so match on the joined text.
    await waitFor(() =>
      expect(container.textContent).toContain(
        "<order>\n  <id>7</id>\n</order>",
      ),
    );
    expect(
      container.querySelectorAll("span[class^='hljs-']").length,
    ).toBeGreaterThan(0);
  });

  it("formats each NDJSON line as its own document", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes('{"a":1}\n{"b":2}\n')),
    );
    const { container } = renderBody("application/x-ndjson");

    await screen.findByText(/"a"/);
    expect(container.textContent).toContain('{\n  "a": 1\n}\n{\n  "b": 2\n}');
  });

  it("highlights a YAML body as sent — it is already line-oriented", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("name: hole\nsize: 6\n")),
    );
    const { container } = renderBody("application/yaml");

    await screen.findByText(/name:/);
    expect(container.textContent).toContain("name: hole\nsize: 6");
    expect(
      container.querySelectorAll("span[class^='hljs-']").length,
    ).toBeGreaterThan(0);
  });

  // The untrusted-body invariant: HTML is source to inspect, never a
  // document to render on this origin.
  it("shows an HTML body as escaped source, never as markup", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes('<img src=x onerror="alert(1)"><p>hi</p>')),
    );
    const { container } = renderBody("text/html");

    await waitFor(() => expect(container.textContent).toContain("<p>hi</p>"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders plain text verbatim without highlighting", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("just some words")),
    );
    const { container } = renderBody("text/plain");

    await screen.findByText("just some words");
    expect(container.querySelectorAll("span[class^='hljs-']")).toHaveLength(0);
  });
});

describe("form-encoded bodies", () => {
  it("decodes parameters into a key/value table", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("flavor=vanilla&topping=hot+fudge%21")),
    );
    renderBody("application/x-www-form-urlencoded");

    expect(
      await screen.findByRole("rowheader", { name: "flavor" }),
    ).toBeVisible();
    expect(screen.getByText("vanilla")).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "topping" })).toBeVisible();
    expect(screen.getByText("hot fudge!")).toBeVisible();
  });

  // GitHub and Slack send the whole webhook as one form parameter named
  // `payload` — without this it is an unreadable escaped blob.
  it("pretty-prints a value that is itself JSON", async () => {
    const payload = encodeURIComponent('{"action":"opened","number":7}');
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes(`payload=${payload}`)),
    );
    const { container } = renderBody("application/x-www-form-urlencoded");

    await screen.findByRole("rowheader", { name: "payload" });
    expect(container.textContent).toContain('"action": "opened"');
    expect(container.textContent).toContain('"number": 7');
  });

  // The byte cap alone doesn't bound the DOM: a 256 KB body of tiny pairs is
  // tens of thousands of table rows.
  it("caps the number of rendered rows and offers the full body instead", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:whole"),
      revokeObjectURL: vi.fn(),
    });
    const pairs = Array.from(
      { length: MAX_RENDERED_ROWS + 500 },
      (_, i) => `k${i}=v${i}`,
    ).join("&");
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes(pairs)),
    );
    const { container } = renderBody("application/x-www-form-urlencoded");

    await screen.findByText(/500 more pairs not shown/i);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(
      MAX_RENDERED_ROWS,
    );
    const download = await screen.findByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe("blob:whole");
  });

  // Pin the boundary itself, as the byte cap does — an off-by-one in the
  // slice or a spurious "0 more" note would pass the over-the-cap test.
  it("renders exactly the cap's worth of rows in full, with no omission note", async () => {
    const pairs = Array.from(
      { length: MAX_RENDERED_ROWS },
      (_, i) => `k${i}=v${i}`,
    ).join("&");
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes(pairs)),
    );
    const { container } = renderBody("application/x-www-form-urlencoded");

    // Waited for by counting rows rather than by `findByRole(…, { name })`:
    // an accessible-name query computes a name for every element in a table
    // this size, which took longer than the whole render and pushed the test
    // past vitest's default timeout on a loaded machine.
    await waitFor(() =>
      expect(container.querySelectorAll("tbody tr")).toHaveLength(
        MAX_RENDERED_ROWS,
      ),
    );
    expect(container.querySelector("tbody th")).toHaveTextContent("k0");
    expect(screen.queryByText(/more pairs not shown/i)).not.toBeInTheDocument();
  });
});

describe("multipart bodies", () => {
  const multipartFixture = () =>
    toBytes(
      [
        "--B",
        'content-disposition: form-data; name="comment"',
        "",
        "a text part",
        "--B",
        'content-disposition: form-data; name="upload"; filename="cat.png"',
        "content-type: image/png",
        "",
        "PNGBYTES",
        "--B--",
        "",
      ].join("\r\n"),
    );

  it("lists each part with its name, filename, and content-type", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:part"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(multipartFixture()),
    );
    renderBody("multipart/form-data; boundary=B");

    expect(await screen.findByText("comment")).toBeVisible();
    expect(screen.getByText("a text part")).toBeVisible();
    expect(screen.getByText("upload")).toBeVisible();
    expect(screen.getByText("cat.png")).toBeVisible();
    expect(screen.getByText("image/png")).toBeVisible();
  });

  // The image bytes are already in hand; the part renders from an app-owned
  // blob, never by another fetch or a link to the body endpoint. The blob is
  // typed application/octet-stream, never the attacker's declared type — a
  // blob: URL inherits this origin, so an attacker-typed image/svg+xml blob
  // would be a script-capable document one "open in new tab" away. Raster
  // formats render in <img> via content sniffing regardless of blob type.
  it("renders a raster image part inline from an octet-stream blob the app owns", async () => {
    let createdBlob: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlob = blob;
      return "blob:part";
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(multipartFixture()),
    );
    const { container } = renderBody("multipart/form-data; boundary=B");

    await screen.findByText("cat.png");
    await waitFor(() => {
      const image = container.querySelector("img");
      expect(image).not.toBeNull();
      expect(image!.getAttribute("src")).toBe("blob:part");
    });
    expect(createdBlob?.type).toBe("application/octet-stream");
  });

  // SVG needs its MIME type to render, and an SVG document can run script —
  // so an image/svg+xml part must never render in an <img> or become a blob
  // carrying its own type. It gets the binary treatment: a download whose
  // blob is application/octet-stream, which a browser downloads rather than
  // renders even if navigated to.
  it("treats an SVG image part as binary, never an image or a typed blob", async () => {
    let createdBlob: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlob = blob;
      return "blob:part";
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(
        toBytes(
          [
            "--B",
            'content-disposition: form-data; name="pic"; filename="evil.svg"',
            "content-type: image/svg+xml",
            "",
            '<svg onload="alert(1)"></svg>',
            "--B--",
            "",
          ].join("\r\n"),
        ),
      ),
    );
    const { container } = renderBody("multipart/form-data; boundary=B");

    await screen.findByText("evil.svg");
    expect(await screen.findByText(/29 bytes/)).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(createdBlob?.type).toBe("application/octet-stream");
    const download = await screen.findByRole("link", { name: /download/i });
    expect(download).toHaveAttribute("download", "evil.svg");
  });

  // An inspector must never silently omit content.
  it("says when a region between boundaries could not be parsed", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:part"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(
        toBytes(
          [
            "--B",
            "header-with-no-blank-line",
            "--B",
            'content-disposition: form-data; name="ok"',
            "",
            "good part",
            "--B--",
            "",
          ].join("\r\n"),
        ),
      ),
    );
    renderBody("multipart/form-data; boundary=B");

    expect(await screen.findByText(/1 part couldn't be parsed/i)).toBeVisible();
  });

  // The byte cap alone doesn't bound the DOM: thousands of tiny parts under
  // 256 KB would still render thousands of cards.
  it("caps the number of rendered parts and says how many were omitted", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:whole"),
      revokeObjectURL: vi.fn(),
    });
    const parts = Array.from(
      { length: MAX_RENDERED_ROWS + 50 },
      (_, i) =>
        `--B\r\ncontent-disposition: form-data; name="p${i}"\r\n\r\nv\r\n`,
    ).join("");
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes(`${parts}--B--\r\n`)),
    );
    const { container } = renderBody("multipart/form-data; boundary=B");

    await screen.findByText(/50 more parts not shown/i);
    expect(container.querySelectorAll("li")).toHaveLength(MAX_RENDERED_ROWS);
  });

  // A captured PDF or zip part must stay reachable: byte count alone strands
  // the bytes the inspector captured, with no preview and no way to get them.
  it("gives a binary part a hex preview and its own download", async () => {
    let createdBlob: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlob = blob;
      return "blob:part";
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(
        toBytes(
          [
            "--B",
            'content-disposition: form-data; name="doc"; filename="report.pdf"',
            "content-type: application/pdf",
            "",
            "%PDF-1.7 pretend",
            "--B--",
            "",
          ].join("\r\n"),
        ),
      ),
    );
    const { container } = renderBody("multipart/form-data; boundary=B");

    expect(await screen.findByText(/16 bytes/)).toBeVisible();
    expect(container.textContent).toContain("|%PDF-1.7 pretend|");
    const download = await screen.findByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe("blob:part");
    expect(download).toHaveAttribute("download", "report.pdf");
    expect(createdBlob?.type).toBe("application/octet-stream");
  });

  // Multipart bodies skip the body-level byte cap (an upload with one big
  // file part should still list its parts), so each text part is capped on
  // its own.
  it("truncates an oversized text part rather than dumping it whole", async () => {
    const huge = "z".repeat(DISPLAY_CAP_BYTES + 100);
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(
        toBytes(
          `--B\r\ncontent-disposition: form-data; name="big"\r\n\r\n${huge}\r\n--B--\r\n`,
        ),
      ),
    );
    renderBody("multipart/form-data; boundary=B");

    expect(await screen.findByText(/truncated/i)).toBeVisible();
  });

  // A multipart claim whose body lacks the boundary is malformed structured
  // content: raw text with a note, never a throw or an empty panel.
  it("falls back to raw text with a note when the boundary never appears", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("no boundary in here")),
    );
    const { container } = renderBody("multipart/form-data; boundary=B");

    await screen.findByText(/didn't parse as multipart/i);
    expect(container.textContent).toContain("no boundary in here");
  });
});

describe("binary and unknown bodies", () => {
  // An unrecognized type used to render nothing at all — not even the Body
  // heading — as if nothing was captured.
  it("renders size, a hex preview, and a download for an unrecognized type", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("GIF89a\x01\x02")),
    );
    const { container } = renderBody("application/whoknows");

    expect(await screen.findByText(/8 bytes/)).toBeVisible();
    expect(container.textContent).toContain("47 49 46 38 39 61 01 02");
    expect(container.textContent).toContain("|GIF89a..|");

    const download = await screen.findByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe("blob:fake");
    expect(download).toHaveAttribute("download", "req001.bin");
  });

  // Captured bodies must never be navigated to on this origin, whatever
  // headers the endpoint sets; a PDF is handed over as an app-owned blob.
  it("offers a PDF as a locally-built download, never a link to the body URL", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("%PDF-1.7")),
    );
    renderBody("application/pdf");

    const download = await screen.findByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe("blob:fake");
    expect(download.getAttribute("href")).not.toMatch(/\/api\/request/);
    expect(download).toHaveAttribute("download", "req001.pdf");
  });

  it("treats a missing content-type with bytes present as binary", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("mystery bytes")),
    );
    renderBody(undefined);

    expect(await screen.findByText(/13 bytes/)).toBeVisible();
  });

  it("revokes the download blob when the viewer goes away", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL,
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("%PDF-1.7")),
    );
    const { unmount } = renderBody("application/pdf");
    await screen.findByRole("link", { name: /download/i });

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  // The old viewer built its blob in a .then that could land after cleanup,
  // leaving an orphan URL holding the file for the tab's lifetime. Now the
  // blob derives synchronously from fetched state, so a fetch that lands
  // after unmount must create no blob at all.
  it("creates no blob when the fetch lands after the viewer is gone", async () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    let resolveBytes: (body: ReturnType<typeof served>) => void = () => {};
    vi.mocked(holeService.getBodyBytes).mockReturnValue(
      new Promise((resolve) => {
        resolveBytes = resolve;
      }),
    );
    const { unmount } = renderBody("application/pdf");

    unmount();
    resolveBytes(served(toBytes("%PDF-1.7")));
    await settle();

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("empty bodies", () => {
  // A GET with no body used to render nothing at all; the viewer must state
  // what was captured, including "nothing".
  it("says explicitly that the body is empty when there are zero bytes", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(new ArrayBuffer(0)),
    );
    renderBody("application/json");

    expect(await screen.findByText(/empty body/i)).toBeVisible();
  });

  it("says so for a request with no content-type and no bytes", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(new ArrayBuffer(0)),
    );
    renderBody(undefined);

    expect(await screen.findByText(/empty body/i)).toBeVisible();
  });
});

describe("the display cap", () => {
  // Pretty-printing a megabyte of JSON into DOM nodes is what freezes a tab.
  it("truncates a body over the cap and offers the full download", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:whole"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("x".repeat(DISPLAY_CAP_BYTES + 1))),
    );
    const { container } = renderBody("text/plain");

    await screen.findByText(/truncated/i);
    // Only the capped prefix reaches the DOM.
    const shown = container.querySelector("pre")!.textContent!;
    expect(shown.length).toBe(DISPLAY_CAP_BYTES);

    const download = await screen.findByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe("blob:whole");
  });

  // Force-decoding a large binary body as text would dump 256 KB of control
  // characters into a <pre>; binary bodies keep their hex-preview rendering
  // whatever their size.
  it("shows an oversized binary body as hex preview and download, not truncated text", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:whole"),
      revokeObjectURL: vi.fn(),
    });
    const big = new Uint8Array(DISPLAY_CAP_BYTES + 10).fill(0x47);
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(big.buffer as ArrayBuffer),
    );
    const { container } = renderBody("application/octet-stream");

    await screen.findByText(
      new RegExp(`${(DISPLAY_CAP_BYTES + 10).toLocaleString()} bytes`),
    );
    expect(container.textContent).toContain("|GGGGGGGGGGGGGGGG|");
    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });

  it("decodes the truncated prefix per the charset parameter", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:whole"),
      revokeObjectURL: vi.fn(),
    });
    // 0xe9 is "é" in latin-1; decoded as UTF-8 it is a replacement character.
    const big = new Uint8Array(DISPLAY_CAP_BYTES + 1).fill(0xe9);
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(big.buffer as ArrayBuffer),
    );
    const { container } = renderBody("text/plain; charset=iso-8859-1");

    await screen.findByText(/truncated/i);
    expect(container.querySelector("pre")!.textContent).toContain("ééé");
  });

  it("renders a body exactly at the cap in full, untruncated", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("y".repeat(DISPLAY_CAP_BYTES))),
    );
    const { container } = renderBody("text/plain");

    await waitFor(() =>
      expect(container.querySelector("pre")!.textContent!.length).toBe(
        DISPLAY_CAP_BYTES,
      ),
    );
    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });
});

describe("image bodies", () => {
  // Sub-resource loads ignore nosniff and attachment, so an <img> straight at
  // the body endpoint stays safe — and skips fetching the bytes twice.
  it("renders an image inline from the body endpoint without fetching bytes", async () => {
    const { container } = renderBody("image/png");

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toBe("/api/request/req001/body");

    await settle();
    expect(holeService.getBodyBytes).not.toHaveBeenCalled();
  });

  // An image-typed request with an empty body, a non-image payload, or a
  // downed backend would otherwise show a bare broken-image glyph — the
  // unexplained-nothing failure every other family has an explicit state for.
  it("explains itself when the image fails to load", async () => {
    const { container } = renderBody("image/png");

    fireEvent.error(container.querySelector("img")!);

    expect(
      await screen.findByText(/couldn't display this image/i),
    ).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("with media off", () => {
  const off = { allowMedia: false };
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]).buffer;
  const stubBlobs = () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    return createObjectURL;
  };

  // No provider at all is what a failed /api/config fetch leaves behind.
  it("renders no image when nothing says media is allowed", async () => {
    const createObjectURL = stubBlobs();
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(served(PNG));
    const { container } = render(
      <RequestBody requestAddress="req001" contentType="image/png" />,
    );

    await screen.findByText(/9 bytes/);
    expect(container.querySelector("img")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("describes a dropped body instead of calling it empty", async () => {
    renderBody("image/png", {
      ...off,
      dropped: parseBodyDropped(
        '{"reason":"type","bytes":48213,"contentType":"image/png"}',
      ),
    });

    expect(
      await screen.findByText("Media/binary data dropped: 47 KB, image/png"),
    ).toBeVisible();
    expect(screen.queryByText(/empty body/i)).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("says a withheld body is not shown on this instance", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue({
      bytes: new ArrayBuffer(0),
      withheld: true,
    });
    renderBody("image/png", off);

    expect(
      await screen.findByText("Media/binary data not shown on this instance"),
    ).toBeVisible();
    expect(screen.queryByText(/empty body/i)).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a kept body with no content-type as text, not a hex dump", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("plain words")),
    );
    const { container } = renderBody(undefined, off);

    await screen.findByText("plain words");
    expect(container.textContent).not.toMatch(/bytes —/);
  });

  it("keeps the hex preview for bytes it did not expect, with no download", async () => {
    const createObjectURL = stubBlobs();
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(served(PNG));
    renderBody("application/octet-stream", off);

    await screen.findByText(/9 bytes/);
    await settle();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
  });

  describe("multipart", () => {
    const form = (partHead: string, partBytes: Uint8Array) => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const bytes = new Uint8Array([
        ...encode(
          '--B\r\ncontent-disposition: form-data; name="title"\r\n\r\nhello\r\n--B\r\n',
        ),
        ...encode(partHead),
        ...partBytes,
        ...encode("\r\n--B--\r\n"),
      ]);
      return bytes.buffer;
    };
    const avatarHead =
      'content-disposition: form-data; name="avatar"; filename="me.png"\r\ncontent-type: image/png\r\n\r\n';

    it("shows a dropped part's notice in that part's place", async () => {
      vi.mocked(holeService.getBodyBytes).mockResolvedValue(
        served(form(avatarHead, new Uint8Array())),
      );
      renderBody("multipart/form-data; boundary=B", {
        ...off,
        dropped: parseBodyDropped(
          '{"parts":[{"index":1,"name":"avatar","filename":"me.png","contentType":"image/png","bytes":48213,"reason":"type"}]}',
        ),
      });

      const items = await screen.findAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("hello");
      expect(items[0]).not.toHaveTextContent(/dropped/);
      expect(items[1]).toHaveTextContent("avatar");
      expect(items[1]).toHaveTextContent(
        "Media/binary data dropped: 47 KB, image/png",
      );
    });

    it("never builds an image or blob for an image part", async () => {
      const createObjectURL = stubBlobs();
      vi.mocked(holeService.getBodyBytes).mockResolvedValue(
        served(form(avatarHead, new Uint8Array(PNG))),
      );
      const { container } = renderBody("multipart/form-data; boundary=B", off);

      await screen.findByText("avatar");
      await settle();
      expect(container.querySelector("img")).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
    });
  });
});

describe("with media off, rendering text and building no blobs", () => {
  const off = { allowMedia: false };
  const stubBlobs = () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    return createObjectURL;
  };

  // The backend only keeps text with media off, so a type this viewer does
  // not know is still readable text.
  it("renders an unrecognised type as text when its bytes are UTF-8", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("query { viewer { login } }")),
    );
    const { container } = renderBody("application/x-unlisted-text", off);

    await screen.findByText("query { viewer { login } }");
    expect(container.textContent).not.toMatch(/bytes —/);
  });

  // The byte check verified UTF-8; a declared charset must not make the
  // viewer show something other than what passed it.
  it("decodes as UTF-8 whatever charset is declared", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("café")),
    );
    renderBody("text/plain; charset=windows-1252", off);

    expect(await screen.findByText("café")).toBeVisible();
  });

  it.each([
    ["an over-cap text body", "text/plain", "x".repeat(DISPLAY_CAP_BYTES + 1)],
    [
      "a form over the row cap",
      "application/x-www-form-urlencoded",
      Array.from({ length: MAX_RENDERED_ROWS + 1 }, (_, i) => `k${i}=v`).join(
        "&",
      ),
    ],
  ])("builds no download blob for %s", async (_, contentType, body) => {
    const createObjectURL = stubBlobs();
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes(body)),
    );
    renderBody(contentType, off);

    await screen.findByText(/not shown/i);
    await settle();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.queryByText(/download the body/i)).toBeNull();
  });

  it("builds no download blob for a multipart body over the part cap", async () => {
    const createObjectURL = stubBlobs();
    const parts = Array.from(
      { length: MAX_RENDERED_ROWS + 1 },
      (_, i) =>
        `--B\r\ncontent-disposition: form-data; name="f${i}"\r\n\r\nv\r\n`,
    ).join("");
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes(`${parts}--B--\r\n`)),
    );
    renderBody("multipart/form-data; boundary=B", off);

    await screen.findByText(/not shown/i);
    await settle();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  // On a media-on instance the answer is still on its way: rendering now
  // would take the media-off path first and flash a hex preview.
  it("renders nothing and fetches nothing until the instance config is known", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("hello")),
    );
    const { container } = render(
      <MediaConfigContext.Provider value={undefined}>
        <RequestBody requestAddress="req001" contentType="image/png" />
      </MediaConfigContext.Provider>,
    );

    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(holeService.getBodyBytes).not.toHaveBeenCalled();
  });
});

describe("with media off, multipart parts and a pending config", () => {
  const off = { allowMedia: false };
  const form = (partHead: string, content: string) =>
    toBytes(`--B\r\n${partHead}\r\n\r\n${content}\r\n--B--\r\n`);

  it("renders a multipart part of an unrecognised type as text when it is UTF-8", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(
        form(
          'content-disposition: form-data; name="q"\r\ncontent-type: application/x-unlisted',
          "query { viewer }",
        ),
      ),
    );
    const { container } = renderBody("multipart/form-data; boundary=B", off);

    await screen.findByText("query { viewer }");
    expect(container.textContent).not.toMatch(/bytes/);
  });

  it("decodes a multipart part as UTF-8 whatever charset it declares", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(
        form(
          'content-disposition: form-data; name="q"\r\ncontent-type: text/plain; charset=windows-1252',
          "café",
        ),
      ),
    );
    renderBody("multipart/form-data; boundary=B", off);

    expect(await screen.findByText("café")).toBeVisible();
  });

  it("builds no download blob for an unparseable multipart body over the cap", async () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      served(toBytes("x".repeat(DISPLAY_CAP_BYTES + 1))),
    );
    renderBody("multipart/form-data; boundary=nowhere", off);

    expect(
      await screen.findByText(/not shown on this instance/i),
    ).toBeVisible();
    await settle();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
  });

  // The drop notice needs nothing from the instance config.
  it("shows a dropped body's notice while the config is still pending", async () => {
    render(
      <MediaConfigContext.Provider value={undefined}>
        <RequestBody
          requestAddress="req001"
          contentType="image/png"
          dropped={parseBodyDropped(
            '{"reason":"type","bytes":2048,"contentType":"image/png"}',
          )}
        />
      </MediaConfigContext.Provider>,
    );

    expect(
      await screen.findByText("Media/binary data dropped: 2 KB, image/png"),
    ).toBeVisible();
  });
});
