/** Round 5: WCAG AA (4.5:1) for the text/background pairs theme.css actually uses, read from the live tokens. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const theme = readFileSync(join(__dirname, "../theme.css"), "utf8");
const token = (n: string) => /^#/.test(n) ? n : new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, "i").exec(theme)![1]!;
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
export const ratio = (a: string, b: string) => { const [x, y] = [lum(token(a)), lum(token(b))].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

const PAIRS: [string, string][] = [
  ...["cream", "paper", "cream-deep", "amber-wash", "basil-wash", "tomato-wash", "sky-wash", "plum-wash", "#fde9e4", "#ece6dd", "#fdf0e9"].flatMap((b) => [["ink-faint", b], ["ink-soft", b], ["ink", b]] as [string, string][]),
  ["tomato", "cream"], ["tomato", "paper"], ["tomato-deep", "tomato-wash"], ["tomato-deep", "#fde9e4"], ["basil", "cream"], ["basil-deep", "basil-wash"],
  ["#ffffff", "tomato"], ["#ffffff", "tomato-deep"], ["#ffffff", "basil"], ["#ffffff", "basil-deep"], ["#ffffff", "sky-deep"], ["#ffffff", "amber-deep"], ["#ffffff", "plum"], ["#ffffff", "ink-soft"],
  ["#7a4f0a", "amber-wash"], ["#6b4508", "amber-wash"], ["#8a5a0b", "#fdf0c9"], ["#2d6788", "sky-wash"], ["#1f5577", "sky-wash"], ["#6a3f7d", "plum-wash"], ["#5d3a6c", "plum-wash"], ["#ffffff", "#2c5f80"],
  // Round 5 review: the per-district franchise verdict on the Empire side panel (paper card).
  ["basil-deep", "paper"], ["amber-deep", "paper"], ["tomato-deep", "paper"],
];

describe("colour contrast (WCAG AA, normal text)", () => {
  it.each(PAIRS)("%s on %s ≥ 4.5:1", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
