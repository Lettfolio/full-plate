/**
 * [round 3] The closed-form demand and capacity (src/capacity.ts) against the sim itself on the real content pack:
 * sim-empire's aggregate model leans on these, so when the physics change these tests say the constants need a refit.
 */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { capacityCovers, expectedDemand, marketDemand, serviceCapacity, softCap, uncapped } from "../src/capacity";
import { newGame } from "../src/newGame";
import { playService, resolveEvent, restock, STRATEGIES, stepper } from "../src/strategies";
import type { GameState, Staff } from "../src/types";

const step = stepper(content);
const MENU = ["beef_burger", "chicken_burger", "halloumi_burger", "chunky_chips", "onion_rings", "milkshake", "soft_drink", "sundae"];
const A = [false, false, true, true, true, true, true];
const B = [true, true, false, false, true, true, true];

function room(districtId: string, tables: number, skill: number, footfall: number): GameState {
  let s = newGame(content, { type: "NEW_GAME", seed: 5, districtId, restaurantName: "Cap", difficulty: "normal" });
  for (const id of MENU) s = step(s, { type: "ADD_MENU_ITEM", dishId: id, price: content.dishes.find((d) => d.id === id)!.suggestedPrice });
  const mk = (role: "chef" | "server", i: number, rota: boolean[]): Staff => ({
    id: `${role}${i}`, name: role, role, skill, speed: 60, charm: 55, wage: 1400, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: skill, rota,
  });
  return {
    ...s,
    cash: 5_000_000,
    staff: [mk("chef", 0, A), mk("chef", 1, B), mk("server", 0, A), mk("server", 1, B)],
    reputation: { popularity: 85, prestige: 30 },
    tables: Array.from({ length: tables }, (_, i) => ({ id: `T${i + 1}`, seats: 4, dirtyTicks: 0 })),
    footfallMods: footfall === 1 ? [] : [{ mult: footfall, daysRemaining: 9_999 }],
  };
}

/** Plays `days` services; returns mean covers after a week's warm-up, and the closed form's mean prediction. */
function compare(start: GameState, days: number) {
  let s = start;
  const sim: number[] = [];
  const model: number[] = [];
  for (let d = 0; d < days && s.phase !== "gameover"; d++) {
    const pre = s;
    s = playService(content, s, true);
    if (s.phase === "evening" || s.phase === "event") s = restock(content, s, STRATEGIES.balanced, step);
    if (d >= 7) {
      sim.push(s.history.at(-1)!.covers);
      model.push(softCap(expectedDemand(content, pre).covers, serviceCapacity(content, pre)));
    }
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") s = resolveEvent(content, s, step);
    // Keep the crew fresh so the comparison is about physics, not mood.
    s = { ...s, staff: s.staff.map((x) => ({ ...x, fatigue: 0, mood: 70 })) };
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { sim: mean(sim), model: mean(model) };
}

describe("closed-form capacity", () => {
  it("saturated covers match the sim within 12% (6 and 10 tables, two districts)", () => {
    for (const [districtId, tables] of [["high_street", 6], ["student_quarter", 10]] as const) {
      const r = compare(room(districtId, tables, 50, 8), 35);
      expect(Math.abs(r.model / r.sim - 1)).toBeLessThan(0.12);
    }
  });

  it("covers at ordinary footfall match the sim within 12%", () => {
    for (const districtId of ["high_street", "seaside", "business_park"]) {
      const r = compare(room(districtId, 6, 50, 1), 35);
      expect(Math.abs(r.model / r.sim - 1)).toBeLessThan(0.12);
    }
  });

  it("more tables, a bigger crew and more skill all raise capacity; a lunch rush lowers it", () => {
    const base = { tables: 6, meanParty: 2.6, crewUnits: 1, crewSkill: 50 };
    const c = capacityCovers(base);
    expect(capacityCovers({ ...base, tables: 9 })).toBeGreaterThan(c);
    expect(capacityCovers({ ...base, crewUnits: 2 })).toBeGreaterThan(c);
    expect(capacityCovers({ ...base, crewSkill: 70 })).toBeGreaterThan(c);
    expect(capacityCovers({ ...base, peakShare: 0.6 })).toBeLessThan(c);
    expect(capacityCovers({ ...base, tables: 0 })).toBe(0);
  });

  it("softCap and uncapped are inverses below the clip, and softCap never exceeds either input", () => {
    for (const d of [10, 50, 90, 150]) {
      const c = softCap(d, 120);
      expect(c).toBeLessThan(Math.min(d, 120));
      expect(uncapped(c, 120)).toBeCloseTo(d, 6);
    }
    expect(softCap(0, 100)).toBe(0);
  });

  it("marketDemand follows footfall, popularity and price like the arrival system", () => {
    const menu = MENU.map((id) => ({ dishId: id, price: content.dishes.find((d) => d.id === id)!.suggestedPrice, active: true, sold7d: 0, margin7d: 0 }));
    const at = (over: Partial<Parameters<typeof marketDemand>[1]>) => marketDemand(content, { districtId: "high_street", menu, day: 10, popularity: 50, ...over });
    const base = at({});
    expect(base.covers).toBeGreaterThan(0);
    expect(base.meanParty).toBeGreaterThan(1);
    expect(base.spendPerCover).toBeGreaterThan(0);
    expect(at({ footfallMult: 2 }).covers).toBeCloseTo(base.covers * 2, 6);
    expect(at({ popularity: 100 }).covers).toBeGreaterThan(base.covers);
    const dear = menu.map((m) => ({ ...m, price: Math.round(m.price * 1.5) }));
    expect(at({ menu: dear }).covers).toBeLessThan(base.covers);
    expect(at({ menu: dear }).spendPerCover).toBeGreaterThan(base.spendPerCover);
    expect(at({ menu: [] }).covers).toBeLessThan(0.01);
  });
});
