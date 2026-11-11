// @vitest-environment node
/**
 * Round 13 (E, red-team S12): the Pages build carries the Content-Security-Policy, and nothing it ships needs more
 * than the policy allows (no inline script, no inline style, no eval, nothing from another origin). One real
 * `vite build` with FP_TARGET=pages into a temp folder; the plain build (the artifact's) is checked to carry none.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSP_POLICY, injectCsp, wantsCsp } from "../csp.config";

const root = join(__dirname, "..", "..");
const template = readFileSync(join(root, "index.html"), "utf8");

describe("the policy", () => {
  it("says what the brief asks for, and only the Pages build gets it", () => {
    expect(CSP_POLICY).toContain("default-src 'self'");
    expect(CSP_POLICY).toContain("script-src 'self'");
    expect(CSP_POLICY).toContain("style-src 'self'");
    expect(CSP_POLICY).toContain("connect-src 'self'");
    expect(CSP_POLICY).toContain("object-src 'none'");
    expect(CSP_POLICY).toContain("base-uri 'self'");
    expect(CSP_POLICY).toContain("form-action 'none'");
    expect(CSP_POLICY).not.toMatch(/unsafe-|\*|https?:/);
    expect(wantsCsp({ FP_TARGET: "pages" })).toBe(true);
    expect(wantsCsp({})).toBe(false);
    expect(wantsCsp({ FP_TARGET: "artifact" })).toBe(false);
  });

  it("goes in straight after <meta charset>, before anything that loads", () => {
    const html = injectCsp(template);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    const tags = [...head.matchAll(/<(meta|script|link|style)\b[^>]*>/g)].map((m) => m[0]);
    expect(tags[0]).toMatch(/charset/);
    expect(tags[1]).toBe(`<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />`);
    expect(() => injectCsp("<html><head></head></html>")).toThrow(/charset/);
  });
});

describe("the built Pages dist", () => {
  it("carries the policy; no inline script or style; no eval; everything loads from the page's own folder", async () => {
    const { build } = await import("vite");
    const out = mkdtempSync(join(tmpdir(), "fp-csp-"));
    const was = process.env.FP_TARGET;
    process.env.FP_TARGET = "pages";
    try {
      await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    } finally {
      if (was === undefined) delete process.env.FP_TARGET; else process.env.FP_TARGET = was;
    }
    try {
      const html = readFileSync(join(out, "index.html"), "utf8");
      const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)];
      expect(metas.map((m) => m[1])).toEqual([CSP_POLICY]);
      // Every <script> has a src; no <style> element; no style="" attribute; no inline handler.
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      expect(scripts.length).toBeGreaterThan(0);
      for (const [, attrs, body] of scripts) { expect(attrs).toMatch(/\bsrc="\.\/assets\//); expect(body!.trim()).toBe(""); }
      expect(html).not.toMatch(/<style\b/);
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/\son[a-z]+="/);
      // Every src/href is in the page's own folder (or the data: favicon).
      for (const [, url] of html.matchAll(/\s(?:src|href)="([^"]*)"/g)) expect(url).toMatch(/^(\.\/assets\/|data:image\/svg\+xml,)/);
      // No chunk needs 'unsafe-eval', and none reaches another origin with fetch/XHR/WebSocket/EventSource.
      const js = readdirSync(join(out, "assets")).filter((f) => f.endsWith(".js"));
      expect(js.length).toBeGreaterThan(20);
      for (const f of js) {
        const code = readFileSync(join(out, "assets", f), "utf8");
        expect(code, f).not.toMatch(/\bnew Function\s*\(|[^.\w]eval\s*\(/);
        expect(code, f).not.toMatch(/new (WebSocket|EventSource|XMLHttpRequest)\b/);
      }
      // The stylesheets pull fonts from assets/ only.
      for (const f of readdirSync(join(out, "assets")).filter((x) => x.endsWith(".css"))) {
        for (const [, url] of readFileSync(join(out, "assets", f), "utf8").matchAll(/url\(([^)]*)\)/g)) expect(url!.replace(/["']/g, ""), f).toMatch(/^(\.\/|[\w.-]+\.(woff2?|png|svg)$|data:)/);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
