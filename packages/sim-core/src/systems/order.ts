/**
 * OrderSystem — servers take orders from seated parties who have read the menu.
 * Each guest picks one main (or any dish if there are no mains) plus optional other courses.
 * Ordering fires kitchen tickets and consumes stock immediately; a dish that runs out is 86'd.
 */
import {
  COURSE_ORDER_CHANCE,
  MENU_READ_TICKS,
  MIN_DISH_WEIGHT,
  ORDER_ACTION_COST,
  ORDER_PRICE_CLAMP,
  OUT_OF_STOCK_PATIENCE_HIT,
  SET_MENU_SEGMENTS,
} from "../constants";
import type { Rng } from "../rng";
import { canPlate, consumeDish, stockQty } from "../stock";
import type {
  ContentPack,
  Customer,
  DishDef,
  GameState,
  KitchenTicket,
  SegmentDef,
  ServiceTally,
  SimEvent,
} from "../types";
import { clamp, findSegment, logEvent, monthOf, tallyOf } from "../util";
import { offeredDishes, planArrivals, setOfferFor } from "./arrival";
import type { SystemResult } from "./system";
import { decorEffects } from "../decor";

type Offered = ReturnType<typeof offeredDishes>[number];

/** Relative chance a guest of this segment picks the dish: appeal × price acceptance. */
export function dishWeight(o: Offered, seg: SegmentDef): number {
  const appeal = o.dish.baseAppeal[seg.id] ?? 0;
  const suggested = Math.max(1, o.dish.suggestedPrice);
  const [lo, hi] = ORDER_PRICE_CLAMP;
  const over = clamp((o.item.price - suggested) / suggested, lo, hi);
  return Math.max(MIN_DISH_WEIGHT, appeal * (1 - seg.priceSensitivity * over));
}

const coursePools = new WeakMap<readonly Offered[], Map<string, Offered[]>>();

/** Offered dishes grouped by course (memoised per offered list). */
function byCourse(offered: readonly Offered[]): Map<string, Offered[]> {
  let pools = coursePools.get(offered);
  if (!pools) {
    pools = new Map();
    for (const o of offered) pools.set(o.dish.course, [...(pools.get(o.dish.course) ?? []), o]);
    coursePools.set(offered, pools);
  }
  return pools;
}

/** Picks the dishes one guest wants (before stock is checked). */
/** `boost` (round 10, decor spend): each extra course's order chance × (1 + boost/100), capped at 1. */
export function chooseForGuest(rng: Rng, offered: readonly Offered[], seg: SegmentDef, boost = 0): Offered[] {
  const pools = byCourse(offered);
  const mains = pools.get("main") ?? [];
  const firstPool = mains.length ? mains : offered;
  const first = rng.weighted(firstPool, firstPool.map((o) => dishWeight(o, seg)));
  const picks = first ? [first] : [];
  if (!mains.length) return picks;
  for (const course of Object.keys(COURSE_ORDER_CHANCE)) {
    const pool = pools.get(course);
    const p = COURSE_ORDER_CHANCE[course] ?? 0;
    if (!pool || !rng.chance(boost ? Math.min(1, p * (1 + boost / 100)) : p)) continue;
    const pick = rng.weighted(pool, pool.map((o) => dishWeight(o, seg)));
    if (pick) picks.push(pick);
  }
  return picks;
}

/** Scratch builder for one OrderSystem run; reassigned fields are fresh objects, inputs are never mutated. */
export interface Kitchen {
  state: GameState;
  /** Stock as it is consumed (written back to state once at the end). */
  stock: GameState["stock"];
  /** Running tallies for this run. */
  nextTicket: number;
  foodCost: number;
  tally: ServiceTally;
  tickets: KitchenTicket[];
  events: SimEvent[];
  /** Dishes currently on offer; refreshed when a dish is 86'd. */
  offered: Offered[];
  /** Ingredient usage for this run (copied from the tally once). */
  used: Record<string, number>;
  /** [round 3] Stock cost of plates fired this run, per dish (merged into tally.dishes[].foodCost at the end). */
  dishCost?: Record<string, number>;
}

/** Fires one plate: consumes stock, books cost and creates the ticket. Returns the pence paid for it, or undefined when out of stock. */
export function firePlate(content: ContentPack, k: Kitchen, c: Customer, dish: DishDef): number | undefined {
  if (!canPlate(k.stock, dish)) return undefined;
  const used = consumeDish(content, k.stock, dish, k.state.day, monthOf(k.state.day));
  k.stock = used.stock;
  for (const ing of dish.ingredients) k.used[ing.id] = (k.used[ing.id] ?? 0) + ing.qty;
  k.nextTicket++;
  k.foodCost += used.cost;
  if (k.dishCost) k.dishCost[dish.id] = (k.dishCost[dish.id] ?? 0) + used.cost;
  k.tickets.push({
    id: `t${k.state.day}-${k.nextTicket}`,
    customerId: c.id,
    dishId: dish.id,
    createdTick: k.state.tick,
    ticksRemaining: dish.prepTicks,
    quality: 0,
    freshness: used.freshness,
  });
  return used.cost;
}

/** Marks a dish as 86'd for the rest of the day and re-plans arrivals for the smaller menu. */
function pullDish(content: ContentPack, k: Kitchen, dish: DishDef): void {
  if ((k.state.eightySixed ?? []).includes(dish.id)) return;
  k.state = { ...k.state, stock: k.stock, eightySixed: [...(k.state.eightySixed ?? []), dish.id] };
  k.tally = { ...k.tally, arrivals: planArrivals(content, k.state) };
  k.offered = offeredDishes(content, k.state);
  k.events.push(logEvent(k.state, `${dish.name} has run out — 86'd for today.`, "bad"));
}

/** The active set menu's dishes, when this segment orders it (GameState.setMenu; round 3). */
export function setMenuFor(content: ContentPack, state: GameState, segId: string): readonly DishDef[] | undefined {
  return setOfferFor(content, state, segId)?.dishes;
}

/** Stock covers every set dish for every guest in the party (checked before any plate is fired). */
function canPlateSet(stock: GameState["stock"], dishes: readonly DishDef[], guests: number): boolean {
  const need = new Map<string, number>();
  for (const d of dishes) for (const ing of d.ingredients) need.set(ing.id, (need.get(ing.id) ?? 0) + ing.qty * guests);
  for (const [id, qty] of need) if (stockQty(stock, id) + 1e-9 < qty) return false;
  return true;
}

/** A set-menu party: every guest gets every set dish (fired at once), for setMenu.price per head. */
function takeSetOrder(content: ContentPack, k: Kitchen, c: Customer, dishes: readonly DishDef[]): Customer {
  const order: string[] = [];
  let foodCost = 0;
  for (let g = 0; g < c.partySize; g++) {
    for (const d of dishes) {
      const cost = firePlate(content, k, c, d);
      if (cost === undefined) continue;
      order.push(d.id);
      foodCost += cost;
    }
  }
  const price = k.state.setMenu?.price ?? 0;
  return { ...c, stage: "ordered", order, spend: price * c.partySize, foodCost: Math.round(foodCost), setMenu: true, stageTick: k.state.tick };
}

/** Takes one party's order. Returns the updated customer (or a walk-out if nothing could be served). */
function takeOrder(content: ContentPack, k: Kitchen, c: Customer, seg: SegmentDef, rng: Rng): Customer {
  const set = setMenuFor(content, k.state, seg.id);
  // Round 3: foodies and business guests take the set menu when one is on and the larder can do it for them all;
  // otherwise they order à la carte as usual.
  if (set && canPlateSet(k.stock, set, c.partySize)) return takeSetOrder(content, k, c, set);
  const order: string[] = [];
  let spend = 0;
  let foodCost = 0;
  let patience = c.patience;
  for (let g = 0; g < c.partySize; g++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const picks = chooseForGuest(rng, k.offered, seg, decorEffects(content, k.state).spend);
      const missing = picks.find((p) => !canPlate(k.stock, p.dish));
      if (missing) {
        pullDish(content, k, missing.dish);
        patience -= OUT_OF_STOCK_PATIENCE_HIT;
        continue;
      }
      for (const p of picks) {
        const cost = firePlate(content, k, c, p.dish);
        if (cost === undefined) continue; // two picks sharing a scarce ingredient
        order.push(p.dish.id);
        spend += p.item.price;
        foodCost += cost;
      }
      break;
    }
  }
  return { ...c, stage: "ordered", order, spend, foodCost: Math.round(foodCost), patience, stageTick: k.state.tick };
}

/** Adds per-dish stock cost into the tally's dish lines (same object when nothing was fired). */
export function addDishCost(dishes: ServiceTally["dishes"], cost: Record<string, number> | undefined): ServiceTally["dishes"] {
  if (!cost) return dishes;
  const ids = Object.keys(cost);
  if (ids.length === 0) return dishes;
  const out = { ...dishes };
  for (const id of ids) {
    const d = out[id] ?? { sold: 0, plated: 0, qualitySum: 0, margin: 0 };
    out[id] = { ...d, foodCost: (d.foodCost ?? 0) + cost[id]! };
  }
  return out;
}

export function orderSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const ready = state.customers.filter(
    (c) => c.stage === "seated" && state.tick - (c.stageTick ?? c.arrivedTick) >= MENU_READ_TICKS,
  );
  if (ready.length === 0) return { state, events: [] };
  const tally = tallyOf(state);
  const k: Kitchen = {
    state,
    stock: state.stock,
    nextTicket: tally.nextTicket,
    foodCost: tally.foodCost ?? 0,
    tally,
    tickets: [],
    events: [],
    offered: offeredDishes(content, state),
    used: { ...tally.ingredientsUsed },
    dishCost: {},
  };
  let actions = k.tally.actionsLeft;
  const updated = new Map<string, Customer>();
  for (const c of ready) {
    if (actions < ORDER_ACTION_COST) break;
    const seg = findSegment(content, c.segment);
    if (!seg) continue;
    actions -= ORDER_ACTION_COST;
    const next = takeOrder(content, k, c, seg, rng);
    // Nothing could be served: patience hits zero and ServiceSystem walks them out.
    updated.set(c.id, next.order.length ? next : { ...next, patience: 0 });
  }
  const customers = state.customers.map((c) => updated.get(c.id) ?? c);
  const dishes = addDishCost(k.tally.dishes, k.dishCost);
  return {
    state: {
      ...k.state,
      stock: k.stock,
      customers,
      tickets: state.tickets.concat(k.tickets),
      service: { ...k.tally, dishes, nextTicket: k.nextTicket, foodCost: k.foodCost, ingredientsUsed: k.used, actionsLeft: actions },
    },
    events: k.events,
  };
}
