import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import holeService from "../services";
import RequestBody, { DISPLAY_CAP_BYTES } from "./RequestBody";

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

const renderBody = (contentType: string | undefined) =>
  render(<RequestBody requestAddress="req001" contentType={contentType} />);

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  vi.mocked(holeService.getBodyBytes).mockResolvedValue(new ArrayBuffer(0));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("JSON bodies", () => {
  it("pretty-prints and highlights a JSON body, fetching it exactly once", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes('{"hello":"world"}'),
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
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(toBytes('{"id":7}'));
    const { container } = renderBody("application/vnd.api+json; charset=utf-8");

    await screen.findByText(/"id"/);
    expect(container.textContent).toContain('{\n  "id": 7\n}');
  });

  it("decodes the body per the charset parameter", async () => {
    // "é" in latin-1 is the single byte 0xe9 — decoded as UTF-8 it would be
    // a replacement character.
    const latin1 = new Uint8Array([34, 99, 97, 102, 0xe9, 34]); // "café"
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      latin1.buffer as ArrayBuffer,
    );
    const { container } = renderBody("application/json; charset=iso-8859-1");

    await screen.findByText(/café/);
    expect(container.textContent).toContain('"café"');
  });

  // A body that claims JSON but is not must still be shown — raw, with an
  // explicit note, never a thrown error or a silent nothing.
  it("falls back to raw text with a note when the JSON does not parse", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes('{"unclosed":'),
    );
    const { container } = renderBody("application/json");

    await screen.findByText(/didn't parse as JSON/i);
    expect(container.textContent).toContain('{"unclosed":');
  });
});

describe("other structured text bodies", () => {
  it("indents and highlights an XML body", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("<order><id>7</id></order>"),
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
      toBytes('{"a":1}\n{"b":2}\n'),
    );
    const { container } = renderBody("application/x-ndjson");

    await screen.findByText(/"a"/);
    expect(container.textContent).toContain('{\n  "a": 1\n}\n{\n  "b": 2\n}');
  });

  it("highlights a YAML body as sent — it is already line-oriented", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("name: hole\nsize: 6\n"),
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
      toBytes('<img src=x onerror="alert(1)"><p>hi</p>'),
    );
    const { container } = renderBody("text/html");

    await waitFor(() =>
      expect(container.textContent).toContain("<p>hi</p>"),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders plain text verbatim without highlighting", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("just some words"),
    );
    const { container } = renderBody("text/plain");

    await screen.findByText("just some words");
    expect(container.querySelectorAll("span[class^='hljs-']")).toHaveLength(0);
  });
});

describe("form-encoded bodies", () => {
  it("decodes parameters into a key/value table", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("flavor=vanilla&topping=hot+fudge%21"),
    );
    renderBody("application/x-www-form-urlencoded");

    expect(await screen.findByRole("rowheader", { name: "flavor" })).toBeVisible();
    expect(screen.getByText("vanilla")).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "topping" })).toBeVisible();
    expect(screen.getByText("hot fudge!")).toBeVisible();
  });

  // GitHub and Slack send the whole webhook as one form parameter named
  // `payload` — without this it is an unreadable escaped blob.
  it("pretty-prints a value that is itself JSON", async () => {
    const payload = encodeURIComponent('{"action":"opened","number":7}');
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes(`payload=${payload}`),
    );
    const { container } = renderBody("application/x-www-form-urlencoded");

    await screen.findByRole("rowheader", { name: "payload" });
    expect(container.textContent).toContain('"action": "opened"');
    expect(container.textContent).toContain('"number": 7');
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
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(multipartFixture());
    renderBody("multipart/form-data; boundary=B");

    expect(await screen.findByText("comment")).toBeVisible();
    expect(screen.getByText("a text part")).toBeVisible();
    expect(screen.getByText("upload")).toBeVisible();
    expect(screen.getByText("cat.png")).toBeVisible();
    expect(screen.getByText("image/png")).toBeVisible();
  });

  // The image bytes are already in hand; the part renders from an app-owned
  // blob, never by another fetch or a link to the body endpoint.
  it("renders an image part inline from a blob the app owns", async () => {
    const createObjectURL = vi.fn(() => "blob:part");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(multipartFixture());
    const { container } = renderBody("multipart/form-data; boundary=B");

    await screen.findByText("cat.png");
    await waitFor(() => {
      const image = container.querySelector("img");
      expect(image).not.toBeNull();
      expect(image!.getAttribute("src")).toBe("blob:part");
    });
  });

  // A multipart claim whose body lacks the boundary is malformed structured
  // content: raw text with a note, never a throw or an empty panel.
  it("falls back to raw text with a note when the boundary never appears", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("no boundary in here"),
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
      toBytes("GIF89a\x01\x02"),
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
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(toBytes("%PDF-1.7"));
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
      toBytes("mystery bytes"),
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
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(toBytes("%PDF-1.7"));
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
    let resolveBytes: (bytes: ArrayBuffer) => void = () => {};
    vi.mocked(holeService.getBodyBytes).mockReturnValue(
      new Promise((resolve) => {
        resolveBytes = resolve;
      }),
    );
    const { unmount } = renderBody("application/pdf");

    unmount();
    resolveBytes(toBytes("%PDF-1.7"));
    await settle();

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("empty bodies", () => {
  // A GET with no body used to render nothing at all; the viewer must state
  // what was captured, including "nothing".
  it("says explicitly that the body is empty when there are zero bytes", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(new ArrayBuffer(0));
    renderBody("application/json");

    expect(await screen.findByText(/empty body/i)).toBeVisible();
  });

  it("says so for a request with no content-type and no bytes", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(new ArrayBuffer(0));
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
      toBytes("x".repeat(DISPLAY_CAP_BYTES + 1)),
    );
    const { container } = renderBody("text/plain");

    await screen.findByText(/truncated/i);
    // Only the capped prefix reaches the DOM.
    const shown = container.querySelector("pre")!.textContent!;
    expect(shown.length).toBe(DISPLAY_CAP_BYTES);

    const download = await screen.findByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe("blob:whole");
  });

  it("renders a body exactly at the cap in full, untruncated", async () => {
    vi.mocked(holeService.getBodyBytes).mockResolvedValue(
      toBytes("y".repeat(DISPLAY_CAP_BYTES)),
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
});
