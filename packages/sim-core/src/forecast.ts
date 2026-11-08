/**
 * Demand forecast and suggested stock orders (public API: `suggestedOrder`, `expectedCovers`).
 * Moved here from the UI (game/src/screens/planning/stockNeeds.ts) so the UI, the headless owners and
 * the opening-stock allowance all use one heuristic.
 *
 *  - expectedCovers: before any history, a model estimate (arrival plan × entry chance × party size, capped
 *    by what the dining room can turn); after that, the busiest recent day's demand (covers + walk-outs) × 1.1.
 *  - platesPerGuest: one main each plus COURSE_ORDER_CHANCE of each other course, split evenly within a course,
 *    raised to each dish's own recent sales rate when that is higher.
 *  - suggestedOrder: per ingredient, forecast need − on hand − already ordered, rounded up to ORDER_ROUND_TO.
 */
import {
  COURSE_ORDER_CHANCE,
  DIFFICULTY,
  EAT_TICKS_BASE,
  FORECAST_HISTORY_MULT,
  FORECAST_MIN_COVERS,
  FORECAST_WINDOW_DAYS,
  LAST_SEATING_TICK,
  OPENING_STOCK_BUDGET,
  OPENING_STOCK_COVER_MULT,
  ORDER_ROUND_TO,
  WAIT_GRACE_TICKS,
} from "./constants";
import { addStock, purchaseCost, stockQty } from "./stock";
import { planArrivals } from "./systems/arrival";
import type { ContentPack, DishCourse, DishId, GameState, IngredientId, SimEvent } from "./types";
import { findDish, findIngredient, findSegment, logEvent, monthOf, sigmoid } from "./util";

/** Rough number of times a table turns over in a service (seat → eat → pay → clear). */
const TABLE_TURNS = LAST_SEATING_TICK / (EAT_TICKS_BASE + WAIT_GRACE_TICKS + 6);

/** Model estimate of covers for a service with the current menu, before any history exists. */
export function modelCovers(content: ContentPack, state: GameState): number {
  let covers = 0;
  for (const p of planArrivals(content, state)) {
    const seg = findSegment(content, p.segment);
    if (!seg) continue;
    const w = seg.partySizeWeights.slice(0, content.balance.seatsPerTable);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    const meanSize = w.reduce((a, x, i) => a + x * (i + 1), 0) / total;
    covers += p.potentialParties * sigmoid(p.entryLogit) * meanSize;
  }
  const capacity = state.tables.length * content.balance.seatsPerTable * TABLE_TURNS * 0.6;
  return Math.min(covers, capacity);
}

/** Guests to plan for at the next service. */
export function expectedCovers(content: ContentPack, state: GameState): number {
  const recent = state.history.slice(-FORECAST_WINDOW_DAYS);
  if (!recent.length) return Math.max(FORECAST_MIN_COVERS, Math.round(modelCovers(content, state)));
  const demand = Math.max(...recent.map((d) => d.covers + d.walkouts));
  return Math.max(FORECAST_MIN_COVERS, Math.round(demand * FORECAST_HISTORY_MULT));
}

/** Plates of each active dish per guest (not filtered by today's 86 list: tomorrow's order must cover sell-outs). */
export function platesPerGuest(content: ContentPack, state: GameState): Map<DishId, number> {
  const active = state.menu.filter((m) => m.active && findDish(content, m.dishId));
  const byCourse = new Map<DishCourse, DishId[]>();
  for (const m of active) {
    const d = findDish(content, m.dishId)!;
    byCourse.set(d.course, [...(byCourse.get(d.course) ?? []), d.id]);
  }
  const out = new Map<DishId, number>();
  const mains = byCourse.get("main");
  if (!mains) {
    for (const m of active) out.set(m.dishId, 1 / active.length);
    return out;
  }
  for (const [course, ids] of byCourse) {
    const perGuest = course === "main" ? 1 : COURSE_ORDER_CHANCE[course] ?? 0;
    for (const id of ids) out.set(id, perGuest / ids.length);
  }
  for (const m of active) {
    const days = m.recent?.length ?? 0;
    const guests = state.history.slice(-days).reduce((a, d) => a + d.covers, 0);
    if (days > 0 && guests > 0) out.set(m.dishId, Math.max(out.get(m.dishId) ?? 0, m.sold7d / guests));
  }
  return out;
}

/** Portions of each ingredient the forecast needs (unrounded), in content order. */
export function ingredientNeeds(content: ContentPack, state: GameState, guests: number): Map<IngredientId, number> {
  const need = new Map<IngredientId, number>();
  for (const [dishId, share] of platesPerGuest(content, state)) {
    for (const ing of findDish(content, dishId)!.ingredients) need.set(ing.id, (need.get(ing.id) ?? 0) + ing.qty * share * guests);
  }
  const ordered = new Map<IngredientId, number>();
  for (const ing of content.ingredients) if (need.has(ing.id)) ordered.set(ing.id, need.get(ing.id)!);
  return ordered;
}

export interface OrderOptions {
  /** Multiplies the cover forecast (e.g. 1.3 for a safety margin). Default 1. */
  coverMult?: number;
  /** Ignore pending orders (they arrive tomorrow; used for the opening stock, which is needed today). */
  ignoreOrders?: boolean;
}

/** Suggested ORDER_STOCK lines so that on hand + incoming covers the next service. */
export function suggestedOrder(content: ContentPack, state: GameState, opts: OrderOptions = {}): { ingredientId: IngredientId; qty: number }[] {
  const guests = expectedCovers(content, state) * (opts.coverMult ?? 1);
  const out: { ingredientId: IngredientId; qty: number }[] = [];
  for (const [id, need] of ingredientNeeds(content, state, guests)) {
    const incoming = opts.ignoreOrders ? 0 : state.orders.filter((o) => o.ingredientId === id).reduce((a, o) => a + o.qty, 0);
    const gap = Math.ceil(need) - stockQty(state.stock, id) - incoming;
    if (gap > 0) out.push({ ingredientId: id, qty: Math.ceil(gap / ORDER_ROUND_TO) * ORDER_ROUND_TO });
  }
  return out;
}

export const openingStockBudget = (content: ContentPack): number => content.balance.openingStockBudget ?? OPENING_STOCK_BUDGET;

/**
 * Opening stock (first START_SERVICE only): what the active menu needs for OPENING_STOCK_COVER_MULT × the first-day
 * forecast, less anything already on hand, scaled down to fit the allowance, delivered at once and paid from cash.
 */
export function buyOpeningStock(content: ContentPack, state: GameState): { state: GameState; events: SimEvent[] } {
  const budget = openingStockBudget(content);
  const costMult = DIFFICULTY[state.difficulty].costMult;
  const month = monthOf(state.day);
  const lines = suggestedOrder(content, state, { coverMult: OPENING_STOCK_COVER_MULT, ignoreOrders: true });
  const priced = lines.flatMap((l) => {
    const ing = findIngredient(content, l.ingredientId);
    return ing ? [{ ...l, ing, unit: purchaseCost(ing, 1, month, costMult) }] : [];
  });
  const full = priced.reduce((a, l) => a + l.unit * l.qty, 0);
  if (budget <= 0 || full <= 0) return { state, events: [] };
  const scale = Math.min(1, budget / full);
  let stock = state.stock;
  let cost = 0;
  for (const l of priced) {
    const qty = Math.floor(l.qty * scale);
    if (qty <= 0) continue;
    const c = purchaseCost(l.ing, qty, month, costMult);
    stock = addStock(stock, l.ingredientId, qty, state.day, c / qty);
    cost += c;
  }
  const next: GameState = { ...state, stock, cash: state.cash - cost };
  return { state: next, events: [logEvent(state, `Opening stock delivered for £${Math.round(cost / 100)}.`, "money")] };
}
