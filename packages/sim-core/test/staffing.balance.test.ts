/**
 * Balance guard on the REAL content pack (round 2): hiring staff must beat running the place alone.
 * In M1 the owner covering every role was the most profitable play (docs/REVIEW.md §2). "nohire" is the
 * scripted owner who never hires; "balanced" hires a chef and a server (and cover for their days off).
 */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { playOne, STRATEGIES } from "../src/headless";

const SEEDS = [1, 2, 3, 4, 5];
const DAYS = 90;

function medianCash(strategy: "balanced" | "nohire", districtId: string): number {
  const idx = content.districts.findIndex((d) => d.id === districtId);
  const cash = SEEDS.map((seed) => playOne(content, seed * content.districts.length + idx, DAYS, STRATEGIES[strategy], "normal").final!.cash);
  return cash.sort((a, b) => a - b)[Math.floor(cash.length / 2)]!;
}

describe("staffing balance (real content)", () => {
  for (const d of content.districts) {
    it(`balanced beats nohire on median cash by day ${DAYS} in ${d.name}`, () => {
      expect(medianCash("balanced", d.id)).toBeGreaterThan(medianCash("nohire", d.id));
    }, 120_000);
  }
});
