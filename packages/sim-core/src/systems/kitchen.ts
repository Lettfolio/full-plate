/**
 * KitchenSystem — chefs (and bar staff for drinks) pick up waiting tickets in order,
 * cook them in parallel, and plate them with a quality score.
 * When nobody is on, the owner cooks one ticket at a time.
 */
import {
  BAR_PARALLEL_TICKETS,
  CHEF_PARALLEL_TICKETS,
  FATIGUE_QUALITY_PENALTY,
  MISTAKE_BASE_CHANCE,
  MISTAKE_PER_SKILL_GAP,
  MISTAKE_QUALITY_HIT,
  OWNER,
  QUALITY_NOISE_SD,
  SKILL_GAP_PENALTY,
  SPEED_TICKS_BASE,
  SPEED_TICKS_SLOPE,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, DishDef, GameState, KitchenTicket, ServiceTally, SimEvent, Staff } from "../types";
import { clamp, findDish, mapIfChanged, onShift, round2, tallyOf, traitMult } from "../util";
import { effectiveSkill, effectiveSpeed, type SystemResult } from "./system";

/** A cook working this tick: a staff member or the owner (id "owner"). */
export interface Cook {
  id: string;
  skill: number;
  speed: number;
  fatigue: number;
  mistakeMult: number;
  capacity: number;
  drinksOnly: boolean;
}

const OWNER_ID = "owner";

/** Staff don't change during service, so cooks are memoised on (staff array, content, day). Derived data only. */
const cookCache = new WeakMap<readonly Staff[], { content: ContentPack; day: number; cooks: Cook[] }>();

export function cooksOnShift(content: ContentPack, state: GameState): Cook[] {
  const hit = cookCache.get(state.staff);
  if (hit && hit.day === state.day && hit.content === content) return hit.cooks;
  const cooks = buildCooks(content, state);
  cookCache.set(state.staff, { content, day: state.day, cooks });
  return cooks;
}

function buildCooks(content: ContentPack, state: GameState): Cook[] {
  const toCook = (s: Staff, capacity: number, drinksOnly: boolean): Cook => ({
    id: s.id,
    skill: effectiveSkill(content, s),
    speed: effectiveSpeed(content, s),
    fatigue: s.fatigue,
    mistakeMult: traitMult(content, s.traits, "mistakeRate"),
    capacity,
    drinksOnly,
  });
  const chefs = onShift(state, "chef").map((s) => toCook(s, CHEF_PARALLEL_TICKETS, false));
  const bar = onShift(state, "bar").map((s) => toCook(s, BAR_PARALLEL_TICKETS, true));
  if (chefs.length) return [...chefs, ...bar];
  const owner: Cook = { id: OWNER_ID, ...OWNER, fatigue: 0, mistakeMult: 1, capacity: OWNER.chefTickets, drinksOnly: false };
  return [owner, ...bar];
}

/** Ticks a cook needs for a dish: faster cooks shave time, slow ones add it. */
export function cookTicks(dish: DishDef, speed: number): number {
  return Math.max(1, Math.round(dish.prepTicks * (SPEED_TICKS_BASE - (SPEED_TICKS_SLOPE * speed) / 100)));
}

/** Plate quality 0-100 per the architecture formula, with mistakes and noise. */
export function plateQuality(rng: Rng, dish: DishDef, cook: Cook, freshness: number): { quality: number; mistake: boolean } {
  const skillGap = Math.max(0, dish.skillRequired - cook.skill);
  const base = Math.min(
    dish.qualityCeiling,
    cook.skill - skillGap * SKILL_GAP_PENALTY - cook.fatigue * FATIGUE_QUALITY_PENALTY,
  );
  const mistake = rng.chance((MISTAKE_BASE_CHANCE + skillGap * MISTAKE_PER_SKILL_GAP) * cook.mistakeMult);
  const noisy = base + freshness + rng.gaussian(0, QUALITY_NOISE_SD) - (mistake ? MISTAKE_QUALITY_HIT : 0);
  return { quality: round2(clamp(noisy, 0, 100)), mistake };
}

const canCook = (cook: Cook, dish: DishDef | undefined): boolean =>
  !!dish && (!cook.drinksOnly || dish.course === "drink");

/** Assigns unstarted tickets to cooks with free capacity (bar staff first for drinks). */
export function assignTickets(content: ContentPack, tickets: readonly KitchenTicket[], cooks: readonly Cook[]): KitchenTicket[] {
  const load = new Map<string, number>();
  for (const t of tickets) if (t.chefId) load.set(t.chefId, (load.get(t.chefId) ?? 0) + 1);
  const ordered = [...cooks].sort((a, b) => Number(b.drinksOnly) - Number(a.drinksOnly));
  return mapIfChanged(tickets, (t) => {
    if (t.chefId) return t;
    const dish = findDish(content, t.dishId);
    const cook = ordered.find((k) => canCook(k, dish) && (load.get(k.id) ?? 0) < k.capacity);
    if (!cook || !dish) return t;
    load.set(cook.id, (load.get(cook.id) ?? 0) + 1);
    return { ...t, chefId: cook.id, ticksRemaining: cookTicks(dish, cook.speed) };
  });
}

/** Adds a plated dish to its customer. */
function deliverPlate(c: Customer, quality: number, tick: number): Customer {
  const platesReady = (c.platesReady ?? 0) + 1;
  const done = platesReady >= c.order.length;
  return {
    ...c,
    platesReady,
    qualitySum: (c.qualitySum ?? 0) + quality,
    ...(done ? { servedTick: tick } : {}),
  };
}

export function kitchenSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  if (state.tickets.length === 0) return { state, events: [] };
  const cooks = cooksOnShift(content, state);
  const byId = new Map(cooks.map((k) => [k.id, k]));
  const assigned = assignTickets(content, state.tickets, cooks);
  const events: SimEvent[] = [];
  const delivered = new Map<string, number[]>();
  const remaining: KitchenTicket[] = [];
  const tally = tallyOf(state);
  let dishes: ServiceTally["dishes"] | undefined;
  let plates = tally.plates;
  let qualitySum = tally.qualitySum;
  for (const t of assigned) {
    const cook = t.chefId ? byId.get(t.chefId) : undefined;
    const dish = findDish(content, t.dishId);
    if (!cook || !dish) {
      remaining.push(t);
      continue;
    }
    if (t.ticksRemaining > 1) {
      remaining.push({ ...t, ticksRemaining: t.ticksRemaining - 1 });
      continue;
    }
    const { quality } = plateQuality(rng, dish, cook, t.freshness ?? 0);
    events.push({ type: "DISH_PLATED", ticketId: t.id, quality });
    delivered.set(t.customerId, [...(delivered.get(t.customerId) ?? []), quality]);
    dishes ??= { ...tally.dishes };
    const d = dishes[dish.id] ?? { sold: 0, plated: 0, qualitySum: 0, margin: 0 };
    dishes[dish.id] = { ...d, plated: d.plated + 1, qualitySum: d.qualitySum + quality };
    plates++;
    qualitySum += quality;
  }
  if (!dishes) return { state: { ...state, tickets: remaining }, events };
  const customers = delivered.size
    ? state.customers.map((c) => {
        const qs = delivered.get(c.id);
        return qs ? qs.reduce((acc, q) => deliverPlate(acc, q, state.tick), c) : c;
      })
    : state.customers;
  return { state: { ...state, tickets: remaining, customers, service: { ...tally, dishes, plates, qualitySum } }, events };
}
