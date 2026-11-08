/** FIFO stock helpers. Stock rows keep `batches` (oldest first); `qty` and `oldestDay` mirror them. */
import {
  FRESH_BONUS_MAX,
  FRESH_PENALTY_MAX,
  IN_SEASON_COST_MULT,
  IN_SEASON_QUALITY_BONUS,
} from "./constants";
import type { ContentPack, DishDef, IngredientDef, IngredientId, Stock } from "./types";
import { findIngredient, isInSeason } from "./util";

/** Rounds stock quantities so float dust never accumulates in saves. */
const q3 = (x: number): number => Math.round(x * 1000) / 1000;

type Batch = { qty: number; day: number };

function batchesOf(row: Stock): Batch[] {
  return row.batches ?? (row.qty > 0 ? [{ qty: row.qty, day: row.oldestDay }] : []);
}

function rowFrom(ingredientId: IngredientId, batches: Batch[], fallbackDay: number): Stock {
  const live = batches.filter((b) => b.qty > 0);
  return {
    ingredientId,
    qty: q3(live.reduce((a, b) => a + b.qty, 0)),
    oldestDay: live[0]?.day ?? fallbackDay,
    batches: live,
  };
}

export function stockQty(stock: readonly Stock[], id: IngredientId): number {
  for (const s of stock) if (s.ingredientId === id) return s.qty;
  return 0;
}

/** Adds a delivered batch. Returns a new stock array. */
export function addStock(stock: readonly Stock[], id: IngredientId, qty: number, day: number): Stock[] {
  if (qty <= 0) return stock.slice();
  const i = stock.findIndex((s) => s.ingredientId === id);
  if (i < 0) return [...stock, rowFrom(id, [{ qty: q3(qty), day }], day)];
  const out = stock.slice();
  const row = stock[i]!;
  out[i] = rowFrom(id, [...batchesOf(row), { qty: q3(qty), day }], day);
  return out;
}

export interface Consumed {
  stock: Stock[];
  /** Quantity actually removed (≤ requested). */
  taken: number;
  /** Quantity-weighted mean age in days of what was removed. */
  meanAge: number;
}

/** Removes up to `qty` oldest-first. */
export function takeStock(stock: readonly Stock[], id: IngredientId, qty: number, day: number): Consumed {
  const i = stock.findIndex((s) => s.ingredientId === id);
  if (i < 0 || qty <= 0) return { stock: stock as Stock[], taken: 0, meanAge: 0 };
  const row = stock[i]!;
  let need = qty;
  let ageSum = 0;
  const batches: Batch[] = [];
  for (const b of batchesOf(row)) {
    const use = Math.min(b.qty, need);
    need -= use;
    ageSum += use * (day - b.day);
    if (b.qty - use > 1e-9) batches.push({ qty: q3(b.qty - use), day: b.day });
  }
  const taken = qty - need;
  const out = stock.slice();
  out[i] = rowFrom(id, batches, row.oldestDay);
  return { stock: out, taken: q3(taken), meanAge: taken > 0 ? ageSum / taken : 0 };
}

/** Removes batches whose shelf life has run out by `day`. Returns the new stock and portions binned per ingredient. */
export function spoil(
  content: ContentPack,
  stock: readonly Stock[],
  day: number,
): { stock: Stock[]; binned: { id: IngredientId; qty: number }[] } {
  const binned: { id: IngredientId; qty: number }[] = [];
  const out = stock.map((row) => {
    const life = findIngredient(content, row.ingredientId)?.shelfLifeDays ?? Infinity;
    const all = batchesOf(row);
    const keep = all.filter((b) => b.day + life > day);
    if (keep.length === all.length) return row;
    const lost = all.reduce((a, b) => a + b.qty, 0) - keep.reduce((a, b) => a + b.qty, 0);
    binned.push({ id: row.ingredientId, qty: q3(lost) });
    return rowFrom(row.ingredientId, keep, row.oldestDay);
  });
  return { stock: out, binned };
}

/** True when there is enough stock to plate one portion of the dish. */
export function canPlate(stock: readonly Stock[], dish: DishDef): boolean {
  for (const ing of dish.ingredients) if (stockQty(stock, ing.id) + 1e-9 < ing.qty) return false;
  return true;
}

/** Freshness score for one ingredient portion: fresh ⇒ +FRESH_BONUS_MAX, at shelf life ⇒ −FRESH_PENALTY_MAX, plus a seasonal bonus. */
export function freshnessScore(ing: IngredientDef | undefined, meanAge: number, month: number): number {
  if (!ing) return 0;
  const life = Math.max(1, ing.shelfLifeDays);
  const t = Math.min(1, meanAge / life);
  const fresh = FRESH_BONUS_MAX - (FRESH_BONUS_MAX + FRESH_PENALTY_MAX) * t;
  return fresh + (isInSeason(ing, month) ? IN_SEASON_QUALITY_BONUS : 0);
}

export interface Plated {
  stock: Stock[];
  freshness: number;
  /** Base ingredient cost of what was used (pence, rounded). */
  cost: number;
}

/** Consumes one portion of a dish. Caller must check canPlate first. */
export function consumeDish(
  content: ContentPack,
  stock: readonly Stock[],
  dish: DishDef,
  day: number,
  month: number,
): Plated {
  let cur = stock as Stock[];
  let fresh = 0;
  let cost = 0;
  for (const ing of dish.ingredients) {
    const def = findIngredient(content, ing.id);
    const r = takeStock(cur, ing.id, ing.qty, day);
    cur = r.stock;
    fresh += freshnessScore(def, r.meanAge, month);
    cost += (def?.unitCost ?? 0) * ing.qty;
  }
  const n = Math.max(1, dish.ingredients.length);
  return { stock: cur, freshness: fresh / n, cost: Math.round(cost) };
}

/** Purchase price of `qty` portions in a given month (in-season discount, difficulty cost multiplier). */
export function purchaseCost(ing: IngredientDef, qty: number, month: number, costMult: number): number {
  const season = isInSeason(ing, month) ? IN_SEASON_COST_MULT : 1;
  return Math.round(ing.unitCost * qty * season * costMult);
}
