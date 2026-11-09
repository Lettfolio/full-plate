/**
 * The two-level model's promise (round 3, REVIEW P1): a modelled site produces what the focused sim produces for the
 * same inputs. Plays a real sim-core flagship with runDay on the shipped content pack, forks, then compares modelled
 * sites against GameStates built by newGameFromSite for the same site (district, brand menu, box, local crew), each
 * played for 90 days by a simple operator (nightly restock, incidents answered, events resolved).
 */
import { describe, expect, it } from "vitest";
import { candidates, newGame, runDay, runStrategyDay, suggestedOrder, weekdayOf, type DayResult, type GameState } from "@full-plate/sim-core";
import { playService, resolveEvent, restock, STRATEGIES, stepper } from "../../sim-core/src/strategies";
import {
  aggregateSiteDay, applyEmpireCommand, calibrate, expectedSiteDay, forkFromGameState, newGameFromSite, offPremise, recalibrateFromSite,
  siteDayFromResult, siteDemandAndCapacity, stepEmpireDay, EMPIRE, type EmpireState, type SiteSummary,
} from "../src/index";
import { Rng } from "../src/rng";
import { FAST_FOOD_MENU } from "../src/headless";
import { content } from "./helpers";

const step = stepper(content);
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A minimal scripted owner on sim-core's public API: fast-food menu, one chef and one server, nightly restock. */
function playWithRunDay(seed: number, districtId: string, days: number): GameState {
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

/** A steady operator: plays each service (answering incidents), restocks each night, resolves events. */
function operate(start: GameState, days: number): DayResult[] {
  return operateState(start, days).history;
}

function operateState(start: GameState, days: number): { state: GameState; history: DayResult[] } {
  let s = start;
  const out: DayResult[] = [];
  const end = s.day + days;
  while (s.day < end && s.phase !== "gameover") {
    s = playService(content, s, true);
    if (s.phase === "evening" || s.phase === "event") s = restock(content, s, STRATEGIES.balanced, step);
    out.push(s.history.at(-1)!);
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") s = resolveEvent(content, s, step);
  }
  return { state: s, history: out };
}

/** Adds an open, modelled site to the empire (the state a site reaches after building). */
function withSite(e: EmpireState, districtId: string, over: Partial<SiteSummary>): { e: EmpireState; site: SiteSummary } {
  const site: SiteSummary = {
    ...e.sites[0]!, id: "s9", name: `Test ${districtId}`, districtId, focused: false, opened: e.hq.day - 200, lastRemodel: e.hq.day - 200, footfallMods: [], ...over,
  };
  delete site.tables;
  delete site.popularity;
  delete site.prestige;
  return { e: { ...e, sites: [...e.sites, site] }, site };
}

function modelDays(e: EmpireState, site: SiteSummary, days: number, seed: number) {
  const city = e.cities.find((c) => c.id === site.cityId)!;
  const rng = new Rng([seed, 9, 9, 9]);
  return Array.from({ length: days }, (_, d) => aggregateSiteDay(content, site, e.brand, city, rng, { day: e.hq.day + d, calibration: e.calibration }));
}

// One flagship for the whole file: a year of the balanced owner on a fast-food menu (the review's fork setup).
const flagship = (() => {
  let g = newGame(content, { type: "NEW_GAME", seed: 2026, districtId: "high_street", restaurantName: "Rosie's", difficulty: "normal" });
  for (const id of FAST_FOOD_MENU) g = step(g, { type: "ADD_MENU_ITEM", dishId: id, price: content.dishes.find((d) => d.id === id)!.suggestedPrice });
  return g;
})();
let forked: { g: GameState; e: EmpireState } | undefined;
function fork() {
  if (!forked) {
    let g = flagship;
    while (g.day < 300 && g.phase !== "gameover") g = runStrategyDay(content, g, STRATEGIES.balanced);
    forked = { g, e: forkFromGameState(content, g, { brandName: "Rosie's Burgers" }) };
  }
  return forked;
}

const locked = (e: EmpireState) => applyEmpireCommand(content, e, { type: "SET_FORMULA", locked: true }).empire;
const withRecognition = (e: EmpireState, rec: number): EmpireState => ({ ...e, brand: { ...e.brand, recognition: { ...e.brand.recognition, isles: rec } } });

describe("aggregate vs focused (round 3 P1)", () => {
  const cases: [string, string, (e: EmpireState) => EmpireState, Partial<SiteSummary>][] = [
    // The review's Campus case: locked formula, home recognition 33, a franchise crew at 40, student quarter.
    ["review campus", "student_quarter", (e) => withRecognition(locked(e), 33), { staffQuality: 40, brandConsistency: 60 }],
    ["reference", "business_park", (e) => e, { staffQuality: 50, brandConsistency: 50 }],
    ["academy crew", "seaside", (e) => {
      const l = locked(e);
      return { ...l, brand: { ...l.brand, formula: { ...l.brand.formula, academy: true, standardisation: 70 } } };
    }, { staffQuality: 65, brandConsistency: 80 }],
  ];
  for (const [name, districtId, mod, over] of cases) {
    it(`a modelled site's dining room is within 15% of the same site run hands-on for 90 days (${name}, ${districtId})`, () => {
      const { e: base } = fork();
      const { e, site } = withSite(mod(base), districtId, over);
      const focused = operate(newGameFromSite(content, e, site, new Rng([11, 22, 33, 44])), 90);
      expect(focused.length).toBe(90);
      const model = modelDays(e, site, 90, 5);
      const off = offPremise(site, e.brand);
      // The model's covers include the takeaway counter / drive-thru / app on top of the dining room; the focused sim
      // is the dining room, and stepEmpireDay adds the same multiplier to a focused DayResult.
      const fc = mean(focused.map((h) => h.covers));
      const mc = mean(model.map((r) => r.covers)) / off;
      const fr = mean(focused.map((h) => h.revenue));
      const mr = mean(model.map((r) => r.revenue)) / off;
      if (process.env.EMPIRE_VERBOSE) console.log(`${name}: covers focused ${fc.toFixed(1)} model ${mc.toFixed(1)}; revenue ${(fr / 100).toFixed(0)} vs ${(mr / 100).toFixed(0)}`);
      expect(Math.abs(mc / fc - 1)).toBeLessThan(0.15);
      expect(Math.abs(mr / fr - 1)).toBeLessThan(0.15);
      // Labour comes from the same crew on both sides.
      const fl = mean(focused.map((h) => h.labourCost));
      const ml = mean(model.map((r) => r.labourCost)) / off ** EMPIRE.OFF_PREMISE_LABOUR_EXP;
      expect(Math.abs(ml / fl - 1)).toBeLessThan(0.15);
    });
  }

  it("the flagship keeps its numbers when demoted: model within 10% of the next 90 days played", () => {
    const { g, e } = fork();
    const next = operate(g, 90);
    const demoted = { ...e, sites: e.sites.map((s) => ({ ...s, focused: false })) };
    const model = modelDays(demoted, demoted.sites[0]!, 90, 3);
    expect(Math.abs(mean(model.map((r) => r.covers)) / mean(next.map((h) => h.covers)) - 1)).toBeLessThan(0.1);
    expect(Math.abs(mean(model.map((r) => r.revenue)) / mean(next.map((h) => h.revenue)) - 1)).toBeLessThan(0.1);
  });

  it("before the fix a modelled campus site was 1.2–2.5× the flagship; now its dining room is the flagship's size", () => {
    const { g, e } = fork();
    const { e: e2, site } = withSite(withRecognition(locked(e), 33), "student_quarter", { staffQuality: 40 });
    const city = e2.cities.find((c) => c.id === site.cityId)!;
    const room = siteDemandAndCapacity(content, site, e2.brand, city, { day: e2.hq.day, calibration: e2.calibration });
    const flagshipCovers = mean(g.history.slice(-90).map((h) => h.covers));
    // Footfall 112 vs 74 no longer means 1.5× the covers: the room and crew cap it.
    expect(room.seated / flagshipCovers).toBeLessThan(1.25);
    expect(room.demand).toBeGreaterThan(room.seated);
  });
});

describe("calibrate", () => {
  it("fits spend, costs and noise from the history and leaves out days the owner covered (round 3 P2)", () => {
    const g = playWithRunDay(13, "high_street", 90);
    const cal = calibrate(content, g.history, { districtId: "high_street", state: g });
    const trading = g.history.filter((h) => h.covers > 0 && !h.closed);
    const staffed = trading.filter((h) => !h.ownerCovered?.length);
    expect(trading.length).toBeGreaterThan(staffed.length); // one chef + one server: the owner covers their days off
    expect(cal.days).toBe(staffed.length >= 14 ? staffed.length : trading.length);
    expect(cal.spendPerCover).toBeGreaterThan(800);
    expect(cal.vatPct).toBeCloseTo(1 / 6, 2);
    expect(cal.cardFeePct).toBeGreaterThan(0.005);
    expect(cal.cardFeePct).toBeLessThan(0.03);
    expect(cal.demandScale!).toBeGreaterThan(0.6);
    expect(cal.demandScale!).toBeLessThan(1.6);
    expect(cal.spendScale!).toBeGreaterThan(0.7);
    expect(cal.spendScale!).toBeLessThan(1.3);
    // The fitted model reproduces the staffed days' mean covers (means stay exact up to the shrinkage).
    expect(Math.abs(cal.baseCovers / cal.coversMean - 1)).toBeLessThan(0.08);
  });

  it("every modelled site gets the standard crew: no owner's slow Monday copied onto the chain (round 3 P2)", () => {
    const { e } = fork();
    const { e: e2, site } = withSite(e, "high_street", { staffQuality: 50 });
    const city = e2.cities.find((c) => c.id === site.cityId)!;
    const at = (day: number) => siteDemandAndCapacity(content, site, e2.brand, city, { day, calibration: e2.calibration }).seated;
    // Find a Monday and the Wednesday after it in the same month: both have one crew pair and weekday footfall.
    let mon = e2.hq.day;
    while (weekdayOf(mon) !== 0 || Math.floor((mon + 2) / 30) !== Math.floor(mon / 30)) mon++;
    expect(Math.abs(at(mon + 2) / at(mon) - 1)).toBeLessThan(0.01);
    // The weekend has the second pair on and weekend footfall.
    expect(at(mon + 5)).toBeGreaterThan(at(mon) * 1.1);
  });

  it("refuses too little history", () => {
    const g = playWithRunDay(14, "high_street", 5);
    expect(() => calibrate(content, g.history)).toThrow(/at least/);
  });

  it("the focused site uses the real DayResult, not the model (plus its off-premise lanes)", () => {
    const g = playWithRunDay(15, "high_street", 30);
    let e = forkFromGameState(content, g, { brandName: "Fork", calibrationDays: 30 });
    expect(e.sites[0]!.focused).toBe(true);
    const day = g.history.at(-1)!;
    const fake: DayResult = { ...day, day: e.hq.day, covers: 123 };
    const once = stepEmpireDay(content, e, fake, { noEvents: true }).empire;
    expect(once.sites[0]!.mealsServed).toBe(123);
    expect(siteDayFromResult("s1", fake).covers).toBe(123);
    // With a locked formula the takeaway counter adds its share on top of the hands-on dining room.
    e = locked(e);
    const off = offPremise(e.sites[0]!, e.brand);
    expect(off).toBeGreaterThan(1.3);
    expect(stepEmpireDay(content, e, fake, { noEvents: true }).empire.sites[0]!.mealsServed).toBe(Math.round(123 * off));
  });

  it("recalibrating on a promoted site keeps that site's numbers", () => {
    const { e: base } = fork();
    const { e: e1, site } = withSite(base, "student_quarter", { staffQuality: 55, brandConsistency: 55 });
    let e = applyEmpireCommand(content, e1, { type: "FOCUS_SITE", siteId: site.id }).empire;
    const run = operateState(newGameFromSite(content, e, site, new Rng([5, 6, 7, 8])), 60);
    const played = run.history;
    e = { ...e, hq: { ...e.hq, day: e.hq.day + 60 } };
    const re = recalibrateFromSite(content, e, site.id, played, run.state);
    const demoted = { ...re, sites: re.sites.map((s) => ({ ...s, focused: false })) };
    const s9 = demoted.sites.find((s) => s.id === site.id)!;
    const model = modelDays({ ...demoted, hq: { ...demoted.hq, day: e.hq.day - 60 } }, s9, 60, 4);
    expect(Math.abs(mean(model.map((r) => r.covers)) / mean(played.map((h) => h.covers)) - 1)).toBeLessThan(0.1);
    expect(Math.abs(mean(model.map((r) => r.revenue)) / mean(played.map((h) => h.revenue)) - 1)).toBeLessThan(0.1);
    expect(expectedSiteDay(content, demoted, site.id).covers).toBeGreaterThan(0);
  });
});
