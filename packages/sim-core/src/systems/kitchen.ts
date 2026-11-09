/**
 * KitchenSystem — chefs (and bar staff for drinks) pick up waiting tickets in order,
 * cook them in parallel, and plate them with a quality score.
 * When no chef is on the floor, the owner cooks two tickets at a time (worse and slower; see ownerStats).
 * Incident "kitchen" mods scale progress per tick (a tripped fryer slows everything).
 */
import {
  BAR_PARALLEL_TICKETS,
  HANDS_ON,
  PLAYER_COOK_ID,
  CHEF_PARALLEL_TICKETS,
  FATIGUE_QUALITY_PENALTY,
  MISTAKE_BASE_CHANCE,
  MISTAKE_PER_SKILL_GAP,
  MISTAKE_QUALITY_HIT,
  OWNER,
  OWNER_PASS_DELAY_TICKS,
  QUALITY_NOISE_SD,
  SKILL_GAP_PENALTY,
  SKILL_QUALITY_PIVOT,
  SKILL_QUALITY_SLOPE,
  SPEED_TICKS_BASE,
  SPEED_TICKS_SLOPE,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, DishDef, GameState, KitchenTicket, ServiceTally, SimEvent, Staff } from "../types";
import { clamp, dither, findDish, mapIfChanged, onShift, round2, tallyOf, traitMult } from "../util";
import { effectiveSkill, effectiveSpeed, multMod, ownerStats, type SystemResult } from "./system";

/** A cook working this tick: a staff member or the owner (id "owner"). */
export interface Cook {
  id: string;
  skill: number;
  speed: number;
  fatigue: number;
  mistakeMult: number;
  capacity: number;
  drinksOnly: boolean;
  /** Extra ticks each plate waits at the pass (owner covering kitchen and floor). */
  passDelay?: number;
  /** Share of attention on the kitchen (owner also serving ⇒ < 1, cook time ÷ focus). */
  focus?: number;
}

export const OWNER_ID = "owner";

/**
 * Cooks depend only on the staff array (breaks, training and mid-service mood changes replace it), content, day and
 * owner fatigue, so they are memoised on the staff array's identity. Safe because state is immutable.
 */
const cookCache = new WeakMap<
  readonly Staff[],
  { content: ContentPack; day: number; ownerFatigue: number; profile: GameState["ownerProfile"]; cooks: Cook[] }
>();

export function cooksOnShift(content: ContentPack, state: GameState): Cook[] {
  const hit = cookCache.get(state.staff);
  const ownerFatigue = state.ownerFatigue ?? 0;
  const profile = state.ownerProfile;
  let cooks: Cook[];
  if (hit && hit.day === state.day && hit.content === content && hit.ownerFatigue === ownerFatigue && hit.profile === profile) cooks = hit.cooks;
  else {
    cooks = buildCooks(content, state);
    cookCache.set(state.staff, { content, day: state.day, ownerFatigue, profile, cooks });
  }
  // Round 3 review: a career player playing their own shift hands-on is the human, not an AI cook. Without this the
  // kitchen assigned tickets to the player's Staff record and cooked them at the player's sim stats, so the hands-on
  // chef never saw a ticket it could start (0 plates on every career shift). When the human was the only chef, the
  // owner covers what the human's reservation leaves (handled by buildCooks seeing no other chef).
  const human = state.handsOn?.staffId;
  if (human && (state.handsOn?.role === "chef" || state.handsOn?.role === "bar")) {
    const rest = cooks.filter((k) => k.id !== human);
    if (rest.length !== cooks.length) return rest.some((k) => !k.drinksOnly) || state.handsOn?.role === "bar" ? rest : buildCooks(content, { ...state, staff: state.staff.filter((x) => x.id !== human) });
  }
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
  const o = ownerStats(state);
  const owner: Cook = {
    id: OWNER_ID,
    skill: o.skill,
    speed: o.speed,
    fatigue: 0, // owner tiredness is already inside ownerStats
    mistakeMult: 1,
    capacity: OWNER.chefTickets,
    drinksOnly: false,
    ...(o.both ? { passDelay: OWNER_PASS_DELAY_TICKS, focus: o.focus } : {}),
  };
  return [owner, ...bar];
}

/** Ticks (fractional) a cook needs for a dish: fast cooks shave time, slow ones add it. */
export function cookTicksExact(dish: DishDef, speed: number): number {
  return Math.max(0.5, dish.prepTicks * (SPEED_TICKS_BASE - (SPEED_TICKS_SLOPE * clamp(speed, 0, 100)) / 100));
}

/**
 * Whole ticks for one ticket. Fractions are dithered per ticket id (deterministic, no RNG), so a cook who is 30%
 * faster really is 30% faster on average even for one-tick dishes.
 */
export function cookTicks(dish: DishDef, speed: number, ticketId = "", focus = 1): number {
  const exact = cookTicksExact(dish, speed) / Math.max(0.1, focus);
  const whole = Math.floor(exact);
  return Math.max(1, whole + (dither(ticketId) < exact - whole ? 1 : 0));
}

/** Plate quality 0-100: skill around a pivot (good chefs pull ahead), skill gap, fatigue, freshness, mistakes, noise. */
export function plateQuality(rng: Rng, dish: DishDef, cook: Cook, freshness: number): { quality: number; mistake: boolean } {
  const skillGap = Math.max(0, dish.skillRequired - cook.skill);
  const craft = SKILL_QUALITY_PIVOT + (cook.skill - SKILL_QUALITY_PIVOT) * SKILL_QUALITY_SLOPE;
  const base = Math.min(dish.qualityCeiling, craft - skillGap * SKILL_GAP_PENALTY - cook.fatigue * FATIGUE_QUALITY_PENALTY);
  const mistake = rng.chance((MISTAKE_BASE_CHANCE + skillGap * MISTAKE_PER_SKILL_GAP) * cook.mistakeMult);
  const noisy = base + freshness + rng.gaussian(0, QUALITY_NOISE_SD) - (mistake ? MISTAKE_QUALITY_HIT : 0);
  return { quality: round2(clamp(noisy, 0, 100)), mistake };
}

const canCook = (cook: Cook, dish: DishDef | undefined): boolean =>
  !!dish && (!cook.drinksOnly || dish.course === "drink");

/**
 * Assigns unstarted tickets to cooks with free capacity (bar staff first for drinks). A ticket whose cook has left the
 * floor (break, or the owner handing back to a returning chef) is re-homed and keeps its remaining time.
 */
export function assignTickets(
  content: ContentPack,
  tickets: readonly KitchenTicket[],
  cooks: readonly Cook[],
  reserved?: ReadonlySet<string>,
): KitchenTicket[] {
  const present = new Set(cooks.map((k) => k.id));
  const load = new Map<string, number>();
  for (const t of tickets) if (t.chefId && !t.atPass && present.has(t.chefId)) load.set(t.chefId, (load.get(t.chefId) ?? 0) + 1);
  const ordered = [...cooks].sort((a, b) => Number(b.drinksOnly) - Number(a.drinksOnly));
  return mapIfChanged(tickets, (t) => {
    if (t.atPass || t.chefId === PLAYER_COOK_ID || t.claimedAtTick !== undefined) return t;
    const orphan = t.chefId !== undefined && !present.has(t.chefId);
    if (t.chefId && !orphan) return t;
    if (!orphan && reserved?.has(t.id)) return t; // left on the rail for the hands-on human
    const dish = findDish(content, t.dishId);
    const cook = ordered.find((k) => canCook(k, dish) && (load.get(k.id) ?? 0) < k.capacity);
    if (!cook || !dish) return orphan ? { ...t, chefId: undefined } : t;
    load.set(cook.id, (load.get(cook.id) ?? 0) + 1);
    if (orphan) return { ...t, chefId: cook.id };
    // A remake's time is set by the incident (the chef drops everything for it).
    if (t.remakeOf !== undefined) return { ...t, chefId: cook.id };
    return { ...t, chefId: cook.id, ticksRemaining: cookTicks(dish, cook.speed, t.id, cook.focus) + (cook.passDelay ?? 0) };
  });
}

/** Adds a plated dish to its customer (a remake swaps the old plate's quality for the new one). */
export function deliverPlate(c: Customer, quality: number, tick: number, remakeOf: number | undefined): Customer {
  if (remakeOf !== undefined) return { ...c, qualitySum: (c.qualitySum ?? 0) - remakeOf + quality };
  const platesReady = (c.platesReady ?? 0) + 1;
  const done = platesReady >= c.order.length;
  return {
    ...c,
    platesReady,
    qualitySum: (c.qualitySum ?? 0) + quality,
    ...(done ? { servedTick: tick } : {}),
  };
}

/** Whole kitchen steps this tick, given incident slow-downs (fractions carry over in the tally). */
function kitchenSteps(state: GameState, tally: ServiceTally): { steps: number; carry: number } {
  const mult = multMod(state, "kitchen");
  if (mult === 1 && !tally.kitchenCarry) return { steps: 1, carry: 0 };
  const total = (tally.kitchenCarry ?? 0) + mult;
  const steps = Math.floor(total + 1e-9);
  return { steps, carry: round2(total - steps) };
}

// ── round 3: hands-on (SET_HANDS_ON) ──
const isDrink = (content: ContentPack, t: KitchenTicket): boolean => findDish(content, t.dishId)?.course === "drink";

/** True when a plate of this ticket should wait at the pass for the hands-on human to carry (server: all; bar: drinks). */
export function holdsAtPass(content: ContentPack, state: GameState, t: KitchenTicket): boolean {
  const role = state.handsOn?.role;
  return role === "server" || (role === "bar" && isDrink(content, t));
}

/** True when the hands-on human cooks this kind of ticket (chef: food; bar: drinks). */
function humanCooks(content: ContentPack, state: GameState, t: KitchenTicket): boolean {
  const role = state.handsOn?.role;
  return role === "chef" ? !isDrink(content, t) : role === "bar" ? isDrink(content, t) : false;
}

/**
 * Tickets the AI cooks leave for the human: the oldest HANDS_ON.reserveTickets unassigned tickets of the human's kind,
 * except any that has waited HANDS_ON.reserveFallbackTicks since it was fired (or since hands-on began).
 */
export function reservedForHuman(content: ContentPack, state: GameState): ReadonlySet<string> | undefined {
  const h = state.handsOn;
  if (!h || (h.role !== "chef" && h.role !== "bar")) return undefined;
  const out = new Set<string>();
  let n = 0;
  for (const t of state.tickets) {
    if (n >= HANDS_ON.reserveTickets) break;
    if (t.chefId || t.atPass || t.ticksRemaining <= 0 || !humanCooks(content, state, t)) continue;
    n++; // counts toward the human's 3 whether or not it has timed out
    if (state.tick - Math.max(t.createdTick, h.since) < HANDS_ON.reserveFallbackTicks) out.add(t.id);
  }
  return out;
}

/**
 * Human-claimed tickets (PLAYER_CLAIMED) go back on the rail when the claim is older than HANDS_ON.claimTimeoutTicks
 * or nobody is hands-on any more, so a child who wanders off (or leaves) never strands an order.
 */
export function releaseStaleClaims(state: GameState): readonly KitchenTicket[] {
  return mapIfChanged(state.tickets, (t) => {
    if (t.claimedAtTick === undefined || t.atPass) return t;
    const live = !!state.handsOn && state.tick - t.claimedAtTick < HANDS_ON.claimTimeoutTicks;
    if (live) return t;
    const { chefId: _c, claimedAtTick: _k, ...rest } = t;
    return rest as KitchenTicket;
  });
}

/** Books one plated plate into the tally (dish plated/quality, per-cook, freshness). Remakes swap quality only. */
export function tallyPlate(tally: ServiceTally, dishes: ServiceTally["dishes"], t: KitchenTicket, cookId: string, quality: number): ServiceTally {
  const d = dishes[t.dishId] ?? { sold: 0, plated: 0, qualitySum: 0, margin: 0 };
  const chefs = { ...(tally.chefs ?? {}) };
  const ch = chefs[cookId] ?? { plates: 0, qualitySum: 0 };
  if (t.remakeOf === undefined) {
    dishes[t.dishId] = { ...d, plated: d.plated + 1, qualitySum: d.qualitySum + quality };
    chefs[cookId] = { plates: ch.plates + 1, qualitySum: ch.qualitySum + quality };
    return {
      ...tally,
      dishes,
      chefs,
      plates: tally.plates + 1,
      qualitySum: tally.qualitySum + quality,
      freshnessSum: (tally.freshnessSum ?? 0) + (t.freshness ?? 0),
    };
  }
  dishes[t.dishId] = { ...d, qualitySum: d.qualitySum - t.remakeOf + quality };
  chefs[cookId] = { plates: ch.plates, qualitySum: ch.qualitySum - t.remakeOf + quality };
  return { ...tally, dishes, chefs, qualitySum: tally.qualitySum + quality - t.remakeOf };
}

/** Takes a held plate back off the books (PLAYER_DROPPED of a plated ticket): the inverse of tallyPlate. */
export function untallyPlate(tally: ServiceTally, t: KitchenTicket): ServiceTally {
  if (t.remakeOf !== undefined) return tally; // a dropped remake is simply cooked again; the old plate stays booked
  const dishes = { ...tally.dishes };
  const d = dishes[t.dishId];
  if (d) dishes[t.dishId] = { ...d, plated: Math.max(0, d.plated - 1), qualitySum: d.qualitySum - t.quality };
  const chefs = { ...(tally.chefs ?? {}) };
  const ch = t.chefId ? chefs[t.chefId] : undefined;
  if (t.chefId && ch) chefs[t.chefId] = { plates: Math.max(0, ch.plates - 1), qualitySum: ch.qualitySum - t.quality };
  return {
    ...tally,
    dishes,
    chefs,
    plates: Math.max(0, tally.plates - 1),
    qualitySum: tally.qualitySum - t.quality,
    freshnessSum: (tally.freshnessSum ?? 0) - (t.freshness ?? 0),
  };
}

/** A plated ticket held under the heat lamps. */
export const toPass = (t: KitchenTicket, cookId: string, quality: number, tick: number): KitchenTicket => ({
  ...t,
  chefId: cookId,
  quality,
  ticksRemaining: 0,
  atPass: true,
  platedAtTick: tick,
});

export function kitchenSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  if (state.tickets.length === 0) return { state, events: [] };
  const cooks = cooksOnShift(content, state);
  const byId = new Map(cooks.map((k) => [k.id, k]));
  const handsOn = state.handsOn;
  const assigned = assignTickets(content, releaseStaleClaims(state), cooks, handsOn ? reservedForHuman(content, state) : undefined);
  let tally = tallyOf(state);
  const { steps, carry } = kitchenSteps(state, tally);
  const events: SimEvent[] = [];
  const delivered = new Map<string, { q: number; remakeOf: number | undefined }[]>();
  const remaining: KitchenTicket[] = [];
  let dishes: ServiceTally["dishes"] | undefined;
  const deliver = (t: KitchenTicket, q: number) =>
    delivered.set(t.customerId, [...(delivered.get(t.customerId) ?? []), { q, remakeOf: t.remakeOf }]);
  for (const t of assigned) {
    if (t.atPass) {
      // Held plates: the human carries them (PLAYER_SERVED); an AI colleague takes one once it has waited long enough,
      // or straight away when hands-on no longer holds this kind of plate.
      if (holdsAtPass(content, state, t) && state.tick - (t.platedAtTick ?? state.tick) < HANDS_ON.passHoldTicks) remaining.push(t);
      else {
        deliver(t, t.quality);
        dishes ??= { ...tally.dishes };
      }
      continue;
    }
    const cook = t.chefId ? byId.get(t.chefId) : undefined;
    const dish = findDish(content, t.dishId);
    if (!cook || !dish || steps === 0) {
      remaining.push(t);
      continue;
    }
    if (t.ticksRemaining > steps) {
      remaining.push({ ...t, ticksRemaining: t.ticksRemaining - steps });
      continue;
    }
    const { quality } = plateQuality(rng, dish, cook, t.freshness ?? 0);
    events.push({ type: "DISH_PLATED", ticketId: t.id, quality });
    dishes ??= { ...tally.dishes };
    tally = tallyPlate(tally, dishes, t, cook.id, quality);
    if (handsOn && holdsAtPass(content, state, t)) remaining.push(toPass(t, cook.id, quality, state.tick));
    else deliver(t, quality);
  }
  if (!dishes) {
    // Nothing plated: only touch the tally if the slow-kitchen carry moved.
    const service = carry === (tally.kitchenCarry ?? 0) ? state.service : { ...tally, kitchenCarry: carry };
    return { state: { ...state, tickets: remaining, service }, events };
  }
  const service = { ...tally, kitchenCarry: carry };
  const customers = delivered.size
    ? state.customers.map((c) => {
        const qs = delivered.get(c.id);
        return qs ? qs.reduce((acc, p) => deliverPlate(acc, p.q, state.tick, p.remakeOf), c) : c;
      })
    : state.customers;
  return { state: { ...state, tickets: remaining, customers, service }, events };
}
