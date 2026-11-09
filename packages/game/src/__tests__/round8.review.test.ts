/**
 * Round 8 review: seams between A (maps), B (interface system) and C (canvas art).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const theme = readFileSync(join(SRC, "theme.css"), "utf8");
const mapCss = readFileSync(join(SRC, "screens/paths/map.css"), "utf8");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "__tests__" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
const tsx = walk(SRC).filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(f, "utf8")).join("\n");

/** The first literal value of a custom property in theme.css, following var() aliases. */
function resolve(name: string, depth = 0): string | undefined {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(theme);
  if (!m) return undefined;
  const v = m[1]!.trim();
  const alias = /^var\(--([\w-]+)\)$/.exec(v);
  return alias && depth < 5 ? resolve(alias[1]!, depth + 1) : v;
}

describe("round 8 review", () => {
  it("every token the canvases and the maps read resolves to a literal colour", () => {
    const tokens = ["ink", "ink-soft", "ink-faint", "paper", "cream", "cream-deep", "tomato", "tomato-deep", "basil", "basil-deep", "basil-wash",
      "amber", "amber-deep", "plum", "sky", "sky-deep", "star", "star-edge", "cheer", "line", "line-strong", "own", "franchise", "licence"];
    for (const t of tokens) expect(resolve(t), t).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  it("the map's ownership colours are the shared --own / --franchise / --licence tokens", () => {
    const wm = readFileSync(join(SRC, "screens/paths/WorldMap.tsx"), "utf8");
    expect(wm).toMatch(/OWN_COLOUR = \["var\(--own\)", "var\(--franchise\)", "var\(--licence\)"\]/);
  });

  it("the old one-svg map's rules are gone (and map.css no longer needs to undo them)", () => {
    expect(theme).not.toMatch(/\.empire__legend|\.pin-hit|\.empire__map svg/);
    expect(mapCss).not.toMatch(/\.empire__map /);
  });

  it("pills are sentence case: no capitalize (which made Title Case) and no lower-case literal pill text", () => {
    expect(theme).not.toMatch(/\.pill\s*\{[^}]*text-transform:\s*capitalize/);
    expect(tsx).not.toMatch(/className="pill[^"]*">[a-z]/);
  });

  it("no all-caps eyebrow is left on the career screens", () => {
    const career = ["screens/career/MyShift.tsx", "screens/career/CareerEvening.tsx"].map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
    expect(career).not.toMatch(/className="[^"]*\bcaps\b/);
  });

  it("the owner's floor canvas is a lazy chunk: Service imports RestaurantView for types only", () => {
    const svc = readFileSync(join(SRC, "screens/Service.tsx"), "utf8");
    expect(svc).toMatch(/import type \{ RestaurantView, Highlight \} from "\.\.\/canvas\/RestaurantView"/);
    expect(svc).toMatch(/import\("\.\.\/canvas\/RestaurantView"\)/);
  });
});
