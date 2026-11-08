/**
 * Balance guard on the REAL content pack: pricing 25% over suggested ("premium") must not be
 * strictly better than pricing at suggested ("balanced") in every district. Before MARKUP_WEIGHT
 * existed, premium won in all four districts (docs/REVIEW.md).
 */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { playOne, STRATEGIES } from "../src/headless";

const SEEDS = [1, 2, 3];
const DAYS = 150;

function meanCash(strategy: "balanced" | "premium", districtId: string): number {
  let total = 0;
  for (const seed of SEEDS) {
    // playOne picks the district from the seed; map our seed onto the wanted district.
    const idx = content.districts.findIndex((d) => d.id === districtId);
    const s = seed * content.districts.length + idx;
    total += playOne(content, s, DAYS, STRATEGIES[strategy], "normal").final!.cash;
  }
  return total / SEEDS.length;
}

describe("pricing balance (real content)", () => {
  it("premium pricing is not strictly better than balanced in every district", () => {
    const wins = content.districts.map((d) => meanCash("premium", d.id) > meanCash("balanced", d.id));
    expect(wins.every(Boolean)).toBe(false);
  }, 120_000);
});
