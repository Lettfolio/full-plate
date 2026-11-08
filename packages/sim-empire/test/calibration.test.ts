/**
 * The two-level model's promise: a site promoted to (or demoted from) focused keeps its numbers.
 * Plays a real sim-core restaurant day by day with runDay on the shipped content pack, calibrates the
 * aggregate model on it, and checks the aggregate's covers and revenue over the same days.
 */
import { describe, expect, it } from "vitest";
import { applyCommand, candidates, newGame, runDay, suggestedOrder, weekdayOf, type DayResult, type GameState } from "@full-plate/sim-core";
import { aggregateSiteDay, calibrate, forkFromGameState, recalibrateFromSite, stepEmpireDay, newEmpire, siteDayFromResult, expectedSiteDay } from "../src/index";
import { Rng } from "../src/rng";
import { FAST_FOOD_MENU } from "../src/headless";
import { content, must } from "./helpers";

/** A minimal scripted owner on sim-core's public API: fast-food menu, one chef and one server, nightly restock. */
function playWithRunDay(seed: number, districtId: string, days: number): GameState {
  const step = (s: GameState, cmd: Parameters<typeof applyCommand>[2]) => applyCommand(content, s, cmd).state;
  let s = newGame(content, { type: "NEW_GAME", seed, districtId, restaurantName: "Flagship", difficulty: "normal" });
  for (const id of FAST_FOOD_MENU) {
    const dish = content.dishes.find((d) => d.id === id)!;
    s = step(s, { type: "ADD_MENU_ITEM", dishId: id, price: dish.suggestedPrice });
  }
  for (const role of ["chef", "server"] as const) {
    const i = candidates(content, s).findIndex((c) => c.role === role);
    if (i >= 0) s = step(s, { type: "HIRE", candidateIndex: i });
  }
  while (s.day < days && s.phase !== "gameover") {
    s = runDay(content, s).state;
    if (s.phase === "evening") {
      for (const o of suggestedOrder(content, s)) s = step(s, { type: "ORDER_STOCK", ingredientId: o.ingredientId, qty: o.qty });
      s = step(s, { type: "END_DAY" });
    } else if (s.phase === "event") {
      const ev = content.events.find((e) => e.id === s.activeEvent?.eventId)!;
      s = step(s, { type: "RESOLVE_EVENT", choiceId: ev.choices.at(-1)!.id });
    }
  }
  return s;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("calibrate", () => {
  for (const [seed, districtId] of [
    [11, "high_street"],
    [12, "student_quarter"],
  ] as const) {
    it(`aggregate covers and revenue stay within 10% of the focused sim over 60 days (${districtId})`, () => {
      const g = playWithRunDay(seed, districtId, 60);
      const history = g.history;
      expect(history.length).toBe(60);
      const cal = calibrate(content, history, { districtId });
      // The empire's flagship sits exactly at the reference state; replay the same 60 days with the model.
      const e = newEmpire(content, { seed, brandName: "Cal", flagship: { name: "Flagship", districtId }, hqCash: 1e9, menuDishIds: FAST_FOOD_MENU, calibration: cal, day: 0 });
      const site = e.sites[0]!;
      const city = e.cities.find((c) => c.id === site.cityId)!;
      const rng = new Rng([seed, 2, 3, 4]);
      const agg = history.map((h) => aggregateSiteDay(content, site, e.brand, city, rng, { day: h.day, calibration: cal }));
      const focusedCovers = mean(history.map((h) => h.covers));
      const focusedRevenue = mean(history.map((h) => h.revenue));
      const aggCovers = mean(agg.map((r) => r.covers));
      const aggRevenue = mean(agg.map((r) => r.revenue));
      if (process.env.EMPIRE_VERBOSE) console.log(`${districtId}: covers focused ${focusedCovers.toFixed(1)} vs aggregate ${aggCovers.toFixed(1)}; revenue ${focusedRevenue.toFixed(0)} vs ${aggRevenue.toFixed(0)}`);
      expect(Math.abs(aggCovers / focusedCovers - 1)).toBeLessThan(0.1);
      expect(Math.abs(aggRevenue / focusedRevenue - 1)).toBeLessThan(0.1);
      // The weekly rhythm carries over: noise-free expected covers per weekday within 15% of the focused means.
      for (let wd = 0; wd < 7; wd++) {
        const days = history.filter((h) => weekdayOf(h.day) === wd && h.covers > 0);
        const f = mean(days.map((h) => h.covers));
        const a = mean(days.map((h) => aggregateSiteDay(content, site, e.brand, city, rng, { day: h.day, calibration: cal, noise: false }).covers));
        expect(Math.abs(a / f - 1)).toBeLessThan(0.15);
      }
      // stepEmpireDay drives the same model: 60 days of the empire land within 10% too.
      let cur = { ...e, hq: { ...e.hq, day: 0 } };
      for (let d = 0; d < 60; d++) cur = stepEmpireDay(content, cur, undefined, { noEvents: true }).empire;
      expect(Math.abs(cur.sites[0]!.mealsServed / 60 / focusedCovers - 1)).toBeLessThan(0.1);
      // Costs line up too (food, labour) so margins carry over.
      const sum = (f: (x: { foodCost: number; labourCost: number; revenue: number }) => number, xs: { foodCost: number; labourCost: number; revenue: number }[]) => xs.reduce((t, x) => t + f(x), 0);
      const focusedFood = history.reduce((t, h) => t + h.foodCost + h.waste.prep + h.waste.spoil, 0) / sum((x) => x.revenue, history);
      expect(Math.abs(sum((x) => x.foodCost, agg) / sum((x) => x.revenue, agg) - focusedFood)).toBeLessThan(0.03);
      expect(Math.abs(sum((x) => x.labourCost, agg) / sum((x) => x.labourCost, history) - 1)).toBeLessThan(0.1);
    });
  }

  it("fits weekend uplift, spend and costs from the history", () => {
    const g = playWithRunDay(13, "high_street", 60);
    const cal = calibrate(content, g.history, { districtId: "high_street" });
    expect(cal.weekendMult).toBeGreaterThan(1);
    expect(cal.spendPerCover).toBeGreaterThan(800);
    expect(cal.vatPct).toBeCloseTo(1 / 6, 2);
    expect(cal.cardFeePct).toBeGreaterThan(0.005);
    expect(cal.cardFeePct).toBeLessThan(0.03);
    expect(cal.days).toBe(g.history.filter((h) => h.covers > 0).length);
  });

  it("refuses too little history", () => {
    const g = playWithRunDay(14, "high_street", 5);
    expect(() => calibrate(content, g.history)).toThrow(/at least/);
  });

  it("the focused site uses the real DayResult, not the model", () => {
    const g = playWithRunDay(15, "high_street", 30);
    let e = forkFromGameState(content, g, { brandName: "Fork", calibrationDays: 30 });
    expect(e.sites[0]!.focused).toBe(true);
    const day = g.history.at(-1)!;
    const fake: DayResult = { ...day, day: e.hq.day, covers: 123 };
    e = stepEmpireDay(content, e, fake, { noEvents: true }).empire;
    expect(e.sites[0]!.mealsServed).toBe(123);
    expect(siteDayFromResult("s1", fake).covers).toBe(123);
  });

  it("recalibrating on a site elsewhere keeps that site's numbers", () => {
    const g = playWithRunDay(16, "student_quarter", 60);
    let e = newEmpire(content, { seed: 16, brandName: "Re", flagship: { name: "Flagship", districtId: "high_street" }, hqCash: 1e9, menuDishIds: FAST_FOOD_MENU, day: 60 });
    e = must(e, { type: "ENTER_CITY", cityId: "kingsbridge" });
    e = must(e, { type: "OPEN_SITE", cityId: "kingsbridge", districtId: "student_quarter", ownership: "company", land: "hqLease" });
    const id = e.sites[1]!.id;
    e = { ...e, sites: e.sites.map((s) => (s.id === id ? { ...s, status: "open" as const, brandConsistency: 50, staffQuality: 50, footfallMods: [] } : s)) };
    e = recalibrateFromSite(content, e, id, g.history);
    const raw = calibrate(content, g.history, { districtId: "student_quarter" });
    const exp = expectedSiteDay(content, e, id);
    // Expected covers (no noise) for this day match the raw fit's shape at this site within a few percent.
    const season = content.districts.find((d) => d.id === "student_quarter")!.seasonCurve[(Math.floor(60 / 30) + 3) % 12]!;
    const rawExpected = raw.baseCovers * season * raw.weekdayProfile[weekdayOf(60)]!;
    expect(Math.abs(exp.covers / rawExpected - 1)).toBeLessThan(0.05);
    expect(Math.abs(exp.revenue / exp.covers / raw.spendPerCover - 1)).toBeLessThan(0.05);
  });
});
