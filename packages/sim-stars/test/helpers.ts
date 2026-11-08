import { content } from "@full-plate/content";
import type { DayResult, GameState, Staff } from "@full-plate/sim-core";
import { newGame } from "@full-plate/sim-core";
import { closedDay, newStarsState, stepStarsDay } from "../src";
import type { StarsEvent, StarsState } from "../src";

export { content };

export function chef(id: string, skill: number): Staff {
  return { id, name: id, role: "chef", skill, speed: 60, charm: 50, wage: 1600, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: skill, rota: [true, true, true, true, true, true, true] };
}

/** A minimal evening GameState on `day` whose service tally says every plate of `dishes` came out at `quality`. */
export function eveningState(day: number, quality: number, dishes: Record<string, number> = { duck_breast: 20, lamb_shoulder: 15, scallops_pea: 10 }, staff: Staff[] = [chef("c1", 90)]): GameState {
  const base = newGame(content, { type: "NEW_GAME", seed: 7, districtId: "high_street", restaurantName: "Test", difficulty: "normal" });
  const tally = {
    parties: 0, ratingSum: 0, satisfactionSum: 0, ratedCovers: 0, qualitySum: 0, plates: 0,
    dishes: Object.fromEntries(Object.entries(dishes).map(([id, n]) => [id, { sold: n, plated: n, qualitySum: n * quality, margin: 0 }])),
    potentialParties: 0, arrivals: [], nextCustomer: 0, nextTicket: 0, actionsPerTick: 0, actionsLeft: 0, plateWaste: 0, walkoutParties: 0, serverTips: 0, ingredientsUsed: {}, paid: [],
  };
  return { ...base, day, phase: "evening", staff, service: tally, cash: 10_000_000 };
}

export function dayResult(day: number, covers = 40): DayResult {
  return { ...closedDay(day), covers, revenue: covers * 6000, foodCost: covers * 1500, averageRating: 4.6 };
}

/** Steps `days` days at constant quality (or closed when quality is undefined). */
export function run(stars0: StarsState, from: number, days: number, quality: number | undefined | ((d: number) => number | undefined), dishes?: Record<string, number>, staff?: Staff[]) {
  let s = stars0;
  const events: StarsEvent[] = [];
  for (let d = from; d < from + days; d++) {
    const q = typeof quality === "function" ? quality(d) : quality;
    const r = q === undefined ? stepStarsDay(content, s, closedDay(d), eveningState(d, 0, {}, staff)) : stepStarsDay(content, s, dayResult(d), eveningState(d, q, dishes, staff));
    s = r.stars;
    events.push(...r.events);
  }
  return { stars: s, events };
}

export function fresh(day = 0, staff: Staff[] = [chef("c1", 90)]): StarsState {
  return newStarsState(content, { ...eveningState(day, 80, undefined, staff), day });
}
