import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The untrusted-body invariant, made non-regressible: captured bodies are
 * attacker-controlled and must never execute on this origin. Rendering
 * behavior is covered by component tests (a hostile HTML body stays text, an
 * SVG part never becomes a typed blob); this scan closes the other path — a
 * future edit that renders body content as markup, or navigates to it, would
 * pass those tests on benign fixtures and only this fails.
 *
 * The sink bans are file-wide and global, not scoped to lines mentioning the
 * body endpoint — scoping them would let a routine refactor (aliasing a URL
 * into a variable, building markup in a helper) silently disable the guard.
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

/** Markup-injection sinks: any of these can turn text into live DOM. */
const MARKUP_SINKS = [
  /dangerouslySetInnerHTML/,
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\bsrcdoc\b/i,
  /insertAdjacentHTML/,
  /document\.write/,
  /createContextualFragment/,
  /<iframe|<embed|<object/i,
  // DOM-API construction of an embeddable element is the same sink without
  // the angle bracket.
  /createElement\s*\(\s*["'`](iframe|embed|object|script|frame)/i,
];

/** Navigation sinks: any of these can load attacker content as a document. */
const NAVIGATION_SINKS = [
  /window\.open\s*\(/,
  /location\.assign\s*\(/,
  /location\.replace\s*\(/,
  // Any alias that reaches the location object: window/document/top/self/
  // parent-qualified or bare, assigned directly or via href.
  /\b(window|document|top|self|parent)\.location\s*=/,
  /\blocation\.href\s*=/,
  /Object\.assign\s*\(\s*(window\.|document\.)?location\b/,
];

describe("the untrusted-body invariant", () => {
  const files = sourceFiles(srcDir);

  it("scans a plausible source tree", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith("RequestBody.tsx"))).toBe(true);
  });

  it("never uses a markup-injection sink anywhere in the app", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      for (const sink of MARKUP_SINKS) {
        expect(source, `${file} matches ${sink}`).not.toMatch(sink);
      }
    }
  });

  it("never uses a navigation sink anywhere in the app", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      for (const sink of NAVIGATION_SINKS) {
        expect(source, `${file} matches ${sink}`).not.toMatch(sink);
      }
    }
  });

  // The body endpoint may be referenced in exactly two places: the service
  // layer's fetches, and an <img src> (a sub-resource load, which the
  // endpoint's nosniff/attachment headers keep inert). Anywhere else —
  // including an href, however aliased — is a new way to load attacker
  // content as a document and must show up here for review.
  it("references the body endpoint only from the service layer and <img src>", () => {
    for (const file of files) {
      if (file.endsWith("/services.ts")) continue;
      const source = readFileSync(file, "utf-8");
      for (const line of source.split("\n")) {
        if (!/\/body\b/.test(line)) continue;
        expect(line, file).toMatch(/src=/);
      }
    }
  });
});
