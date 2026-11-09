/** Round 4: the ladder re-pace. The first promotion is ~8–12 good hands-on shifts (about an hour of play). */
import { describe, expect, it } from "vitest";
import { advanceCareerDay, DEFAULT_POLICY, handsOnGrowth, HANDS_ON_GROWTH, LADDER, NLW, newCareer, promotionChecklist, rungWage, shiftGrowth } from "../src/index";
import type { CareerGame, HandsOnShiftScore } from "../src/index";
import { content } from "./helpers";

function firstPromotion(seed: number, handsOn?: HandsOnShiftScore, maxDays = 120): { day: number; shifts: number } | undefined {
  let g: CareerGame = newCareer(content, { seed, track: "chef", strategy: "balanced", playerName: "Robin" });
  for (let d = 0; d < maxDays; d++) {
    const before = g.career.shiftsWorked;
    const r = advanceCareerDay(content, g, DEFAULT_POLICY, handsOn);
    g = r.game;
    if (r.events.some((e) => e.type === "PROMOTED")) return { day: g.career.day, shifts: before + (g.career.shiftsWorked > before ? 1 : 0) };
  }
  return undefined;
}

describe("ladder re-pace (round 4)", () => {
  it("first rungs ask for 10–12 shifts; later rungs ask for longer; wages keep the NLW floor", () => {
    expect(LADDER.chef[1]!.criteria!.shiftsAtRung).toBe(10);
    for (const track of ["chef", "bar", "waiter"] as const) {
      const rungs = LADDER[track];
      expect(rungs[1]!.criteria!.shiftsAtRung).toBeLessThanOrEqual(12);
      expect(rungs[2]!.criteria!.shiftsAtRung).toBeGreaterThanOrEqual(rungs[1]!.criteria!.shiftsAtRung * 3);
      for (let i = 2; i < rungs.length; i++) expect(rungs[i]!.criteria!.shiftsAtRung).toBeGreaterThan(rungs[i - 1]!.criteria!.shiftsAtRung);
      for (let i = 0; i < rungs.length; i++) expect(rungWage(track, i, "cheap")).toBeGreaterThanOrEqual(NLW);
    }
  });

  it("a hands-on shift grows cooking skill several times faster than a watched one", () => {
    const g = newCareer(content, { seed: 3, track: "chef", strategy: "balanced", playerName: "Robin" });
    const watched = shiftGrowth(g.career, false);
    const good = handsOnGrowth(g.career, { stars: 2, points: 900, meanQuality: 85, plates: 10 });
    expect(good).toBeCloseTo((2 * HANDS_ON_GROWTH.perStar + 10 * HANDS_ON_GROWTH.perPlate) * (1 - 22 / 115), 5);
    expect(good / watched).toBeGreaterThan(4);
    expect(handsOnGrowth(g.career, { stars: 3, points: 2000, meanQuality: 99, plates: 40 })).toBeLessThan(1.3); // plates capped
  });

  it("a commis playing good (★★, 10-plate) shifts is promoted in 8–12 shifts; only watching takes far longer", () => {
    for (const seed of [1, 2, 3]) {
      const p = firstPromotion(seed, { stars: 2, points: 900, meanQuality: 85, plates: 10 });
      expect(p, `seed ${seed}`).toBeDefined();
      expect(p!.shifts).toBeGreaterThanOrEqual(8);
      expect(p!.shifts).toBeLessThanOrEqual(13);
    }
    const watched = firstPromotion(1, undefined, 40);
    expect(watched).toBeUndefined();
  });

  it("stepCareerDay reports tonight's growth (GREW), with the hands-on share", () => {
    let g = newCareer(content, { seed: 2, track: "chef", strategy: "balanced", playerName: "Robin" });
    let grew;
    for (let d = 0; d < 7 && !grew; d++) {
      const r = advanceCareerDay(content, g, DEFAULT_POLICY, { stars: 3, points: 1500, meanQuality: 95, plates: 14 });
      g = r.game;
      grew = r.events.find((e) => e.type === "GREW");
    }
    expect(grew).toBeDefined();
    if (grew?.type !== "GREW") return;
    expect(grew.handsOn).toBeGreaterThan(0.5);
    expect(grew.gain).toBeGreaterThan(grew.handsOn);
    expect(promotionChecklist(g.career).items.find((i) => i.key === "stat")!.current).toBeCloseTo(grew.stat, 1);
  });
});
