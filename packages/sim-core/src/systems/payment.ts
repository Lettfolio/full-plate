/**
 * PaymentSystem — parties that finished eating pay (one FOH action each).
 * Satisfaction = weighted(quality, speed, value) + server charm; rating 1-5 from bands;
 * tips go to staff (tracked, not revenue).
 */
import {
  CHARM_SATISFACTION_MAX,
  COMP_SATISFACTION_BONUS,
  PAY_ACTION_COST,
  PLATE_WASTE_MAX_FRACTION,
  PLATE_WASTE_SATISFACTION,
  RATING_THRESHOLDS,
  TIP_MIN_RATING,
  VALUE_MID,
  VALUE_SLOPE,
  WAIT_GRACE_TICKS,
  WAIT_PENALTY_PER_TICK,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, GameState, SegmentDef, ServiceTally, SimEvent } from "../types";
import { clamp, findDish, findSegment, plateCost, round2, tallyOf } from "../util";
import { frontCharm, type SystemResult } from "./system";

export interface SatisfactionInputs {
  quality: number;   // mean plate quality 0-100
  waitTicks: number; // arrival → last plate
  spendPerHead: number;
  charm: number;     // 0-100
  comped: boolean;
}

export function speedScore(waitTicks: number): number {
  return clamp(100 - Math.max(0, waitTicks - WAIT_GRACE_TICKS) * WAIT_PENALTY_PER_TICK, 0, 100);
}

export function valueScore(seg: SegmentDef, spendPerHead: number): number {
  const budget = Math.max(1, seg.averageBudget);
  return clamp(VALUE_MID + (VALUE_SLOPE * (budget - spendPerHead)) / budget, 0, 100);
}

/** Weighted mean of quality, speed and value, plus up to CHARM_SATISFACTION_MAX from charm. */
export function satisfactionOf(seg: SegmentDef, x: SatisfactionInputs): number {
  const wq = seg.qualityWeight;
  const ws = seg.speedWeight;
  // ARCHITECTURE.md writes (1 − priceSensitivity); that would make bargain-hunters ignore value,
  // so value is weighted by priceSensitivity instead (see docs/SIM-NOTES.md).
  const wv = seg.priceSensitivity;
  const total = wq + ws + wv || 1;
  const value = x.comped ? 100 : valueScore(seg, x.spendPerHead);
  const base = (wq * x.quality + ws * speedScore(x.waitTicks) + wv * value) / total;
  const charm = (CHARM_SATISFACTION_MAX * clamp(x.charm, 0, 100)) / 100;
  return round2(clamp(base + charm + (x.comped ? COMP_SATISFACTION_BONUS : 0), 0, 100));
}

export function ratingOf(satisfaction: number): number {
  let rating = 1;
  for (const t of RATING_THRESHOLDS) if (satisfaction >= t) rating++;
  return rating;
}

export function tipOf(seg: SegmentDef, spend: number, rating: number): number {
  if (rating < TIP_MIN_RATING || spend <= 0) return 0;
  return Math.round(spend * seg.tipRate * ((rating - TIP_MIN_RATING + 1) / (6 - TIP_MIN_RATING)));
}

/** Cost of food left on plates by unhappy diners (display; already inside foodCost). */
export function plateWasteOf(foodCost: number, satisfaction: number): number {
  if (satisfaction >= PLATE_WASTE_SATISFACTION) return 0;
  const frac = ((PLATE_WASTE_SATISFACTION - satisfaction) / PLATE_WASTE_SATISFACTION) * PLATE_WASTE_MAX_FRACTION;
  return Math.round(foodCost * frac);
}

/** Books each plate's sale and margin into the tally. */
function recordDishes(content: ContentPack, state: GameState, tally: ServiceTally, c: Customer): ServiceTally {
  const dishes = { ...tally.dishes };
  for (const id of c.order) {
    const item = state.menu.find((m) => m.dishId === id);
    const dish = findDish(content, id);
    const price = c.comped ? 0 : item?.price ?? 0;
    const cost = dish ? plateCost(content, dish) : 0;
    const d = dishes[id] ?? { sold: 0, plated: 0, qualitySum: 0, margin: 0 };
    dishes[id] = { ...d, sold: d.sold + 1, margin: d.margin + Math.round(price - cost) };
  }
  return { ...tally, dishes };
}

/** Most-ordered dish in a party's order (for review text). */
function signatureDish(order: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const id of order) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | undefined;
  for (const [id, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = id;
  return best;
}

export function paymentSystem(content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  let tally = tallyOf(state);
  let actions = tally.actionsLeft;
  const paying = state.customers.filter((c) => c.stage === "paying");
  if (paying.length === 0) return { state, events: [] };
  const charm = frontCharm(content, state);
  const events: SimEvent[] = [];
  const paid = new Map<string, Customer>();
  let revenue = 0;
  let tips = 0;
  let covers = 0;
  for (const c of paying) {
    if (actions < PAY_ACTION_COST) break;
    const seg = findSegment(content, c.segment);
    if (!seg) continue;
    actions -= PAY_ACTION_COST;
    const spend = c.comped ? 0 : c.spend;
    const quality = c.order.length ? (c.qualitySum ?? 0) / c.order.length : 0;
    const satisfaction = satisfactionOf(seg, {
      quality,
      waitTicks: (c.servedTick ?? state.tick) - c.arrivedTick,
      spendPerHead: c.spend / c.partySize,
      charm,
      comped: !!c.comped,
    });
    const rating = ratingOf(satisfaction);
    const tip = tipOf(seg, c.spend, rating);
    paid.set(c.id, { ...c, stage: "left", leftTick: state.tick, satisfaction, rating, spend, tip });
    events.push({ type: "CUSTOMER_PAID", customerId: c.id, spend, tip, rating });
    revenue += spend;
    tips += tip;
    covers += c.partySize;
    tally = recordDishes(content, state, tally, c);
    tally = {
      ...tally,
      ratingSum: tally.ratingSum + rating * c.partySize,
      satisfactionSum: tally.satisfactionSum + satisfaction * c.partySize,
      ratedCovers: tally.ratedCovers + c.partySize,
      plateWaste: tally.plateWaste + plateWasteOf(c.foodCost ?? 0, satisfaction),
      serverTips: tally.serverTips + tip,
      paid: [...tally.paid, { segment: c.segment, partySize: c.partySize, rating, quality: round2(quality), dishId: signatureDish(c.order) }],
    };
  }
  const t = state.todays;
  return {
    state: {
      ...state,
      cash: state.cash + revenue,
      customers: state.customers.map((c) => paid.get(c.id) ?? c),
      todays: {
        ...t,
        revenue: (t.revenue ?? 0) + revenue,
        tips: (t.tips ?? 0) + tips,
        covers: (t.covers ?? 0) + covers,
      },
      service: { ...tally, actionsLeft: actions },
    },
    events,
  };
}
