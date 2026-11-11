/**
 * Round 13 review: every localStorage / sessionStorage use goes through lib/storage.ts (E's namespacing by path,
 * the one-time migration on Pages, memory when storage is blocked). A raw use anywhere else in the game's source
 * would write an un-namespaced key on GitHub Pages and throw in a private window — this test fails on the first one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const ALLOWED = new Set(["lib/storage.ts"]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") out.push(...files(p)); continue; }
    if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** The source with comments and string contents blanked (so a doc comment naming localStorage doesn't count). */
export function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
}

describe("Round 13 review: storage goes through lib/storage.ts", () => {
  it("the scanner sees a raw use and ignores comments and strings", () => {
    expect(codeOnly("const v = localStorage.getItem(k);")).toMatch(/\blocalStorage\b/);
    expect(codeOnly("try { window.sessionStorage.clear() } catch {}")).toMatch(/\bsessionStorage\b/);
    expect(codeOnly("// kept in localStorage\n/* sessionStorage */ const s = \"localStorage\";")).not.toMatch(/\b(local|session)Storage\b/);
  });

  it("no raw localStorage or sessionStorage outside lib/storage.ts", () => {
    const raw: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      const code = codeOnly(readFileSync(f, "utf8"));
      code.split("\n").forEach((line, i) => { if (/\b(localStorage|sessionStorage)\b/.test(line)) raw.push(`${rel}:${i + 1}`); });
    }
    expect(raw).toEqual([]);
  });
});
