/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { injectCsp, wantsCsp } from "./src/csp.config";

// The game always bundles the real @full-plate/sim-core and @full-plate/content workspace packages.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    // Round 13 (E, S12): the GitHub Pages build (FP_TARGET=pages) carries a meta Content-Security-Policy
    // (src/csp.config.ts says why each source is there, and why the artifact build has none).
    { name: "fp-csp", apply: "build", transformIndexHtml: { order: "post", handler: (html) => (wantsCsp(process.env) ? injectCsp(html) : html) } },
  ],
  // Round 11: vite 6 defaults to json.stringify "auto" (big JSON imports become JSON.parse("…") strings: +11 kB on the
  // content chunk). Keep vite 5's object literals so the chunk sizes stay where they were.
  json: { stringify: false },
  build: {
    // Round 11: vite 6's @rollup/plugin-commonjs (v28) wraps every CJS module in a lazy init by default
    // (strictRequires: true): +1.1 kB on the react chunk. vite 5's commonjs (v25) did not; keep that output.
    commonjsOptions: { strictRequires: false },
    rollupOptions: {
      output: {
        // Round 3 review: path screens and the hands-on canvas are React.lazy chunks (App.tsx, Planning.tsx). The sims
        // the reducer and save envelope call synchronously get their own cacheable chunks instead of one 780 kB file.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          // Round 11: the save schemas load with the save store, never in the main chunk.
          if (/\/packages\/sim-(core|empire|stars|career)\/src\/(schema|validate)\.ts$/.test(id)) return "saveCheck";
          // Round 12 (E): the voices (gossip, rival, regulars) load with the lazy screens that use them, not at start.
          if (/\/packages\/content\/(src\/voices\.ts|data\/(gossip|rival|regulars)\.json)$/.test(id)) return "voicesData";
          if (id.includes("/packages/content/")) return "content";
          if (id.includes("/packages/sim-core/")) return "sim-core";
          if (/\/packages\/sim-(empire|stars|career)\//.test(id)) return "paths";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 60_000, // round 11: vitest 4 enforces this on synchronous tests too (vitest 2 could not)
  },
});
