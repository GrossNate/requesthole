import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The untrusted-body invariant, made non-regressible: captured bodies are
 * attacker-controlled and must never execute on this origin. Rendering
 * behavior is covered by component tests (a hostile HTML body stays text);
 * this scan closes the other path — a future edit that renders body content
 * as markup via dangerouslySetInnerHTML, an iframe, or navigation to the body
 * endpoint would pass those tests on benign fixtures and only this fails.
 */
const componentsDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(componentsDir, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.test\.(ts|tsx)$/.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name));

describe("the untrusted-body invariant", () => {
  const files = sourceFiles(srcDir);

  it("scans a plausible source tree", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith("RequestBody.tsx"))).toBe(true);
  });

  it("never renders anything via dangerouslySetInnerHTML or innerHTML", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML/);
      expect(source, file).not.toMatch(/\binnerHTML\b/);
    }
  });

  it("never embeds an iframe, embed, or object element", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).not.toMatch(/<iframe|<embed|<object/i);
    }
  });

  // The body endpoint may appear only as an <img src> (a sub-resource load,
  // which its nosniff/attachment headers keep inert) or inside a service
  // fetch. A link or navigation to it would render attacker content as a
  // document on this origin.
  it("never links to or navigates to the body endpoint", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      for (const line of source.split("\n")) {
        if (!/\/body\b/.test(line)) continue;
        expect(line, file).not.toMatch(/href=|window\.location|navigate\(/);
      }
    }
  });
});
