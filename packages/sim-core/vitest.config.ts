import { defineConfig } from "vitest/config";

// Round 11: vitest 4 fails a synchronous test that overran testTimeout (vitest 2 never could), so give the long
// headless runs the same 60 s the career/empire packages already use; the tests keep their own speed bounds.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/headless.ts", "src/types.ts"],
      reporter: ["text-summary", "text"],
      thresholds: {
        "src/systems/**": { lines: 80 },
      },
    },
  },
});
