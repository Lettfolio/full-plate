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
} from "../constants";
import type { Rng } from "../rng";
import { canPlate, consumeDish } from "../stock";
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
import { clamp, findSegment, logEvent, monthOf, plateCost, tallyOf } from "../util";
import { offeredDishes, planArrivals } from "./arrival";
import type { SystemResult } from "./system";

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
export function chooseForGuest(rng: Rng, offered: readonly Offered[], seg: SegmentDef): Offered[] {
  const pools = byCourse(offered);
  const mains = pools.get("main") ?? [];
  const firstPool = mains.length ? mains : offered;
  const first = rng.weighted(firstPool, firstPool.map((o) => dishWeight(o, seg)));
  const picks = first ? [first] : [];
  if (!mains.length) return picks;
  for (const course of Object.keys(COURSE_ORDER_CHANCE)) {
    const pool = pools.get(course);
    if (!pool || !rng.chance(COURSE_ORDER_CHANCE[course] ?? 0)) continue;
    const pick = rng.weighted(pool, pool.map((o) => dishWeight(o, seg)));
    if (pick) picks.push(pick);
  }
  return picks;
}

/** Scratch builder for one OrderSystem run; reassigned fields are fresh objects, inputs are never mutated. */
interface Kitchen {
  state: GameState;
  tally: ServiceTally;
  tickets: KitchenTicket[];
  events: SimEvent[];
  /** Dishes currently on offer; refreshed when a dish is 86'd. */
  offered: Offered[];
  /** Ingredient usage for this run (copied from the tally once). */
  used: Record<string, number>;
}

/** Fires one plate: consumes stock, books cost and creates the ticket. Returns false when out of stock. */
function firePlate(content: ContentPack, k: Kitchen, c: Customer, dish: DishDef): boolean {
  if (!canPlate(k.state.stock, dish)) return false;
  const used = consumeDish(content, k.state.stock, dish, k.state.day, monthOf(k.state.day));
  k.state = { ...k.state, stock: used.stock };
  for (const ing of dish.ingredients) k.used[ing.id] = (k.used[ing.id] ?? 0) + ing.qty;
  k.tally = { ...k.tally, nextTicket: k.tally.nextTicket + 1 };
  k.tickets.push({
    id: `t${k.state.day}-${k.tally.nextTicket}`,
    customerId: c.id,
    dishId: dish.id,
    createdTick: k.state.tick,
    ticksRemaining: dish.prepTicks,
    quality: 0,
    freshness: used.freshness,
  });
  return true;
}

/** Marks a dish as 86'd for the rest of the day and re-plans arrivals for the smaller menu. */
function pullDish(content: ContentPack, k: Kitchen, dish: DishDef): void {
  if ((k.state.eightySixed ?? []).includes(dish.id)) return;
  k.state = { ...k.state, eightySixed: [...(k.state.eightySixed ?? []), dish.id] };
  k.tally = { ...k.tally, arrivals: planArrivals(content, k.state) };
  k.offered = offeredDishes(content, k.state);
  k.events.push(logEvent(k.state, `${dish.name} has run out — 86'd for today.`, "bad"));
}

/** Takes one party's order. Returns the updated customer (or a walk-out if nothing could be served). */
function takeOrder(content: ContentPack, k: Kitchen, c: Customer, seg: SegmentDef, rng: Rng): Customer {
  const order: string[] = [];
  let spend = 0;
  let foodCost = 0;
  let patience = c.patience;
  for (let g = 0; g < c.partySize; g++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const picks = chooseForGuest(rng, k.offered, seg);
      const missing = picks.find((p) => !canPlate(k.state.stock, p.dish));
      if (missing) {
        pullDish(content, k, missing.dish);
        patience -= OUT_OF_STOCK_PATIENCE_HIT;
        continue;
      }
      for (const p of picks) {
        firePlate(content, k, c, p.dish);
        order.push(p.dish.id);
        spend += p.item.price;
        foodCost += plateCost(content, p.dish);
      }
      break;
    }
  }
  return { ...c, stage: "ordered", order, spend, foodCost, patience, stageTick: k.state.tick };
}

export function orderSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const ready = state.customers.filter(
    (c) => c.stage === "seated" && state.tick - (c.stageTick ?? c.arrivedTick) >= MENU_READ_TICKS,
  );
  if (ready.length === 0) return { state, events: [] };
  const tally = tallyOf(state);
  const k: Kitchen = { state, tally, tickets: [], events: [], offered: offeredDishes(content, state), used: { ...tally.ingredientsUsed } };
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
  return {
    state: {
      ...k.state,
      customers,
      tickets: state.tickets.concat(k.tickets),
      service: { ...k.tally, ingredientsUsed: k.used, actionsLeft: actions },
    },
    events: k.events,
  };
}
