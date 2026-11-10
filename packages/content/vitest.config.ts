import { defineConfig } from "vitest/config";

// Round 11: vitest 4 fails a synchronous test that overran testTimeout (vitest 2 never could).
export default defineConfig({ test: { testTimeout: 60_000 } });
