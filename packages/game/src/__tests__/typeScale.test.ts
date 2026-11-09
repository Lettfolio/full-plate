/**
 * Round 5 type scale (UI-NOTES "Type scale"): a static guard next to the Playwright audit (scripts/type-audit.mjs).
 * Every CSS font-size, every SVG fontSize in the game's TSX and every canvas label size in the two renderers ≥ 13 px.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : [p];
});
const MIN = 13;

describe("type scale", () => {
  const css = walk(SRC).filter((p) => p.endsWith(".css")).map((p) => [p, read(p)] as const);

  it("tokens: body ≥ 14, labels 15, micro 13", () => {
    const theme = read(join(SRC, "theme.css"));
    const tok = (n: string) => Number(new RegExp(`--${n}:\\s*([\\d.]+)px`).exec(theme)![1]);
    expect(tok("fs-xs")).toBeGreaterThanOrEqual(14);
    expect(tok("fs-sm")).toBeGreaterThanOrEqual(14);
    expect(tok("fs-micro")).toBeGreaterThanOrEqual(MIN);
    expect(tok("fs-label")).toBeGreaterThanOrEqual(15);
  });

  it("no CSS font-size below 13 px", () => {
    for (const [p, text] of css) {
      for (const m of text.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1]), `${p}: ${m[0]}`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it("no inline fontSize below 13 in TSX (SVG text is checked on screen by the audit)", () => {
    for (const p of walk(SRC).filter((f) => f.endsWith(".tsx"))) {
      for (const m of read(p).matchAll(/fontSize[=:]\s*\{?"?([\d.]+)/g)) expect(Number(m[1]), `${p}: ${m[0]}`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it("canvas labels: RestaurantView and the hands-on renderer never ask for less than 13 px", () => {
    const files = [join(SRC, "canvas/RestaurantView.ts"), join(SRC, "../../handson/src/render.ts")];
    for (const p of files) {
      const text = read(p);
      for (const m of text.matchAll(/size:\s*([\d.]+)\b/g)) expect(Number(m[1]), `${p}: ${m[0]}`).toBeGreaterThanOrEqual(MIN);
      for (const m of text.matchAll(/(\d+(?:\.\d+)?)px (?:Nunito|\$\{FONT\})/g)) expect(Number(m[1]), `${p}: ${m[0]}`).toBeGreaterThanOrEqual(MIN);
    }
  });
});
