/**
 * Round 5: the hands-on commis station in sim time (docs/SIM-NOTES.md "Round 5: the station in sim time").
 *
 * A child cooks a station ticket in 7–8 sim ticks against ~2 for an AI cook. Three rules, all functions of the
 * GameState (so they replay from the command stream like everything else), keep that from costing the restaurant:
 *
 * 1. **Coursing.** Station starters, sides and desserts are served as their own course: a party whose other plates are
 *    in starts eating (`courseOut`), and the human's plate lands during the meal. The party pays only once it has.
 * 2. **Cover by ticket age in ticks.** The sim's sous chef plates a rail ticket (picked up or not) that is
 *    `coverTicks` old (rung-scaled; HANDS_ON.stationCoverTicks by default), one whose party is down to
 *    HANDS_ON.coverPatience, and a coursed plate just before its party finishes the mains. Covered plates are booked to
 *    the covering cook at a quality penalty.
 * 3. **Station dilation.** Every plate records when an AI cook would have had it out (`Customer.dueTick`); the ticks a
 *    party waited beyond that are refunded from its eating time and from the wait it rates, and it loses patience at
 *    HANDS_ON.stationPatienceMult while it waits only on the human.
 *
 * None of this runs without `GameState.handsOn.station`, so owner play is untouched.
 */
import { HANDS_ON, PLAYER_COOK_ID, SPEED_TICKS_BASE, SPEED_TICKS_SLOPE, STATION_COURSES } from "../constants";
import type { ContentPack, Customer, GameState, HandsOnStation, KitchenTicket } from "../types";
import { findDish } from "../util";

/** The human chef's station, when one is on. */
export function stationOf(state: GameState): HandsOnStation | undefined {
  return state.handsOn?.role === "chef" ? state.handsOn.station : undefined;
}

/** The human's cook id (their Staff id in career mode). */
export const humanOf = (state: GameState): string => state.handsOn?.staffId ?? PLAYER_COOK_ID;

/** A station dish served as its own course (starter, side or dessert). */
export function isCoursed(content: ContentPack, station: HandsOnStation, dishId: string): boolean {
  if (!station.dishIds.includes(dishId)) return false;
  const course = findDish(content, dishId)?.course;
  return !!course && STATION_COURSES.includes(course);
}

/** The party ordered some food that isn't a coursed station dish (so it has a main course to eat meanwhile). */
export function hasMainCourse(content: ContentPack, station: HandsOnStation, c: Customer): boolean {
  return c.order.some((d) => {
    const dish = findDish(content, d);
    return !!dish && dish.course !== "drink" && !isCoursed(content, station, d);
  });
}

/** This ticket goes out as the party's own course (not a remake; the party has a main course). */
export function coursable(content: ContentPack, station: HandsOnStation, t: KitchenTicket, c: Customer | undefined): boolean {
  return t.remakeOf === undefined && !!c && isCoursed(content, station, t.dishId) && hasMainCourse(content, station, c);
}

/** Whole ticks an average AI cook takes for this dish (the yardstick for the human's plates). */
export function aiTicks(content: ContentPack, dishId: string): number {
  const dish = findDish(content, dishId);
  if (!dish) return 1;
  const exact = dish.prepTicks * (SPEED_TICKS_BASE - (SPEED_TICKS_SLOPE * HANDS_ON.aiReferenceSpeed) / 100);
  return Math.max(1, Math.round(exact));
}

/** When an AI cook would have had this ticket out: never later than now. */
export const aiDueTick = (content: ContentPack, t: KitchenTicket, tick: number): number =>
  Math.min(tick, t.createdTick + aiTicks(content, t.dishId));

/** The station's cover age in ticks. */
export const coverTicksOf = (station: HandsOnStation): number => station.coverTicks ?? HANDS_ON.stationCoverTicks;

/**
 * Tickets on the human's rail: those they have picked up, then the oldest unassigned station tickets up to `cap`, with
 * at most one that isn't its own course (a main, or a dessert for a party with no main) — a second would wait for the
 * first while its table waits too, so it goes to the AI at once. Own-course tickets fill the rest: they have the whole
 * main course to be ready. handson `stationTickets` draws the same rail.
 */
export function humanTickets(content: ContentPack, state: GameState, station: HandsOnStation, tickets: readonly KitchenTicket[] = state.tickets): KitchenTicket[] {
  const human = humanOf(state);
  const dishes = new Set(station.dishIds);
  const byId = new Map(state.customers.map((c) => [c.id, c]));
  const blocking = (t: KitchenTicket) => !coursable(content, station, t, byId.get(t.customerId));
  const held = tickets.filter((t) => !t.atPass && t.chefId === human && t.claimedAtTick !== undefined);
  const out = [...held];
  let mains = held.filter(blocking).length;
  for (const t of tickets) {
    if (out.length >= station.cap) break;
    if (t.chefId || t.atPass || t.ticksRemaining <= 0 || !dishes.has(t.dishId)) continue;
    const main = blocking(t);
    if (main && mains >= 1) continue;
    if (main) mains++;
    out.push(t);
  }
  return out;
}

/** Rail tickets the sim's sous chef plates this tick (round 5 rule 2), oldest first. */
export function ticketsToCover(content: ContentPack, state: GameState, tickets: readonly KitchenTicket[]): KitchenTicket[] {
  const station = stationOf(state);
  if (!station) return [];
  const since = state.handsOn!.since;
  const byId = new Map(state.customers.map((c) => [c.id, c]));
  const coverAge = coverTicksOf(station);
  return humanTickets(content, state, station, tickets).filter((t) => {
    const c = byId.get(t.customerId);
    if (!c || c.stage === "left") return false;
    if (coursable(content, station, t, c)) {
      // Its own course: due just before the party finishes the mains (it isn't holding anyone up before that).
      return !!c.courseOut && c.stage === "eating" && c.eatUntil !== undefined && state.tick >= c.eatUntil - HANDS_ON.courseLeadTicks;
    }
    if (state.tick - Math.max(t.createdTick, since) >= coverAge) return true;
    return c.stage === "ordered" && c.patience <= HANDS_ON.coverPatience;
  });
}

/**
 * Round 5 rule 1: a party whose only missing plates are coursed station tickets starts eating now (`courseOut`).
 * `tickets` are the kitchen's tickets after this tick's plating.
 */
export function startCourses(content: ContentPack, state: GameState, customers: readonly Customer[], tickets: readonly KitchenTicket[]): readonly Customer[] {
  const station = stationOf(state);
  if (!station) return customers;
  const open = new Map<string, KitchenTicket[]>();
  for (const t of tickets) open.set(t.customerId, [...(open.get(t.customerId) ?? []), t]);
  let changed = false;
  const out = customers.map((c) => {
    if (c.stage !== "ordered" || c.servedTick !== undefined || !(c.platesReady ?? 0)) return c;
    const out = open.get(c.id);
    if (!out?.length || (c.platesReady ?? 0) + out.length < c.order.length) return c;
    if (!out.every((t) => !t.atPass && coursable(content, station, t, c))) return c;
    changed = true;
    return { ...c, servedTick: state.tick, courseOut: true };
  });
  return changed ? out : customers;
}

/**
 * Customers (ordered, not yet served) whose every outstanding ticket is on the human's rail: they lose patience at
 * HANDS_ON.stationPatienceMult (round 5 rule 3). Empty without a station.
 */
export function waitingOnHuman(content: ContentPack, state: GameState): ReadonlySet<string> {
  const station = stationOf(state);
  if (!station) return new Set();
  const human = new Set(humanTickets(content, state, station).map((t) => t.id));
  const onlyHuman = new Map<string, boolean>();
  for (const t of state.tickets) onlyHuman.set(t.customerId, (onlyHuman.get(t.customerId) ?? true) && human.has(t.id));
  return new Set([...onlyHuman].filter(([, v]) => v).map(([k]) => k));
}

/** Ticks of the party's wait that were the human's, beyond an AI cook's time (0 without a dueTick). */
export const dilationOf = (c: Customer): number =>
  c.dueTick !== undefined && c.servedTick !== undefined ? Math.max(0, c.servedTick - c.dueTick) : 0;
