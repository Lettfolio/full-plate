/**
 * Round 11 (red-team G3, G4): the dynasty is winnable. Keeping a star is easier than earning it, a head chef who wants
 * their own place can be kept with a pay rise, and the El Bulli ending is a win only at the very top.
 */
import { describe, expect, it } from "vitest";
import { applyStarsCommand, decideGuide, starsView, stepStarsDay, STARS_CONSTANTS as C, type InspectorVisit, type StarsCommand, type StarsState } from "../src";
import { emptyAssessment } from "../src/inspector";
import { chef, content, dayResult, eveningState, fresh } from "./helpers";

const visit = (day: number, v: number): InspectorVisit => ({ day, inspector: "X", scores: { ingredients: v, harmony: v, technique: v, personality: v, consistency: v }, total: v, revealed: false });
/** A steady, fully open year (as in inspector.test.ts). */
const year = { ...emptyAssessment(0), openDays: 250, qN: 250, qSum: 250 * 95, qSumSq: 250 * 95 * 95, criteriaSum: { ingredients: 0, harmony: 0, technique: 0, personality: 0, consistency: 250 * 95 } };
/** Two visits whose guide score is `score` (to 0.01): bisect the visits' criterion level. */
function guide(before: 0 | 1 | 2 | 3, score: number) {
  let lo = 0, hi = 100;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if ((decideGuide(0, [visit(1, mid), visit(2, mid)], year, false).score ?? 0) < score) lo = mid; else hi = mid;
  }
  const d = decideGuide(before, [visit(1, hi), visit(2, hi)], year, false);
  expect(Math.abs(d.score! - score)).toBeLessThan(0.011);
  return d;
}
const withStars = (s: StarsState, n: 0 | 1 | 2 | 3, streak = 0): StarsState => ({ ...s, peakStars: n, guides: { ...s.guides, michelin: { ...s.guides.michelin, stars: n, threeStarStreak: streak } } });
const cmd = (s: StarsState, c: StarsCommand, cash = 50_000_000) => applyStarsCommand(content, s, c, { day: 0, cash, state: eveningState(0, 90) });

describe("G3: keeping a star is easier than earning it", () => {
  const [one, two, three] = C.STAR_THRESHOLDS;
  it("the bars are unchanged for earning (78 / 85 / 91) and the keep margin is 2", () => {
    expect(C.STAR_THRESHOLDS).toEqual([78, 85, 91]);
    expect(C.STAR_KEEP_MARGIN).toBe(2);
    expect(guide(2, three - 0.5).after).toBe(2); // 90.5 doesn't earn the third star
    expect(guide(2, three).after).toBe(3);
  });
  it("★★★ is kept down to 89; below that the guide takes one star", () => {
    expect(guide(3, three - 0.5).after).toBe(3);
    expect(guide(3, three - C.STAR_KEEP_MARGIN).after).toBe(3);
    expect(guide(3, three - C.STAR_KEEP_MARGIN - 0.01).after).toBe(2);
    expect(guide(2, two - 2).after).toBe(2);
    expect(guide(2, two - 2.5).after).toBe(1);
    expect(guide(1, one - 2).after).toBe(1);
    expect(guide(1, one - 3).after).toBe(0);
    expect(guide(3, 40).after).toBe(2); // still at most one star a year
  });
  it("a kept third star carries the dynasty streak on (the red-team's 90.4 year no longer restarts it)", () => {
    let s = withStars(fresh(0), 3, 2);
    const day = s.guides.michelin.nextGuideDay;
    s = { ...s, guides: { ...s.guides, michelin: { ...s.guides.michelin, inspectorVisits: [visit(day - 40, 89.6), visit(day - 30, 89.6)] } }, assessment: year, lastDay: day - 1 };
    const r = stepStarsDay(content, s, dayResult(day), eveningState(day, 95));
    const g = r.events.find((e) => e.type === "GUIDE_DAY");
    if (g?.type !== "GUIDE_DAY") throw new Error("no guide day");
    expect(g.result.score!).toBeLessThan(C.STAR_THRESHOLDS[2]);
    expect(g.result.score!).toBeGreaterThanOrEqual(C.STAR_THRESHOLDS[2] - C.STAR_KEEP_MARGIN);
    expect(g.result.after).toBe(3);
    expect(starsView(r.stars, day).threeStarStreak).toBe(3);
  });
});

describe("G3: a head chef who wants their own place can be kept", () => {
  const arc = (s: StarsState): StarsState => ({ ...s, headChef: { ...s.headChef, staffId: "c1", wantsOwnPlace: true, decisionDeadline: 60, stress: 50 } });
  it("PAY_HEAD_CHEF_TO_STAY: costs PAY_RISE_COST, the chef stays (no lost star), is calmer and won't ask again for two years", () => {
    const s = arc(withStars(fresh(0, [chef("c1", 95), chef("c2", 80)]), 2));
    const r = cmd(s, { type: "PAY_HEAD_CHEF_TO_STAY" });
    expect(r.events.some((e) => e.type === "HEAD_CHEF_LEFT")).toBe(false);
    expect(r.stars.headChef).toMatchObject({ staffId: "c1", wantsOwnPlace: false, staysUntil: C.PAY_RISE_STAY_DAYS, stress: 50 + C.PAY_RISE_STRESS });
    expect(r.stars.headChef.decisionDeadline).toBeUndefined();
    expect(r.stars.ledger.pendingCash).toBe(-C.PAY_RISE_COST);
    expect(r.stars.guides.michelin.stars).toBe(2);
    // Can't afford it, or nobody is leaving: refused.
    expect(cmd(s, { type: "PAY_HEAD_CHEF_TO_STAY" }, C.PAY_RISE_COST - 1).events[0]?.type).toBe("REJECTED");
    expect(cmd(fresh(), { type: "PAY_HEAD_CHEF_TO_STAY" }).events[0]?.type).toBe("REJECTED");
  });
});

describe("G4: El Bulli is a win only at the very top", () => {
  it("★★ or a fresh ★★★: an honourable ending (win: false); ★★★ held on two guides: a win", () => {
    const at2 = cmd(withStars(fresh(), 2), { type: "CLOSE_AT_PEAK" }).stars.ending!;
    expect(at2).toMatchObject({ kind: "el_bulli", win: false });
    expect(at2.text).toMatch(/proud ending/);
    expect(cmd(withStars(fresh(), 3, 1), { type: "CLOSE_AT_PEAK" }).stars.ending).toMatchObject({ win: false });
    const top = cmd(withStars(fresh(), 3, C.EL_BULLI_WIN_GUIDES), { type: "CLOSE_AT_PEAK" }).stars.ending!;
    expect(top).toMatchObject({ kind: "el_bulli", win: true });
    expect(C.EL_BULLI_WIN_GUIDES).toBe(2);
  });
});
