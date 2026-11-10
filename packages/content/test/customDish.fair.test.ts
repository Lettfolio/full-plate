/**
 * Round 12 (F) fairness: a typical owner who invents three sensible dishes (test/inventor.ts) survives year 1 at about
 * the rate typical does. The full 100-seed comparison (the number in CONTENT-NOTES "Round 12 — F") is
 *   npx tsx -e 'import("./test/inventor.ts").then(async (m) => console.log(m.fairness((await import("./src/index.ts")).content, 100)))'
 * Here: a smaller, quicker sample with a looser bound, plus the invented dishes must actually sell.
 */
import { describe, expect, it } from "vitest";
import { content } from "../src/index";
import { fairness } from "./inventor";

describe("inventing is fair", () => {
  it("typical with three invented dishes survives about as often as typical (12 seeds × 365 days)", () => {
    const r = fairness(content, 12);
    expect(r.customPerDay).toBeGreaterThan(5);
    expect(Math.abs(r.inventor - r.typical)).toBeLessThanOrEqual(25);
  }, 600_000);
});
