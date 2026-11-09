/// <reference types="vitest" />
// Only used by `node scripts/type-audit.mjs` to build its save files (scripts/audit-saves.gen.ts); not part of `pnpm test`.
import { defineConfig } from "vite";

export default defineConfig({
  test: { environment: "node", include: ["scripts/audit-saves.gen.ts"], testTimeout: 120_000 },
});
