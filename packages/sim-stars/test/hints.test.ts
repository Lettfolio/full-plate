/**
 * Round 3 review P2: "the Stars tab doesn't say which criterion is holding the player back". starsHints ranks the
 * five criteria on the player's own recent data and words them; it must never read the inspectors' secrets.
 */
import { describe, expect, it } from "vitest";
import { weekdayOf, type DayResult, type GameState } from "@full-plate/sim-core";
import { closedDay, CRITERION_LABEL, starsHints, type StarsState } from "../src";
import { chef, content, eveningState, fresh, run } from "./helpers";

/** A planning-time GameState whose last 7 open nights sold `dishes` at the given plate quality. */
function withWeek(day: number, dishes: Record<string, { sold: number; q: number }>): GameState {
  const base = eveningState(day, 80);
  const history: DayResult[] = Array.from({ length: 7 }, (_, i) => ({
    ...closedDay(day - 7 + i),
    covers: 50,
    perDish: Object.fromEntries(Object.entries(dishes).map(([id, d]) => [id, { sold: d.sold, plated: d.sold, qualityMean: d.q, revenue: 0, foodCost: 0 }])),
  }));
  const menu = Object.keys(dishes).map((dishId) => ({ dishId, price: 2000, active: true, sold7d: dishes[dishId]!.sold * 7, margin7d: 0 }));
  return { ...base, phase: "planning", history, menu };
}

const BISTRO = { fish_and_chips: { sold: 30, q: 92 }, flat_white: { sold: 20, q: 90 } };
const AMBITIOUS = { duck_breast: { sold: 15, q: 93 }, lamb_shoulder: { sold: 15, q: 92 }, scallops_pea: { sold: 12, q: 94 } };

describe("starsHints", () => {
  it("ranks all five criteria and words each; a steady simple bistro is told about signatures, sourcing and technique", () => {
    const steady = run(fresh(365), 365, 60, 92).stars;
    const hints = starsHints(content, steady, withWeek(425, BISTRO));
    expect(hints.map((h) => h.criterion).sort()).toEqual(Object.keys(CRITERION_LABEL).sort());
    expect(hints.every((h) => h.text.length > 20 && h.label === CRITERION_LABEL[h.criterion])).toBe(true);
    // No signatures and no partners: personality and ingredients sit furthest below the bar (the review's 48 / 54).
    expect(hints.slice(0, 2).map((h) => h.criterion)).toEqual(["personality", "ingredients"]);
    expect(hints[0]!.text).toBe("Your only dish isn't your own. Inspectors want signatures: build the test kitchen and develop one.");
    const tech = hints.find((h) => h.criterion === "technique")!;
    expect(tech.behind).toBe(true);
    expect(tech.text).toMatch(/easy ones \(a cook needs only about 35 skill for them\), and Fish & chips with mushy peas is the simplest/);
    expect(hints.find((h) => h.criterion === "consistency")!.behind).toBe(false);
    // An ambitious menu: technique is not behind, and its line is about execution, not ambition.
    const fine = starsHints(content, steady, withWeek(425, AMBITIOUS)).find((h) => h.criterion === "technique")!;
    expect(fine.behind).toBe(false);
    expect(fine.text).toMatch(/ambitious enough/);
  });

  it("a two-speed kitchen: consistency leads and names the weakest night", () => {
    const twoSpeed = (d: number) => (weekdayOf(d) === 1 ? 40 : 92);
    const s = run(fresh(365), 365, 60, twoSpeed, undefined, [chef("Ana Lopez", 90)]).stars;
    const hints = starsHints(content, s, { ...withWeek(425, AMBITIOUS), staff: [{ ...chef("Ana Lopez", 90), rota: [true, false, true, true, true, true, true] }] });
    const c = hints.find((h) => h.criterion === "consistency")!;
    expect(hints.slice(0, 2)).toContain(c);
    expect(c.behind).toBe(true);
    expect(c.text).toMatch(/^Your weakest night is Tuesday: it cooks about 40 against 92/);
    expect(c.text).toMatch(/no chef on/);
  });

  it("never reads the hidden state (visits, schedule, assessment, lastCriteria)", () => {
    const s = run(fresh(365), 365, 60, 90).stars;
    const g = withWeek(425, AMBITIOUS);
    const secret: StarsState = {
      ...s,
      guides: { ...s.guides, michelin: { ...s.guides.michelin, scheduled: [430, 431], inspectorVisits: [{ day: 400, inspector: "Inspector A.", scores: { ingredients: 1, harmony: 1, technique: 1, personality: 1, consistency: 1 }, total: 1, revealed: false }] } },
      assessment: { ...s.assessment, qSum: 1, openDays: 999 },
      lastCriteria: { ingredients: 0, harmony: 0, technique: 0, personality: 0, consistency: 0 },
      dailyScoreEma: 3,
    };
    expect(starsHints(content, secret, g)).toEqual(starsHints(content, s, g));
    // Words only: no criterion scores or star thresholds leak out.
    for (const h of starsHints(content, s, g)) expect(Object.keys(h).sort()).toEqual(["behind", "criterion", "label", "text"]);
  });

  it("falls back to the menu's 7-day sales on saves without per-dish history", () => {
    const s = run(fresh(365), 365, 30, 90).stars;
    const g = withWeek(395, AMBITIOUS);
    const old = { ...g, history: g.history.map(({ perDish: _p, ...h }) => h) };
    const hints = starsHints(content, s, old);
    expect(hints).toHaveLength(5);
    expect(hints.find((h) => h.criterion === "harmony")!.text).toMatch(/about 90/);
  });
});
