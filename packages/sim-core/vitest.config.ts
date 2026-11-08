import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
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
