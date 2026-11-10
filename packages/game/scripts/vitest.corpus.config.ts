/// <reference types="vitest/config" />
// Only used to rebuild the generated half of the save corpus (scripts/corpus.gen.ts); not part of `pnpm test`.
import { defineConfig } from "vite";

export default defineConfig({
  test: { environment: "node", include: ["scripts/corpus.gen.ts"], testTimeout: 900_000 },
});
