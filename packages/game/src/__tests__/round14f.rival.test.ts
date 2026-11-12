/**
 * Round 14 (F, G10): the rival keeps pace with her. On master a good owner won 57 of 57 weeks (their score barely
 * moved, 3.3–3.9); now a good owner wins about 55–70 % of weeks, a struggling one still takes some, and the framed
 * clipping needs three wins that were real races.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "@full-plate/sim-core";
import { content, newGame, runStrategyDay, STRATEGIES } from "../sim";
import { clippingDay, contested, CONTESTED_MARGIN, weekScores, winStreak, type WeekScore } from "../lib/rival";

function weeks(strat: keyof typeof STRATEGIES, seeds: number): WeekScore[][] {
  const out: WeekScore[][] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const district = ["high_street", "seaside", "student_quarter", "business_park"][seed % 4]!;
    let g: GameState = newGame(content, { type: "NEW_GAME", seed, districtId: district, restaurantName: "X", difficulty: "normal" });
    while (g.day < 365 && g.phase !== "gameover") g = runStrategyDay(content, g, STRATEGIES[strat]);
    out.push(weekScores(g));
  }
  return out;
}
const rate = (ws: WeekScore[][]) => { const all = ws.flat(); return all.filter((w) => w.result === "you").length / all.length; };

describe("Round 14 F — G10 the rival keeps pace", () => {
  it("a good owner wins 55–70 % of weeks (typical, balanced, premium; 8 seeds × a year each)", () => {
    for (const s of ["typical", "balanced", "premium"] as const) {
      const ws = weeks(s, 8);
      const r = rate(ws);
      expect(r, s).toBeGreaterThanOrEqual(0.55);
      expect(r, s).toBeLessThanOrEqual(0.7);
      // Their score moves with hers: it isn't parked at 3.3–3.9 all year.
      const them = ws.flat().map((w) => w.them);
      expect(Math.max(...them), s).toBeGreaterThan(4.1);
      // The clipping is still earnable for a good owner, inside the year.
      expect(ws.filter((x) => clippingDay(x) !== undefined).length, s).toBeGreaterThanOrEqual(6);
    }
  }, 600_000);

  it("a struggling owner isn't crushed: she still wins a fair share of weeks", () => {
    const r = rate(weeks("nohire", 8));
    expect(r).toBeGreaterThanOrEqual(0.2);
    expect(r).toBeLessThan(0.55);
  }, 600_000);

  it("only contested wins count toward the clipping: a walkover or a one-night week neither counts nor breaks the run", () => {
    const w = (start: number, you: number, them: number, nights = 6): WeekScore => ({ start, you, them, nights, result: you - them >= 0.05 ? "you" : Math.abs(you - them) < 0.05 ? "level" : "them" });
    expect(contested(w(0, 4.2, 4.0))).toBe(true);
    expect(contested(w(0, 4.5, 4.5 - CONTESTED_MARGIN - 0.1))).toBe(false);
    expect(contested(w(0, 4.5, 4.0, 2))).toBe(false);
    expect(clippingDay([w(0, 4.2, 4.0), w(7, 4.9, 3.0), w(14, 5, 4.0, 1), w(21, 4.3, 4.1)])).toBeUndefined();
    expect(clippingDay([w(0, 4.2, 4.0), w(7, 4.9, 3.0), w(14, 4.3, 4.1), w(21, 4.4, 4.2)])).toBe(28);
    expect(clippingDay([w(0, 4.2, 4.0), w(7, 4.1, 4.1), w(14, 4.3, 4.1), w(21, 4.4, 4.2)])).toBeUndefined();
    expect(winStreak([w(0, 4.2, 4.0), w(7, 4.9, 3.0), w(14, 4.3, 4.1)])).toBe(2);
  });
});
