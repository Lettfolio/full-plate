/**
 * ArrivalSystem — potential parties pass by following each segment's arrival curve;
 * each one enters with p = sigmoid(entryLogit − queuePenalty).
 */
import {
  APPEAL_CAP,
  APPEAL_WEIGHT,
  COURSE_ORDER_CHANCE,
  DIFFICULTY,
  ENTRY_BIAS,
  LAST_SEATING_TICK,
  MAX_QUEUE_PARTIES,
  PATIENCE_START,
  PEOPLE_PER_POTENTIAL_PARTY,
  PRESTIGE_APPEAL_WEIGHT,
  PRICE_GAP_WEIGHT,
  QUEUE_PENALTY_PER_PARTY,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, DishDef, GameState, MenuItem, SegmentDef, ServiceTally, SimEvent } from "../types";
import { clamp, districtOf, findDish, findSegment, isWeekend, monthOf, sigmoid, tallyOf } from "../util";
import type { SystemResult } from "./system";

type Offered = { item: MenuItem; dish: DishDef };

/** Active menu items that are not 86'd today, joined with their content. */
export function offeredDishes(content: ContentPack, state: GameState): Offered[] {
  const pulled = state.eightySixed ?? [];
  const out: Offered[] = [];
  for (const item of state.menu) {
    if (!item.active || pulled.includes(item.dishId)) continue;
    const dish = findDish(content, item.dishId);
    if (dish) out.push({ item, dish });
  }
  return out;
}

/** Potential people passing today: footfall × season × popularity × mods × weekend × difficulty. */
export function potentialPeople(content: ContentPack, state: GameState): number {
  const district = districtOf(content, state);
  const season = district.seasonCurve[monthOf(state.day) - 1] ?? 1;
  const popularity = 0.5 + state.reputation.popularity / 100;
  const mods = state.footfallMods.reduce((m, f) => m * f.mult, 1);
  const weekend = isWeekend(state.day) ? content.balance.weekendFootfallMult : 1;
  return district.footfall * season * popularity * mods * weekend * DIFFICULTY[state.difficulty].footfallMult;
}

/** Expected spend per head: mean main price plus each other course's mean price × its order chance. */
export function expectedSpendPerHead(offered: readonly Offered[]): number {
  if (offered.length === 0) return 0;
  const byCourse = new Map<string, number[]>();
  for (const o of offered) byCourse.set(o.dish.course, [...(byCourse.get(o.dish.course) ?? []), o.item.price]);
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mains = byCourse.get("main");
  if (!mains) return mean(offered.map((o) => o.item.price));
  let spend = mean(mains);
  for (const [course, prices] of byCourse) {
    if (course !== "main") spend += (COURSE_ORDER_CHANCE[course] ?? 0) * mean(prices);
  }
  return spend;
}

/** Logit used when nothing is on the menu (finite so it survives JSON). */
export const NO_MENU_LOGIT = -50;

/** Appeal − price gap + prestige pull, before queue penalty. */
export function entryLogit(segment: SegmentDef, offered: readonly Offered[], prestige: number): number {
  if (offered.length === 0) return NO_MENU_LOGIT;
  let appeal = 0;
  for (const o of offered) appeal += o.dish.baseAppeal[segment.id] ?? 0;
  appeal = Math.min(APPEAL_CAP, appeal);
  const budget = Math.max(1, segment.averageBudget);
  const gapRatio = clamp((expectedSpendPerHead(offered) - budget) / budget, -0.5, 2);
  const priceGap = gapRatio * segment.priceSensitivity * PRICE_GAP_WEIGHT;
  const prestigeTerm = PRESTIGE_APPEAL_WEIGHT * segment.qualityWeight * ((prestige - 50) / 50);
  return ENTRY_BIAS + APPEAL_WEIGHT * appeal - priceGap + prestigeTerm;
}

/** Per-segment arrival plan for today. Called at START_SERVICE and after EIGHTY_SIX. */
export function planArrivals(content: ContentPack, state: GameState): ServiceTally["arrivals"] {
  const district = districtOf(content, state);
  const parties = potentialPeople(content, state) / PEOPLE_PER_POTENTIAL_PARTY;
  const offered = offeredDishes(content, state);
  const plan: ServiceTally["arrivals"] = [];
  for (const [segId, share] of Object.entries(district.segmentMix)) {
    const seg = findSegment(content, segId);
    if (!seg || share <= 0) continue;
    plan.push({ segment: segId, potentialParties: parties * share, entryLogit: entryLogit(seg, offered, state.reputation.prestige) });
  }
  return plan;
}

function partySize(rng: Rng, seg: SegmentDef, maxSeats: number): number {
  const weights = seg.partySizeWeights.slice(0, Math.max(1, maxSeats));
  const sizes = weights.map((_, i) => i + 1);
  return rng.weighted(sizes, weights) ?? 1;
}

const curveSums = new WeakMap<SegmentDef, number>();

/** Σ arrivalCurve (memoised per content object; content is immutable). */
function curveSum(seg: SegmentDef): number {
  let total = curveSums.get(seg);
  if (total === undefined) {
    total = seg.arrivalCurve.reduce((a, v) => a + v, 0) || 1;
    curveSums.set(seg, total);
  }
  return total;
}

export function arrivalSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  if (state.tick > LAST_SEATING_TICK) return { state, events: [] };
  const tally = tallyOf(state);
  let queueLen = 0;
  for (const c of state.customers) if (c.stage === "queue") queueLen++;
  const arrivals: Customer[] = [];
  const events: SimEvent[] = [];
  let next = tally.nextCustomer;
  for (const plan of tally.arrivals) {
    const seg = findSegment(content, plan.segment);
    if (!seg) continue;
    const lambda = (plan.potentialParties * (seg.arrivalCurve[state.tick] ?? 0)) / curveSum(seg);
    const passing = rng.poisson(lambda);
    for (let i = 0; i < passing; i++) {
      if (queueLen >= MAX_QUEUE_PARTIES) break;
      if (!rng.chance(sigmoid(plan.entryLogit - QUEUE_PENALTY_PER_PARTY * queueLen))) continue;
      const id = `c${state.day}-${next++}`;
      arrivals.push(newCustomer(id, seg, partySize(rng, seg, content.balance.seatsPerTable), state.tick));
      events.push({ type: "CUSTOMER_ARRIVED", customerId: id });
      queueLen++;
    }
  }
  if (arrivals.length === 0) return { state, events };
  return {
    state: {
      ...state,
      customers: state.customers.concat(arrivals),
      service: { ...tally, nextCustomer: next, parties: tally.parties + arrivals.length },
    },
    events,
  };
}

export function newCustomer(id: string, seg: SegmentDef, size: number, tick: number): Customer {
  return {
    id,
    segment: seg.id,
    partySize: size,
    arrivedTick: tick,
    stage: "queue",
    order: [],
    patience: PATIENCE_START,
    satisfaction: 0,
    spend: 0,
    tip: 0,
    stageTick: tick,
    platesReady: 0,
    qualitySum: 0,
    foodCost: 0,
  };
}
