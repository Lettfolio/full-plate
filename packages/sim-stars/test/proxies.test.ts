import { describe, expect, it } from "vitest";
import { consistencyModifier, dayCriteria, dayInputs, produceShares, windowConsistency, STARS_CONSTANTS as C } from "../src";
import { content, dayResult, eveningState, fresh } from "./helpers";

describe("proxies", () => {
  it("dayInputs reads exact per-dish quality from the evening service tally and ignores drinks", () => {
    const st = eveningState(10, 90, { duck_breast: 10, house_wine: 30 });
    const inp = dayInputs(content, dayResult(10), st);
    expect(inp.dishes.map((d) => d.dishId)).toEqual(["duck_breast"]);
    expect(inp.quality).toBe(90);
  });
  it("falls back to review quality when the tally is gone (day mismatch)", () => {
    const st = { ...eveningState(10, 90), day: 11, menu: [{ dishId: "duck_breast", price: 1900, active: true, sold7d: 5, margin7d: 0, recent: [{ sold: 5, margin: 0 }] }] };
    const r = { ...dayResult(10), reviews: [{ day: 10, source: "online" as const, rating: 5, text: "", quality: 70 }] };
    expect(dayInputs(content, r, st).quality).toBe(70);
  });
  it("a closed day has no inputs", () => {
    expect(dayInputs(content, { ...dayResult(3), covers: 0 }).open).toBe(false);
  });
  it("technique rewards ambition: same quality, harder dishes ⇒ higher technique", () => {
    const s = fresh();
    const easy = dayInputs(content, dayResult(5), eveningState(5, 85, { jacket_potato: 30 }));
    const hard = dayInputs(content, dayResult(5), eveningState(5, 85, { duck_breast: 30 }));
    expect(dayCriteria(content, s, hard, [85]).technique).toBeGreaterThan(dayCriteria(content, s, easy, [85]).technique + 20);
  });
  it("personality rises with the signature share", () => {
    const s = fresh();
    const inp = dayInputs(content, dayResult(5), eveningState(5, 85, { duck_breast: 30 }));
    const sig = { ...s, testKitchen: { unlocked: true, researched: ["duck_breast"] } };
    expect(dayCriteria(content, sig, inp, [85]).personality - dayCriteria(content, s, inp, [85]).personality).toBeCloseTo(C.PERSONALITY_SIGNATURE_WEIGHT, 1);
  });
  it("ingredients rise with season and with partner suppliers", () => {
    const s = fresh();
    // asparagus is in season in months 4-6 (day 0 = April); out of season in month 10 (day 180)
    const inSeason = dayInputs(content, dayResult(5), eveningState(5, 85, { asparagus_hollandaise: 30 }));
    const outSeason = dayInputs(content, dayResult(185), eveningState(185, 85, { asparagus_hollandaise: 30 }));
    expect(produceShares(content, s, inSeason).season).toBeGreaterThan(produceShares(content, s, outSeason).season);
    const partner = { ...s, sourcing: [{ supplierId: "foragers", name: "F", ingredientIds: ["asparagus"], relationship: 100, seasonalBonus: 0.1, signedDay: 0 }] };
    expect(dayCriteria(content, partner, inSeason, [85]).ingredients).toBeGreaterThan(dayCriteria(content, s, inSeason, [85]).ingredients + 5);
  });
  it("window consistency: steady high quality scores high, wobbly or mediocre scores low, short windows shrink to the prior", () => {
    expect(windowConsistency(Array(60).fill(95))).toBe(100);
    expect(windowConsistency(Array.from({ length: 60 }, (_, i) => (i % 2 ? 95 : 70)))).toBeLessThan(60);
    expect(windowConsistency(Array(60).fill(60))).toBeLessThan(90);
    expect(windowConsistency([95])).toBeCloseTo(C.CONSISTENCY_PRIOR + (100 - C.CONSISTENCY_PRIOR) / C.CONSISTENCY_MIN_DAYS, 1);
  });
  it("group cap: each satellite without a trained head chef costs consistency; stagiaires add a little", () => {
    const s = fresh();
    const sat = (trained: boolean) => ({ id: "x", kind: "bar" as const, name: "b", openedDay: 0, headChefTrained: trained, staffAbsorbed: 2, earned: 0 });
    expect(consistencyModifier({ ...s, satellites: [sat(false), sat(false)] }, 0)).toBe(-2 * C.GROUP_CAP_PENALTY);
    expect(consistencyModifier({ ...s, satellites: [sat(true)] }, 0)).toBe(0);
    expect(consistencyModifier({ ...s, stagiaires: { ...s.stagiaires, count: 3 } }, 0)).toBe(3 * C.STAGIAIRE_CONSISTENCY);
    expect(consistencyModifier({ ...s, headChef: { ...s.headChef, stress: 90 } }, 0)).toBeCloseTo(-20 * C.STRESS_CONSISTENCY_WEIGHT);
  });
});
