// Registers @testing-library/jest-dom's DOM matchers on Vitest's `expect`, and
// tears down the rendered tree between tests. Wired in via vite.config.ts.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
