import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { highlightCode } from "./highlight";

describe("highlightCode", () => {
  it("tokenizes JSON into hljs spans while preserving the exact text", () => {
    const code = '{\n  "hello": "world"\n}';
    const { container } = render(<pre>{highlightCode(code, "json")}</pre>);

    expect(container.textContent).toBe(code);
    expect(
      container.querySelectorAll("span[class^='hljs-']").length,
    ).toBeGreaterThan(0);
  });

  // The security invariant: body content must never become markup. Even
  // though hljs escapes its input, the conversion to React elements must only
  // ever emit hljs token spans — a hostile body that survives as an <img> or
  // <script> element would execute on this origin.
  it("renders a hostile body as text, never as elements", () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(<pre>{highlightCode(hostile, "xml")}</pre>);

    expect(container.textContent).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("falls back to plain text when highlighting fails", () => {
    const { container } = render(
      <pre>{highlightCode("anything", "nonsense" as never)}</pre>,
    );
    expect(container.textContent).toBe("anything");
  });
});
