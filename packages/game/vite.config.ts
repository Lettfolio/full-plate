/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Sim selection
 * - VITE_USE_STUBS=1 (and always under vitest): src/sim.ts uses the stubs in src/dev/. We also alias
 *   the two workspace packages to stub modules so stub dev keeps working even while the real
 *   packages are missing or mid-refactor.
 * - Flag unset: the real @full-plate/sim-core and @full-plate/content are bundled.
 *   Safety net for milestone 1 only: if a real package has no src/index.ts yet, we fall back to
 *   stubs with a loud warning (and the UI shows a "stub sim" badge) instead of failing the build.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const asked = (process.env.VITE_USE_STUBS ?? env.VITE_USE_STUBS) === "1" || mode === "test";
  const realMissing = !existsSync(here("../sim-core/src/index.ts")) || !existsSync(here("../content/src/index.ts"));
  if (!asked && realMissing) {
    console.warn("\n\x1b[33m[full-plate] @full-plate/sim-core or @full-plate/content has no src/index.ts yet — building with STUBS.\x1b[0m\n");
  }
  const stubs = asked || realMissing;
  return {
    plugins: [react()],
    resolve: {
      alias: (stubs
        ? {
            "@full-plate/sim-core": here("./src/dev/stubSimCoreModule.ts"),
            "@full-plate/content": here("./src/dev/stubContentModule.ts"),
          }
        : {}) as Record<string, string>,
    },
    define: stubs ? { "import.meta.env.VITE_USE_STUBS": JSON.stringify("1") } : {},
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      env: { VITE_USE_STUBS: "1" },
    },
  };
});
