/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The game always bundles the real @full-plate/sim-core and @full-plate/content workspace packages.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Round 3 review: path screens and the hands-on canvas are React.lazy chunks (App.tsx, Planning.tsx). The sims
        // the reducer and save envelope call synchronously get their own cacheable chunks instead of one 780 kB file.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
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
  },
});
