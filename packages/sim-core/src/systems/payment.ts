/**
 * PaymentSystem — parties that finished eating pay (one FOH action each).
 * Satisfaction = weighted(quality, speed, value) + server charm; rating 1-5 from bands;
 * tips go to staff (tracked, not revenue).
 */
import {
  CHARM_SATISFACTION_MAX,
  CHARM_UPGRADE_FROM,
  CHARM_UPGRADE_MAX,
  INCIDENT,
  TIP_CHARM_BASE,
  TIP_CHARM_SLOPE,
  COMP_SATISFACTION_BONUS,
  HANDS_ON,
  PAY_ACTION_COST,
  SET_MENU_BUDGET_MULT,
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
import { vipVerdict } from "./incidents";
import { dilationOf } from "./station";

export interface SatisfactionInputs {
  quality: number;   // mean plate quality 0-100
  waitTicks: number; // arrival → last plate
  spendPerHead: number;
  charm: number;     // 0-100
  comped: boolean;
  /** Incident adjustments (apology, freebie, spill). */
  bonus?: number;
  /** [round 3] Budget multiplier for the value score (set menu: SET_MENU_BUDGET_MULT, a tasting-menu budget). */
  budgetMult?: number;
}

export function speedScore(waitTicks: number): number {
  return clamp(100 - Math.max(0, waitTicks - WAIT_GRACE_TICKS) * WAIT_PENALTY_PER_TICK, 0, 100);
}

export function valueScore(seg: SegmentDef, spendPerHead: number, budgetMult = 1): number {
  const budget = Math.max(1, seg.averageBudget * budgetMult);
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
  const value = x.comped ? 100 : valueScore(seg, x.spendPerHead, x.budgetMult ?? 1);
  const base = (wq * x.quality + ws * speedScore(x.waitTicks) + wv * value) / total;
  const charm = (CHARM_SATISFACTION_MAX * clamp(x.charm, 0, 100)) / 100;
  return round2(clamp(base + charm + (x.comped ? COMP_SATISFACTION_BONUS : 0) + (x.bonus ?? 0), 0, 100));
}

export function ratingOf(satisfaction: number): number {
  let rating = 1;
  for (const t of RATING_THRESHOLDS) if (satisfaction >= t) rating++;
  return rating;
}

/** Charming servers earn more tips: × (BASE + SLOPE × charm/100); charm 50 ⇒ ×1. */
export function tipOf(seg: SegmentDef, spend: number, rating: number, charm = 50): number {
  if (rating < TIP_MIN_RATING || spend <= 0) return 0;
  const charmMult = TIP_CHARM_BASE + (TIP_CHARM_SLOPE * clamp(charm, 0, 100)) / 100;
  return Math.round(spend * seg.tipRate * ((rating - TIP_MIN_RATING + 1) / (6 - TIP_MIN_RATING)) * charmMult);
}

/** Chance a charming server turns a 3★ evening into a 4★ one. */
export function charmUpgradeChance(charm: number): number {
  return CHARM_UPGRADE_MAX * clamp((charm - CHARM_UPGRADE_FROM) / (100 - CHARM_UPGRADE_FROM), 0, 1);
}

/** Cost of food left on plates by unhappy diners (display; already inside foodCost). */
export function plateWasteOf(foodCost: number, satisfaction: number): number {
  if (satisfaction >= PLATE_WASTE_SATISFACTION) return 0;
  const frac = ((PLATE_WASTE_SATISFACTION - satisfaction) / PLATE_WASTE_SATISFACTION) * PLATE_WASTE_MAX_FRACTION;
  return Math.round(foodCost * frac);
}

/**
 * Price of each plate in a party's order: the menu price, or (set menu) the set price per head split across the set's
 * dishes in proportion to their suggested prices. Comped parties pay nothing.
 */
export function platePrices(content: ContentPack, state: GameState, c: Customer): number[] {
  if (c.comped) return c.order.map(() => 0);
  if (!c.setMenu) return c.order.map((id) => state.menu.find((m) => m.dishId === id)?.price ?? 0);
  const weights = c.order.map((id) => Math.max(1, findDish(content, id)?.suggestedPrice ?? 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (c.spend * w) / total); // sums to the party's bill
}

/** Books each plate's sale, takings and margin into the tally. */
function recordDishes(content: ContentPack, state: GameState, tally: ServiceTally, c: Customer): ServiceTally {
  const dishes = { ...tally.dishes };
  const prices = platePrices(content, state, c);
  c.order.forEach((id, i) => {
    const dish = findDish(content, id);
    const price = prices[i] ?? 0;
    const cost = dish ? plateCost(content, dish) : 0;
    const d = dishes[id] ?? { sold: 0, plated: 0, qualitySum: 0, margin: 0 };
    dishes[id] = { ...d, sold: d.sold + 1, margin: d.margin + Math.round(price - cost), revenue: (d.revenue ?? 0) + price };
  });
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

/** One party settles: satisfaction, rating, tip, VIP verdict, tally. The caller has already spent any FOH action. */
export function settleParty(
  content: ContentPack,
  state: GameState,
  rng: Rng,
  c: Customer,
  tally: ServiceTally,
  charm: number,
): { customer: Customer; tally: ServiceTally; events: SimEvent[] } | undefined {
  const seg = findSegment(content, c.segment);
  if (!seg) return undefined;
  const events: SimEvent[] = [];
  const spend = c.comped ? 0 : c.spend;
  const quality = c.order.length ? (c.qualitySum ?? 0) / c.order.length : 0;
  const satisfaction = satisfactionOf(seg, {
    quality,
    // Round 5 station dilation: the ticks the party waited on the hands-on human beyond an AI's time don't count.
    waitTicks: (c.servedTick ?? state.tick) - dilationOf(c) - c.arrivedTick,
    spendPerHead: c.spend / c.partySize,
    charm,
    comped: !!c.comped,
    bonus: c.satisfactionBonus ?? 0,
    ...(c.setMenu ? { budgetMult: SET_MENU_BUDGET_MULT[seg.id] ?? 1 } : {}),
  });
  let rating = ratingOf(satisfaction);
  if (rating === 3 && rng.chance(charmUpgradeChance(charm))) rating = 4;
  const tip = tipOf(seg, c.spend, rating, charm);
  let prestigeBonus = tally.prestigeBonus ?? 0;
  if (c.vip) {
    const delta = (rating - 3) * INCIDENT.vipPrestigePerStar;
    prestigeBonus += delta;
    events.push(...vipVerdict(content, state, rating, delta));
  }
  events.push({ type: "CUSTOMER_PAID", customerId: c.id, spend, tip, rating });
  let t = recordDishes(content, state, tally, c);
  t = {
    ...t,
    prestigeBonus,
    ratingSum: t.ratingSum + rating * c.partySize,
    satisfactionSum: t.satisfactionSum + satisfaction * c.partySize,
    ratedCovers: t.ratedCovers + c.partySize,
    plateWaste: t.plateWaste + plateWasteOf(c.foodCost ?? 0, satisfaction),
    serverTips: t.serverTips + tip,
    paid: [...t.paid, { segment: c.segment, partySize: c.partySize, rating, quality: round2(quality), dishId: signatureDish(c.order) }],
  };
  return { customer: { ...c, stage: "left", leftTick: state.tick, satisfaction, rating, spend, tip }, tally: t, events };
}

/** Adds settled parties' takings to cash and today's totals. */
export function bookTakings(state: GameState, paid: ReadonlyMap<string, Customer>, tally: ServiceTally): GameState {
  let revenue = 0;
  let tips = 0;
  let covers = 0;
  for (const c of paid.values()) {
    revenue += c.spend;
    tips += c.tip;
    covers += c.partySize;
  }
  const t = state.todays;
  return {
    ...state,
    cash: state.cash + revenue,
    customers: state.customers.map((c) => paid.get(c.id) ?? c),
    todays: { ...t, revenue: (t.revenue ?? 0) + revenue, tips: (t.tips ?? 0) + tips, covers: (t.covers ?? 0) + covers },
    service: tally,
  };
}

/**
 * Pays every party that can pay this tick. With a human server or bar on (hands-on), AI front of house leaves a party
 * to the human until it has waited HANDS_ON.payHoldTicks to pay; `atClose` (closing time) settles everyone.
 */
export function payParties(content: ContentPack, state: GameState, rng: Rng, atClose: boolean): SystemResult {
  let tally = tallyOf(state);
  let actions = tally.actionsLeft;
  const paying = state.customers.filter((c) => c.stage === "paying");
  if (paying.length === 0) return { state, events: [] };
  const role = state.handsOn?.role;
  const hold = !atClose && (role === "server" || role === "bar");
  const charm = tally.frontCharm ?? frontCharm(content, state);
  const events: SimEvent[] = [];
  const paid = new Map<string, Customer>();
  for (const c of paying) {
    if (actions < PAY_ACTION_COST) break;
    if (hold && state.tick - (c.stageTick ?? state.tick) < HANDS_ON.payHoldTicks) continue;
    const r = settleParty(content, state, rng, c, tally, charm);
    if (!r) continue;
    actions -= PAY_ACTION_COST;
    paid.set(c.id, r.customer);
    tally = r.tally;
    events.push(...r.events);
  }
  if (paid.size === 0 && actions === tally.actionsLeft) return { state, events };
  return { state: bookTakings(state, paid, { ...tally, actionsLeft: actions }), events };
}

export function paymentSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  return payParties(content, state, rng, false);
}
