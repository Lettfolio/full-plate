import { describe, expect, it } from "vitest";
import {
  applyStarsCommand,
  applyStarsEffects,
  deserializeStars,
  isClosed,
  persistentMultiplier,
  prepareService,
  scandalChance,
  serializeStars,
  starBump,
  stepStarsDay,
  stressTarget,
  withSignatures,
  STARS_CONSTANTS as C,
} from "../src";
import type { StarsCommand, StarsState } from "../src";
import { chef, content, dayResult, eveningState, fresh, run } from "./helpers";

const ctx = (day = 0, cash = 50_000_000) => ({ day, cash });
const cmd = (s: StarsState, c: StarsCommand, day = 0, cash = 50_000_000) => applyStarsCommand(content, s, c, ctx(day, cash));
const withStars = (s: StarsState, n: 0 | 1 | 2 | 3): StarsState => ({ ...s, guides: { ...s.guides, michelin: { ...s.guides.michelin, stars: n } } });

describe("determinism and saves", () => {
  it("same inputs ⇒ byte-identical state; serialize round-trips", () => {
    const a = run(fresh(), 0, 400, (d) => 85 + (d % 7));
    const b = run(fresh(), 0, 400, (d) => 85 + (d % 7));
    expect(serializeStars(a.stars)).toBe(serializeStars(b.stars));
    expect(deserializeStars(serializeStars(a.stars))).toEqual(a.stars);
    expect(() => deserializeStars(JSON.stringify({ ...a.stars, version: 99 }))).toThrow(/version/);
  });
  it("does not mutate its input and is idempotent per day", () => {
    const s = fresh();
    const snap = serializeStars(s);
    const r = stepStarsDay(content, s, dayResult(0), eveningState(0, 90));
    expect(serializeStars(s)).toBe(snap);
    expect(stepStarsDay(content, r.stars, dayResult(0), eveningState(0, 90)).stars).toBe(r.stars);
  });
});

describe("chef stress", () => {
  it("target rises with each star, inspection season and the three-star streak; untrained satellites add more", () => {
    const s = fresh();
    const base = stressTarget(s, 10, true);
    expect(stressTarget(withStars(s, 3), 10, true)).toBe(base + 3 * C.STRESS_PER_STAR);
    expect(stressTarget(s, 250, true)).toBe(base + C.STRESS_SEASON);
    expect(stressTarget(s, 10, false)).toBe(C.STRESS_CLOSED_TARGET);
    const sat = { id: "a", kind: "bar" as const, name: "a", openedDay: 0, headChefTrained: false, staffAbsorbed: 2, earned: 0 };
    expect(stressTarget({ ...s, satellites: [sat] }, 10, true)).toBe(base + C.STRESS_PER_UNTRAINED_SATELLITE);
  });
  it("a three-star kitchen under pressure eventually burns out (deterministic for a seed), disrupting consistency", () => {
    let s = withStars(fresh(), 3);
    s = { ...s, headChef: { ...s.headChef, stress: 99 }, guides: { ...s.guides, michelin: { ...s.guides.michelin, threeStarStreak: 4 } } };
    const r = run(s, 0, 280, 95);
    const burn = r.events.find((e) => e.type === "BURNOUT");
    expect(burn).toBeDefined();
    if (burn?.type !== "BURNOUT") throw new Error();
    expect(r.stars.headChef.burnouts).toBeGreaterThanOrEqual(1);
  });
  it("handing back the stars lifts the stress", () => {
    const s = { ...withStars(fresh(), 3), headChef: { ...fresh().headChef, stress: 90 } };
    const r = cmd(s, { type: "HAND_BACK_STARS" });
    expect(r.stars.headChef.stress).toBe(90 + C.HAND_BACK_STRESS);
    expect(r.stars.guides.michelin.stars).toBe(0);
    expect(r.stars.guides.michelin.excludedUntil).toBeGreaterThan(300);
  });
});

describe("stagiaires", () => {
  it("paid stagiaires cost money every day; unpaid ones carry a scandal risk that grows with the years", () => {
    const s = fresh();
    const paid = cmd(s, { type: "SET_STAGIAIRE_POLICY", paid: true, count: 2 }).stars;
    const r = stepStarsDay(content, paid, dayResult(0), eveningState(0, 90));
    expect(r.stars.ledger.pendingCash).toBe(-2 * C.STAGIAIRE_DAILY_WAGE);
    const unpaid = cmd(s, { type: "SET_STAGIAIRE_POLICY", paid: false, count: 4 }).stars;
    expect(scandalChance(paid, 100)).toBe(0);
    expect(scandalChance(unpaid, 720)).toBeGreaterThan(scandalChance(unpaid, 10));
  });
  it("a scandal eventually lands: prestige, popularity and footfall hit; programme suspended", () => {
    let s = cmd(fresh(), { type: "SET_STAGIAIRE_POLICY", paid: false, count: 6 }).stars;
    s = { ...s, stagiaires: { ...s.stagiaires, sinceDay: -3000 } };
    const r = run(s, 0, 700, 90);
    expect(r.events.some((e) => e.type === "STAGIAIRE_SCANDAL")).toBe(true);
    expect(r.stars.stagiaires.count).toBe(0);
    expect(r.stars.stagiaires.scandals).toBe(1);
  });
});

describe("test kitchen and signatures", () => {
  it("unlock → research → the dish becomes a signature with more appeal, a higher ceiling and more footfall", () => {
    let s = cmd(fresh(), { type: "UNLOCK_TEST_KITCHEN" }).stars;
    expect(cmd(fresh(), { type: "RESEARCH_DISH", dishId: "duck_breast" }).events[0]?.type).toBe("REJECTED");
    s = cmd(s, { type: "RESEARCH_DISH", dishId: "duck_breast" }).stars;
    expect(s.ledger.pendingCash).toBe(-C.TEST_KITCHEN_COST - C.RESEARCH_COST);
    const r = run(s, 0, 60, 90);
    expect(r.events.some((e) => e.type === "RESEARCH_DONE")).toBe(true);
    expect(r.stars.testKitchen.researched).toContain("duck_breast");
    const base = content.dishes.find((d) => d.id === "duck_breast")!;
    const sig = withSignatures(content, r.stars).dishes.find((d) => d.id === "duck_breast")!;
    expect(sig.qualityCeiling).toBe(Math.min(100, base.qualityCeiling + C.SIGNATURE_CEILING_BONUS));
    expect(Object.values(sig.baseAppeal)[0]).toBeGreaterThan(Object.values(base.baseAppeal)[0]!);
    expect(withSignatures(content, r.stars)).toBe(withSignatures(content, r.stars)); // memoised
    const st = { ...eveningState(70, 90), menu: [{ dishId: "duck_breast", price: 1900, active: true, sold7d: 0, margin7d: 0 }] };
    expect(persistentMultiplier(r.stars, 70, st)).toBeCloseTo(1 + C.SIGNATURE_FOOTFALL_EACH, 5);
  });
});

describe("sourcing", () => {
  it("relationships build slowly over open days and are lost quickly while shut for a refit; the seasonal bonus follows", () => {
    const s = cmd(fresh(), { type: "SIGN_SOURCING", supplierId: "foragers" }).stars;
    const open = run(s, 0, 300, 90).stars.sourcing[0]!;
    expect(open.relationship).toBeCloseTo(C.SOURCING_START_RELATIONSHIP + 300 * C.SOURCING_GAIN, 1);
    expect(open.seasonalBonus).toBeGreaterThan(C.SOURCING_SEASONAL_BASE);
    const at80 = { ...s, sourcing: [{ ...s.sourcing[0]!, relationship: 80 }] };
    const shut = run({ ...at80, refitUntil: 90 }, 0, 90, undefined).stars.sourcing[0]!;
    expect(shut.relationship).toBeLessThan(80 - 50);
    // A regular day off (CLOSE_TODAY, no refit) neither builds nor loses the relationship.
    expect(run(at80, 0, 10, undefined).stars.sourcing[0]!.relationship).toBe(80);
    expect(cmd(fresh(), { type: "SIGN_SOURCING", supplierId: "nope" }).events[0]?.type).toBe("REJECTED");
  });
});

describe("satellites and the group cap", () => {
  it("satellites earn (more with stars), absorb staff, never get stars, and cost consistency until a head chef is trained", () => {
    let s = withStars(fresh(), 2);
    const opened = cmd(s, { type: "OPEN_SATELLITE", kind: "bistro" });
    s = opened.stars;
    const sat = s.satellites[0]!;
    expect(sat.staffAbsorbed).toBe(C.SATELLITES.bistro.staff);
    expect(s.ledger.pendingCash).toBe(-Math.round(C.SATELLITES.bistro.cost * (1 - 2 * C.SATELLITE_STAR_DISCOUNT)));
    const day = stepStarsDay(content, { ...s, ledger: { ...s.ledger, pendingCash: 0 } }, dayResult(0), eveningState(0, 90));
    expect(day.stars.ledger.pendingCash).toBe(Math.round(C.SATELLITES.bistro.daily * (1 + 2 * C.SATELLITE_STAR_UPLIFT)));
    const untrained = run(s, 0, 30, 95).stars.lastCriteria!.consistency;
    const trained = cmd(s, { type: "TRAIN_SATELLITE_CHEF", satelliteId: sat.id }).stars;
    const after = run(trained, 0, C.SATELLITE_TRAINING_DAYS + 5, 95);
    expect(after.events.some((e) => e.type === "SATELLITE_CHEF_TRAINED")).toBe(true);
    expect(after.stars.satellites[0]!.headChefTrained).toBe(true);
    expect(after.stars.lastCriteria!.consistency).toBeGreaterThan(untrained);
  });
  it("respects the group size limit", () => {
    let s = fresh();
    for (let i = 0; i < C.MAX_SATELLITES; i++) s = cmd(s, { type: "OPEN_SATELLITE", kind: "bar" }).stars;
    expect(cmd(s, { type: "OPEN_SATELLITE", kind: "bar" }).events[0]?.type).toBe("REJECTED");
  });
});

describe("ticketing", () => {
  it("prepaid seats lift footfall (fewer no-shows) and cash up front buys a supplier discount", () => {
    const s = cmd(fresh(), { type: "UNLOCK_TICKETING" }).stars;
    expect(persistentMultiplier(s, 0)).toBeCloseTo(1 + C.PREPAID_FOOTFALL, 5);
    const r = stepStarsDay(content, { ...s, ledger: { ...s.ledger, pendingCash: 0 } }, dayResult(0), eveningState(0, 90));
    expect(r.stars.ledger.pendingCash).toBe(Math.round(dayResult(0).foodCost * C.PREPAID_SUPPLIER_DISCOUNT));
    const dyn = cmd(s, { type: "SET_TICKETING", prepaid: false, dynamicPricing: true }).stars;
    const r2 = stepStarsDay(content, { ...dyn, ledger: { ...dyn.ledger, pendingCash: 0 } }, dayResult(0), eveningState(0, 90));
    expect(r2.stars.ledger.pendingCash).toBe(Math.round(dayResult(0).revenue * C.DYNAMIC_PRICING_UPLIFT));
  });
});

describe("star bump", () => {
  it("+25% footfall for a first star; losing a star fades the old bump instead of dropping it", () => {
    const s = withStars(fresh(), 1);
    expect(starBump(s, 0)).toBe(C.STAR_FOOTFALL[1]);
    const lost = { ...withStars(s, 0), afterglow: { mult: C.STAR_FOOTFALL[1], day: 100 } };
    expect(starBump(lost, 100)).toBeCloseTo(C.STAR_FOOTFALL[1]);
    expect(starBump(lost, 100 + C.STAR_AFTERGLOW_DAYS / 2)).toBeCloseTo(1 + (C.STAR_FOOTFALL[1] - 1) / 2);
    expect(starBump(lost, 100 + C.STAR_AFTERGLOW_DAYS)).toBe(1);
  });
});

describe("the Smyth arc", () => {
  const veteran = (s: StarsState): StarsState => ({ ...s, headChef: { ...s.headChef, reputation: 90, tenureStart: -2000 } });
  it("a celebrated head chef eventually wants their own place, and leaves for a rival if you don't decide", () => {
    const staff = [chef("c1", 95), chef("c2", 80)];
    const r = run(veteran(fresh(0, staff)), 0, 800, 95, undefined, staff);
    const started = r.events.find((e) => e.type === "SMYTH_ARC_STARTED");
    expect(started).toBeDefined();
    const left = r.events.find((e) => e.type === "HEAD_CHEF_LEFT");
    if (left?.type !== "HEAD_CHEF_LEFT") throw new Error("no departure");
    expect(left.backed).toBe(false);
    expect(r.stars.rival?.name).toBeTruthy();
    expect(r.stars.headChef.staffId).toBe("c2");
    expect(r.stars.headChef.former).toContain("c1");
  });
  it("backing them costs money, opens a friendly satellite and a loyalty bonus; LET_HEAD_CHEF_GO makes a rival", () => {
    const staff = [chef("c1", 95), chef("c2", 80)];
    const base = { ...veteran(fresh(0, staff)), headChef: { ...veteran(fresh(0, staff)).headChef, wantsOwnPlace: true, decisionDeadline: 60 } };
    const st = eveningState(0, 90, undefined, staff);
    const backed = applyStarsCommand(content, base, { type: "BACK_HEAD_CHEF" }, { day: 0, cash: 50_000_000, state: st });
    expect(backed.stars.satellites.some((x) => x.kind === "backed" && x.headChefTrained)).toBe(true);
    expect(backed.stars.loyaltyUntil).toBe(C.LOYALTY_DAYS);
    expect(backed.stars.rival).toBeUndefined();
    expect(backed.stars.headChef.staffId).toBe("c2");
    expect(backed.stars.ledger.pendingCash).toBe(-C.BACK_HEAD_CHEF_COST);
    const gone = applyStarsCommand(content, base, { type: "LET_HEAD_CHEF_GO" }, { day: 0, cash: 0, state: st });
    expect(gone.stars.rival).toBeDefined();
    expect(gone.events.some((e) => e.type === "HEAD_CHEF_LEFT")).toBe(true);
    expect(cmd(fresh(), { type: "BACK_HEAD_CHEF" }).events[0]?.type).toBe("REJECTED");
  });
  it("a rival with stars takes some of your footfall", () => {
    const s = { ...fresh(), rival: { name: "Core", openedDay: 0, strength: 90, stars: 2 as const } };
    expect(persistentMultiplier(s, 0)).toBeCloseTo(1 - 2 * C.RIVAL_FOOTFALL_PER_STAR, 5);
  });
});

describe("refit, relaunch and endings", () => {
  it("a refit closes the restaurant (Fat Duck rule applies on guide day), and prepareService empties the dining room", () => {
    const s = cmd(withStars(fresh(), 3), { type: "CLOSE_FOR_REFIT", days: 250 }).stars;
    expect(isClosed(s, 100)).toBe(true);
    expect(persistentMultiplier(s, 100)).toBe(0);
    const g = eveningState(100, 0);
    expect(prepareService({ ...g, phase: "planning" }, s).footfallMods.at(-1)).toEqual({ mult: 0, daysRemaining: 1 });
    const r = run(s, 0, 301, 95); // the game may feed served days anyway; while refitting the Stars layer treats them as closed
    const guide = r.events.find((e) => e.type === "GUIDE_DAY");
    if (guide?.type !== "GUIDE_DAY") throw new Error();
    expect(guide.result.assessed).toBe(false);
    expect(guide.result.after).toBe(0);
  });
  it("relaunch: closed a month, consistency window reset, personality bonus for a year", () => {
    const s = cmd(withStars(fresh(), 2), { type: "RELAUNCH_CONCEPT" }).stars;
    expect(s.refitUntil).toBe(C.RELAUNCH_CLOSED_DAYS);
    expect(s.relaunchUntil).toBe(C.RELAUNCH_CLOSED_DAYS + C.RELAUNCH_DAYS);
    expect(s.consistencyWindow).toEqual([]);
    expect(cmd(s, { type: "RELAUNCH_CONCEPT" }, 10).events[0]?.type).toBe("REJECTED");
  });
  it("El Bulli: closing at the peak with ≥ 2 stars ends the story (a win only after two guides at ★★★, round 11); hand back + retire is a valid non-winning ending", () => {
    expect(cmd(withStars(fresh(), 1), { type: "CLOSE_AT_PEAK" }).events[0]?.type).toBe("REJECTED");
    const peak = { ...withStars(fresh(), 3), peakStars: 3 as const };
    const r = cmd(peak, { type: "CLOSE_AT_PEAK" });
    expect(r.stars.ending).toMatchObject({ kind: "el_bulli", win: false });
    expect(cmd(r.stars, { type: "UNLOCK_TICKETING" }).events[0]?.type).toBe("REJECTED");
    expect(stepStarsDay(content, r.stars, dayResult(1), eveningState(1, 90)).stars).toBe(r.stars);
    const ret = cmd(peak, { type: "HAND_BACK_STARS", retire: true });
    expect(ret.stars.ending).toMatchObject({ kind: "handed_back", win: false });
  });
  it("win: three stars on five consecutive guide days while solvent", () => {
    let s = withStars(fresh(), 3);
    // A real three-star kitchen: signatures, long-standing partners, a famous chef, and a streak of four.
    const partners = ["hollow_lane", "day_boats", "foragers"].map((id) => ({ supplierId: id, name: id, ingredientIds: C.SUPPLIERS.find((x) => x.id === id)!.ingredientIds, relationship: 100, seasonalBonus: 0.1, signedDay: 0 }));
    s = {
      ...s,
      peakStars: 3,
      sourcing: partners,
      testKitchen: { unlocked: true, researched: ["duck_breast", "scallops_pea", "lamb_shoulder", "pork_ramen"] },
      headChef: { ...s.headChef, reputation: 100 },
      guides: { ...s.guides, michelin: { ...s.guides.michelin, threeStarStreak: 4 } },
    };
    const r = run(s, 0, 301, 97, { duck_breast: 20, scallops_pea: 20, lamb_shoulder: 20, pork_ramen: 20 });
    const guide = r.events.find((e) => e.type === "GUIDE_DAY");
    if (guide?.type !== "GUIDE_DAY") throw new Error();
    expect(guide.result.after).toBe(3);
    expect(r.stars.ending).toMatchObject({ kind: "dynasty", win: true });
    expect(r.events.some((e) => e.type === "ENDING")).toBe(true);
  });
});

describe("effects into GameState", () => {
  it("folds cash, prestige, popularity and footfall into the GameState and empties the ledger", () => {
    const s = fresh();
    const loaded: StarsState = { ...s, ledger: { pendingCash: 12_345, pendingPrestige: 4, pendingPopularity: -2, pendingFootfall: [{ mult: 1.6, days: 14 }], persistentMult: 1.25 } };
    const g = eveningState(10, 90);
    const r = applyStarsEffects(g, loaded);
    expect(r.state.cash).toBe(g.cash + 12_345);
    expect(r.state.reputation.prestige).toBeCloseTo(g.reputation.prestige + 4);
    expect(r.state.reputation.popularity).toBeCloseTo(g.reputation.popularity - 2);
    expect(r.state.footfallMods).toEqual([...g.footfallMods, { mult: 1.25, daysRemaining: 2 }, { mult: 1.6, daysRemaining: 15 }]);
    expect(r.stars.ledger).toMatchObject({ pendingCash: 0, pendingPrestige: 0, pendingFootfall: [], persistentMult: 1.25 });
  });
  it("prestige is pulled toward the tracks' target each day", () => {
    const s = withStars(fresh(), 3);
    const r = stepStarsDay(content, s, dayResult(0), { ...eveningState(0, 90), reputation: { popularity: 50, prestige: 30 } });
    expect(r.stars.ledger.pendingPrestige).toBeGreaterThan(0);
  });
  it("the head chef is the best chef; a much better chef is promoted without disruption; a departure disrupts", () => {
    const s = fresh(0, [chef("a", 60)]);
    const promoted = stepStarsDay(content, s, dayResult(0), eveningState(0, 90, undefined, [chef("a", 60), chef("b", 90)]));
    expect(promoted.stars.headChef.staffId).toBe("b");
    expect(promoted.stars.headChef.disruptedUntil).toBeUndefined();
    const left = stepStarsDay(content, promoted.stars, dayResult(1), eveningState(1, 90, undefined, [chef("a", 60)]));
    expect(left.stars.headChef.staffId).toBe("a");
    expect(left.stars.headChef.disruptedUntil).toBe(1 + C.DISRUPTION_DAYS);
  });
});
