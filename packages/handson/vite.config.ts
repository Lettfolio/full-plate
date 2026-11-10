/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The demo page lives in demo/; `vite build` writes a self-contained static demo to dist/ (relative paths).
export default defineConfig({
  root: fileURLToPath(new URL("./demo", import.meta.url)),
  base: "./",
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000, // round 11: vitest 4 enforces this on synchronous tests too
  },
});
