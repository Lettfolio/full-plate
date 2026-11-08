import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The demo page lives in demo/; `vite build` writes a self-contained static demo to dist/ (relative paths).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("../dist", import.meta.url)), emptyOutDir: true },
  server: { port: 5301, fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
});
