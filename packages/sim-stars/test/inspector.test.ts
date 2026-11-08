import { describe, expect, it } from "vitest";
import {
  decideGuide, firstGuideDay, guideScore, inspectorModel, nextMonthStart, scheduleVisits, starsForScore, starsView, STARS_CONSTANTS as C,
} from "../src";
import { Rng } from "../src/rng";
import { emptyAssessment } from "../src/inspector";
import { fresh, run } from "./helpers";
import type { InspectorVisit } from "../src";

const visit = (day: number, v: number): InspectorVisit => ({ day, inspector: "X", scores: { ingredients: v, harmony: v, technique: v, personality: v, consistency: v }, total: v, revealed: false });

describe("calendar", () => {
  it("guide day is the 1st of February in sim-core's calendar (day 0 = April)", () => {
    expect(nextMonthStart(0, 2)).toBe(300);
    expect(nextMonthStart(301, 2)).toBe(660);
    expect(firstGuideDay(0)).toBe(300);
    expect(firstGuideDay(200)).toBe(660); // needs ≥ 180 days of assessment
  });
});

describe("visit scheduling", () => {
  it("draws 2-5 distinct hidden days inside the window, none in the print cutoff, deterministic per seed", () => {
    for (let seed = 1; seed < 200; seed++) {
      const days = scheduleVisits(Rng.fromSeed(seed), 0, 300);
      expect(days.length).toBeGreaterThanOrEqual(C.VISITS_MIN);
      expect(days.length).toBeLessThanOrEqual(C.VISITS_MAX);
      expect(new Set(days).size).toBe(days.length);
      for (const d of days) expect(d).toBeLessThan(300 - C.VISIT_CUTOFF_DAYS);
      expect(scheduleVisits(Rng.fromSeed(seed), 0, 300)).toEqual(days);
    }
  });
  it("about half the visits fall in inspection season", () => {
    let season = 0, all = 0;
    for (let seed = 1; seed < 400; seed++) for (const d of scheduleVisits(Rng.fromSeed(seed), 0, 300)) { all++; if (d >= 300 - C.SEASON_DAYS) season++; }
    expect(season / all).toBeGreaterThan(0.55); // season share + uniform share landing in season
    expect(season / all).toBeLessThan(0.85);
  });
});

describe("guide decision", () => {
  const a = { ...emptyAssessment(0), openDays: 250, qN: 250, qSum: 250 * 95, qSumSq: 250 * 95 * 95, criteriaSum: { ingredients: 0, harmony: 0, technique: 0, personality: 0, consistency: 250 * 95 } };
  it("maps scores to stars", () => {
    expect(starsForScore(0)).toBe(0);
    expect(starsForScore(C.STAR_THRESHOLDS[0])).toBe(1);
    expect(starsForScore(C.STAR_THRESHOLDS[2])).toBe(3);
  });
  it("climbs one star a year, two only on a clear margin over ≥ 3 visits", () => {
    expect(decideGuide(0, [visit(1, 95), visit(2, 95)], a, false).after).toBe(1);
    expect(decideGuide(0, [visit(1, 95), visit(2, 95), visit(3, 95)], a, false).after).toBe(2);
    expect(decideGuide(1, [visit(1, 95), visit(2, 95), visit(3, 95)], a, false).after).toBe(3);
  });
  it("drops at most one star a year", () => {
    expect(decideGuide(3, [visit(1, 40), visit(2, 40)], a, false).after).toBe(2);
  });
  it("Fat Duck rule: too few open days or visits ⇒ not assessed ⇒ stars lapse", () => {
    const shut = { ...a, openDays: C.MIN_OPEN_DAYS_ASSESSED - 1 };
    const d = decideGuide(3, [visit(1, 95), visit(2, 95)], shut, false);
    expect(d).toMatchObject({ after: 0, assessed: false });
    expect(decideGuide(3, [visit(1, 95)], a, false)).toMatchObject({ after: 0, assessed: false });
  });
  it("uses the whole year's consistency, not just the good nights", () => {
    const steady = guideScore([visit(1, 90)], 95);
    const wobbly = guideScore([visit(1, 90)], 40);
    expect(steady - wobbly).toBeCloseTo((95 - 40) * C.YEAR_CONSISTENCY_WEIGHT / 5, 5);
  });
});

describe("inspectorModel (debug / cosy hint only)", () => {
  it("has no opinion without visits, gains confidence with more agreeing visits", () => {
    expect(inspectorModel([], [])).toMatchObject({ predictedStars: 0, confidence: 0 });
    const one = inspectorModel([visit(1, 92)], Array(60).fill(95));
    const four = inspectorModel([visit(1, 92), visit(2, 92), visit(3, 92), visit(4, 92)], Array(60).fill(95));
    expect(four.confidence).toBeGreaterThan(one.confidence);
    expect(four.predictedStars).toBe(3);
    const split = inspectorModel([visit(1, 98), visit(2, 70), visit(3, 98), visit(4, 70)], Array(60).fill(95));
    expect(split.confidence).toBeLessThan(four.confidence);
  });
});

describe("hidden visits end to end", () => {
  it("visits happen on the scheduled days, stay hidden from starsView, and are revealed on guide day", () => {
    const s0 = fresh(0);
    const scheduled = s0.guides.michelin.scheduled;
    const mid = run(s0, 0, 200, 95);
    expect(mid.stars.guides.michelin.inspectorVisits.every((v) => !v.revealed)).toBe(true);
    expect(mid.stars.guides.michelin.inspectorVisits.map((v) => v.day)).toEqual(scheduled.filter((d) => d < 200));
    const view = starsView(mid.stars, 199);
    expect(view.pastVisits).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("scheduled");
    expect(JSON.stringify(view)).not.toContain("assessment");
    const end = run(mid.stars, 200, 101, 95);
    const guide = end.events.find((e) => e.type === "GUIDE_DAY");
    expect(guide).toBeDefined();
    if (guide?.type !== "GUIDE_DAY") throw new Error();
    expect(guide.visits.map((v) => v.day)).toEqual(scheduled);
    expect(end.stars.guides.michelin.inspectorVisits.every((v) => v.revealed)).toBe(true);
    expect(end.stars.guides.michelin.nextGuideDay).toBe(660);
    expect(end.stars.guides.michelin.scheduled.every((d) => d > 300 && d < 660)).toBe(true);
  });
  it("a closed night makes the inspector rebook; a long closure loses the assessment (stars lapse)", () => {
    let s0 = fresh(0);
    s0 = { ...s0, guides: { ...s0.guides, michelin: { ...s0.guides.michelin, stars: 2 } } };
    const r = run(s0, 0, 301, (d) => (d < 200 ? undefined : 95));
    const g = r.events.find((e) => e.type === "GUIDE_DAY");
    if (g?.type !== "GUIDE_DAY") throw new Error("no guide");
    expect(g.result.assessed).toBe(false);
    expect(g.result.after).toBe(0);
  });
});
