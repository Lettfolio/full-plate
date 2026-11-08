/**
 * A small deterministic stand-in for sim-core's service loop, used by the demo and the tests.
 *
 * It owns a real `GameState` (sim-core types, 8 tables, a starting handful of parties and tickets) and advances it
 * one service tick every `tickSecs` of shift time. Crucially it is also the **reference implementation of how the sim
 * should treat HandsOnResults** (see docs/HANDSON-NOTES.md): `applyResults` is what PLAYER_COOKED / PLAYER_SERVED /
 * PLAYER_CLEARED / PLAYER_TOOK_PAYMENT should do inside sim-core, and the "AI colleague" rules show which jobs the
 * sim keeps doing for the roles the player is *not* playing.
 *
 * It is not the real sim (no stock, wages, reviews): just enough service rhythm to play against.
 */
import type { Customer, DishId, GameState, KitchenTicket, Table } from "@full-plate/sim-core";
import { cookMethod } from "./layout";
import { Rng } from "./rng";
import type { HandsOnResult, HandsOnRole } from "./types";

export interface FixtureDish { id: DishId; price: number; prepTicks: number; drink?: boolean }

/** Dish ids exist in @full-plate/content, so the demo gets real names and costs. */
export const FIXTURE_MENU: FixtureDish[] = [
  { id: "fish_and_chips", price: 1450, prepTicks: 6 },
  { id: "beef_burger", price: 1350, prepTicks: 5 },
  { id: "margherita", price: 1150, prepTicks: 6 },
  { id: "carbonara", price: 1250, prepTicks: 5 },
  { id: "caesar_salad", price: 950, prepTicks: 3 },
  { id: "tomato_soup", price: 645, prepTicks: 3 },
  { id: "sticky_toffee", price: 650, prepTicks: 4 },
  { id: "lemonade", price: 350, prepTicks: 1, drink: true },
  { id: "lager", price: 550, prepTicks: 1, drink: true },
  { id: "house_wine", price: 650, prepTicks: 1, drink: true },
];

const SEGMENTS = ["students", "families", "business", "foodies", "tourists"];

export interface FixtureOptions {
  seed?: number;
  /** Which role the human plays; the fixture's AI colleagues cover the rest. */
  role: HandsOnRole;
  /** Real seconds per sim tick (default 1.5 → a full 120-tick service in a 3-minute shift). */
  tickSecs?: number;
  /** Arrival pressure multiplier (default 1). */
  busy?: number;
}

export interface Fixture {
  state: GameState;
  role: HandsOnRole;
  tickSecs: number;
  busy: number;
  /** Shift seconds already turned into ticks. */
  clock: number;
  rng: number[];
  /** AI colleague timers keyed by ticket/customer/table id: tick at which they act. */
  ai: Record<string, number>;
  /** Plate qualities waiting for delivery (ticket id → 0-100). */
  plated: Record<string, number>;
  /** Cash spent on drops this shift (pence). */
  dropCost: number;
}

const QUALITY_AI = 68;

function baseState(seed: number): GameState {
  const tables: Table[] = [2, 4, 2, 4, 2, 4, 6, 2].map((seats, i) => ({ id: `t${i + 1}`, seats, dirtyTicks: 0 }));
  return {
    version: 1,
    seed,
    rngState: Rng.fromSeed(seed).getState(),
    difficulty: "normal",
    day: 3,
    tick: 30,
    phase: "service",
    restaurantName: "The Full Plate",
    districtId: "high_street",
    cash: 450000,
    loan: { principal: 0, remaining: 0, dailyPayment: 0, daysRemaining: 0 },
    reputation: { popularity: 55, prestige: 40 },
    menu: FIXTURE_MENU.map((d) => ({ dishId: d.id, price: d.price, active: true, sold7d: 0, margin7d: 0 })),
    staff: [
      { id: "s_chef", name: "Priya Singh", role: "chef", skill: 55, speed: 55, charm: 40, wage: 1300, mood: 70, fatigue: 10, traits: [], hiredDay: 0, potential: 70, rota: [true, true, true, true, true, true, true] },
      { id: "s_server", name: "Tom Kelly", role: "server", skill: 45, speed: 55, charm: 60, wage: 1271, mood: 70, fatigue: 10, traits: [], hiredDay: 0, potential: 60, rota: [true, true, true, true, true, true, true] },
      { id: "s_bar", name: "Maya Wright", role: "bar", skill: 50, speed: 50, charm: 65, wage: 1271, mood: 70, fatigue: 10, traits: [], hiredDay: 0, potential: 60, rota: [true, true, true, true, true, true, true] },
    ],
    tables,
    stock: [],
    orders: [],
    customers: [],
    tickets: [],
    todays: { reviews: [] },
    history: [],
    footfallMods: [],
    log: [],
    stats: { totalCovers: 0, totalRevenue: 0, daysOpen: 3 },
    service: {
      parties: 0, ratingSum: 0, satisfactionSum: 0, ratedCovers: 0, qualitySum: 0, plates: 0, dishes: {}, potentialParties: 60,
      arrivals: [], nextCustomer: 1, nextTicket: 1, actionsPerTick: 2, actionsLeft: 2, plateWaste: 0, walkoutParties: 0,
      serverTips: 0, ingredientsUsed: {},
      paid: [],
    },
  } as GameState;
}

/** A mid-service restaurant with ~8 tables, some guests at each stage and a handful of tickets on the rail. */
export function createFixture(opts: FixtureOptions): Fixture {
  const seed = opts.seed ?? 20261108;
  const f: Fixture = {
    state: baseState(seed), role: opts.role, tickSecs: opts.tickSecs ?? 1.5, busy: opts.busy ?? 1,
    clock: 0, rng: Rng.fromSeed(seed ^ 0x5eed).getState(), ai: {}, plated: {}, dropCost: 0,
  };
  const s = f.state;
  const rng = new Rng(f.rng);
  // T1, T2, T4, T6: ordered with tickets in flight; T3: eating; T5: paying; T8: dirty.
  const seat = (tableIdx: number, size: number, stage: Customer["stage"], order: DishId[]) => {
    const t = s.tables[tableIdx]!;
    const c = newCustomer(f, rng, size, t.id, stage, order);
    t.occupiedBy = c.id;
    s.customers.push(c);
    return c;
  };
  const c1 = seat(0, 2, "ordered", ["fish_and_chips", "lemonade"]);
  const c2 = seat(1, 3, "ordered", ["margherita", "carbonara", "lager"]);
  const c4 = seat(3, 2, "ordered", ["caesar_salad", "beef_burger"]);
  const c6 = seat(5, 2, "ordered", ["tomato_soup"]);
  const c3 = seat(2, 2, "eating", ["carbonara", "house_wine"]);
  c3.platesReady = 2; c3.qualitySum = 140; c3.servedTick = s.tick - 2; c3.eatUntil = s.tick + 8;
  const c5 = seat(4, 2, "paying", ["beef_burger", "sticky_toffee"]);
  c5.platesReady = 2; c5.qualitySum = 150; c5.servedTick = s.tick - 12;
  s.tables[7]!.dirtyTicks = 6;
  for (const c of [c1, c2, c4, c6]) fireTickets(f, c, -rng.int(0, 6));
  // one food plate already up on the pass for T2 so a server has something to carry straight away
  const up = s.tickets.find((t) => t.customerId === c2.id && !isDrink(t.dishId));
  if (up && opts.role !== "chef") { up.ticksRemaining = 0; f.plated[up.id] = QUALITY_AI; }
  f.rng = rng.getState();
  return f;
}

const isDrink = (id: DishId) => FIXTURE_MENU.find((d) => d.id === id)?.drink ?? cookMethod(id) === "pour";
const dishOf = (id: DishId) => FIXTURE_MENU.find((d) => d.id === id);

function newCustomer(f: Fixture, rng: Rng, size: number, tableId: string, stage: Customer["stage"], order: DishId[]): Customer {
  const svc = f.state.service!;
  const id = `c${svc.nextCustomer++}`;
  return {
    id, segment: rng.pick(SEGMENTS), partySize: size, arrivedTick: f.state.tick, stage, tableId, order,
    patience: 100, satisfaction: 70, spend: 0, tip: 0, stageTick: f.state.tick, platesReady: 0, qualitySum: 0,
  };
}

function fireTickets(f: Fixture, c: Customer, ageTicks = 0) {
  const svc = f.state.service!;
  for (const dishId of c.order) {
    const d = dishOf(dishId);
    const t: KitchenTicket = {
      id: `k${svc.nextTicket++}`, customerId: c.id, dishId, createdTick: f.state.tick + ageTicks,
      ticksRemaining: d?.prepTicks ?? 4, quality: 0,
    };
    // AI-cooked tickets get a chef so the rail shows who has them
    if (!aiCooks(f, dishId)) t.chefId = undefined; else t.chefId = isDrink(dishId) ? "s_bar" : "s_chef";
    f.state.tickets.push(t);
  }
}

/** Does an AI colleague cook/pour this ticket? (The human's own station never auto-completes.) */
function aiCooks(f: Fixture, dishId: DishId) {
  if (isDrink(dishId)) return f.role !== "bar";
  return f.role !== "chef";
}
/** Does an AI colleague carry plates, clear and take payment? */
const aiFront = (f: Fixture) => f.role === "chef";

// ───────────────────────── results → state (the proposed sim semantics) ─────────────────────────

/**
 * Applies the session's results to the state. This is the reference for sim-core's PLAYER_* commands:
 * - PLATE_COOKED  → the ticket is plated now with the player's quality (ticksRemaining 0). It waits on the pass for
 *                   a server (the human, or the sim's FOH) instead of teleporting to the table.
 * - TABLE_SERVED  → the plate reaches the customer: platesReady +1, qualitySum += plate quality, the ticket is
 *                   removed; patience gets a small lift scaled by speedBonus. All plates in → servedTick (eating).
 * - TABLE_CLEARED → table.dirtyTicks = 0 (free for the next party at once).
 * - PAYMENT_TAKEN → the paying party settles now (spend + tip; tip nudged by speed), stage "left".
 * - DROPPED       → cash −= cost (plate waste); any ticketIds are re-fired (back to the kitchen, fresh timer).
 */
export function applyResults(f: Fixture, results: readonly HandsOnResult[]): Fixture {
  if (!results.length) return f;
  const next: Fixture = structuredClone(f);
  const s = next.state;
  for (const r of results) {
    switch (r.type) {
      case "PLATE_COOKED": {
        const t = s.tickets.find((x) => x.id === r.ticketId);
        if (!t) break;
        t.ticksRemaining = 0;
        t.quality = r.quality;
        next.plated[t.id] = r.quality;
        // in chef mode the AI server collects after a short beat
        if (aiFront(next)) next.ai[`carry:${t.id}`] = s.tick + 2;
        break;
      }
      case "TABLE_SERVED": {
        const i = s.tickets.findIndex((x) => x.id === r.ticketId);
        if (i < 0) break;
        const t = s.tickets[i]!;
        s.tickets.splice(i, 1);
        deliver(next, t, next.plated[t.id] ?? t.quality ?? QUALITY_AI, r.speedBonus);
        delete next.plated[t.id];
        break;
      }
      case "TABLE_CLEARED": {
        const t = s.tables.find((x) => x.id === r.tableId);
        if (t && !t.occupiedBy) t.dirtyTicks = 0;
        break;
      }
      case "PAYMENT_TAKEN": {
        const c = s.customers.find((x) => x.id === r.customerId);
        if (c && c.stage === "paying") settle(next, c, 1);
        break;
      }
      case "DROPPED": {
        s.cash -= r.cost;
        next.dropCost += r.cost;
        s.service!.plateWaste += r.cost;
        for (const id of r.ticketIds ?? []) {
          const t = s.tickets.find((x) => x.id === id);
          if (!t) continue;
          t.ticksRemaining = dishOf(t.dishId)?.prepTicks ?? 4;
          t.quality = 0;
          delete next.plated[t.id];
          t.chefId = aiCooks(next, t.dishId) ? (isDrink(t.dishId) ? "s_bar" : "s_chef") : undefined;
        }
        break;
      }
    }
  }
  return next;
}

function deliver(f: Fixture, t: KitchenTicket, quality: number, speedBonus: number) {
  const c = f.state.customers.find((x) => x.id === t.customerId);
  if (!c) return;
  c.platesReady = (c.platesReady ?? 0) + 1;
  c.qualitySum = (c.qualitySum ?? 0) + quality;
  c.patience = Math.min(100, c.patience + 4 + 8 * speedBonus);
  const svc = f.state.service!;
  svc.plates++;
  svc.qualitySum += quality;
  if (c.platesReady >= c.order.length) {
    c.servedTick = f.state.tick;
    c.stage = "eating";
    c.stageTick = f.state.tick;
    c.eatUntil = f.state.tick + 8 + c.partySize * 2;
  }
}

function settle(f: Fixture, c: Customer, tipMult: number) {
  const s = f.state;
  const spend = c.order.reduce((sum, id) => sum + (dishOf(id)?.price ?? 900), 0);
  const q = (c.qualitySum ?? 0) / Math.max(1, c.platesReady ?? 1);
  const tip = Math.round(spend * (0.04 + 0.08 * (q / 100)) * tipMult * (0.6 + 0.4 * (c.patience / 100)));
  c.spend = spend; c.tip = tip; c.stage = "left"; c.leftTick = s.tick; c.rating = q > 75 ? 5 : q > 60 ? 4 : 3;
  s.cash += spend;
  s.stats.totalRevenue += spend;
  s.stats.totalCovers += c.partySize;
  s.service!.serverTips += tip;
  const table = s.tables.find((t) => t.id === c.tableId);
  if (table) { table.occupiedBy = undefined; table.dirtyTicks = 10; }
  if (aiFront(f) && table) f.ai[`clear:${table.id}`] = s.tick + 3;
  else if (table) f.ai[`clear:${table.id}`] = s.tick + 30; // a porter gets there eventually
}

// ───────────────────────── advancing time ─────────────────────────

/** Advance the fixture by `dt` seconds of shift time (ticks happen every tickSecs). Deterministic. */
export function advanceFixture(f: Fixture, dt: number): Fixture {
  const clock = f.clock + dt;
  const ticks = Math.floor(clock / f.tickSecs) - Math.floor(f.clock / f.tickSecs);
  if (ticks <= 0) return { ...f, clock };
  let next: Fixture = structuredClone(f);
  next.clock = clock;
  for (let i = 0; i < ticks; i++) next = tickFixture(next);
  return next;
}

function tickFixture(f: Fixture): Fixture {
  const s = f.state;
  const rng = new Rng(f.rng);
  s.tick++;
  // 1. AI kitchen/bar: count down tickets they own
  for (const t of s.tickets) {
    if (t.ticksRemaining > 0 && t.chefId) {
      t.ticksRemaining--;
      if (t.ticksRemaining <= 0) {
        f.plated[t.id] = QUALITY_AI + rng.int(-6, 6);
        if (aiFront(f) || (isDrink(t.dishId) && f.role === "bar")) f.ai[`carry:${t.id}`] = s.tick + 2;
      }
    }
  }
  // 2. AI front of house: carry plates
  for (const [key, at] of Object.entries(f.ai)) {
    if (at > s.tick) continue;
    const [kind, id] = key.split(":") as [string, string];
    if (kind === "carry") {
      const i = s.tickets.findIndex((t) => t.id === id && t.ticksRemaining <= 0);
      if (i >= 0) { const t = s.tickets[i]!; s.tickets.splice(i, 1); deliver(f, t, f.plated[t.id] ?? QUALITY_AI, 0.5); delete f.plated[t.id]; }
      delete f.ai[key];
    } else if (kind === "clear") {
      const t = s.tables.find((x) => x.id === id);
      if (t && !t.occupiedBy) t.dirtyTicks = 0;
      delete f.ai[key];
    } else if (kind === "pay") {
      const c = s.customers.find((x) => x.id === id);
      if (c?.stage === "paying") settle(f, c, aiFront(f) ? 1 : 0.5);
      delete f.ai[key];
    } else if (kind === "order") {
      const c = s.customers.find((x) => x.id === id);
      if (c?.stage === "seated") { c.stage = "ordered"; c.stageTick = s.tick; fireTickets(f, c); }
      delete f.ai[key];
    }
  }
  // 3. customers: eating → paying; waiting patience; leaving
  for (const c of s.customers) {
    if (c.stage === "eating" && s.tick >= (c.eatUntil ?? s.tick)) {
      c.stage = "paying"; c.stageTick = s.tick;
      f.ai[`pay:${c.id}`] = s.tick + (aiFront(f) ? 3 : 14); // the manager takes it if nobody does
    }
    if (c.stage === "ordered" || c.stage === "seated") {
      c.patience = Math.max(0, c.patience - 0.55);
      if (c.patience <= 0) walkOut(f, c);
    }
    if (c.stage === "paying") c.patience = Math.max(0, c.patience - 0.8);
  }
  s.customers = s.customers.filter((c) => c.stage !== "left" || s.tick - (c.leftTick ?? s.tick) < 1);
  // 4. arrivals: seat a party at a clean free table (busier mid-shift)
  const free = s.tables.filter((t) => !t.occupiedBy && t.dirtyTicks <= 0);
  const curve = 0.18 + 0.14 * Math.sin(Math.PI * Math.min(1, Math.max(0, (s.tick - 30) / 120)));
  if (free.length && s.tick < 146 && rng.chance(curve * f.busy)) {
    const t = rng.pick(free);
    const size = Math.max(1, Math.min(t.seats, rng.int(1, 4)));
    const food = FIXTURE_MENU.filter((d) => !d.drink);
    const drinks = FIXTURE_MENU.filter((d) => d.drink);
    const order: DishId[] = [];
    const plates = Math.min(3, size);
    for (let k = 0; k < plates; k++) order.push(rng.pick(food).id);
    if (rng.chance(0.6)) order.push(rng.pick(drinks).id);
    const c = newCustomer(f, rng, size, t.id, "seated", order);
    t.occupiedBy = c.id;
    s.customers.push(c);
    f.ai[`order:${c.id}`] = s.tick + rng.int(2, 3);
    s.service!.parties++;
  }
  f.rng = rng.getState();
  return f;
}

function walkOut(f: Fixture, c: Customer) {
  const s = f.state;
  c.stage = "left"; c.walkedOut = true; c.leftTick = s.tick;
  s.tickets = s.tickets.filter((t) => t.customerId !== c.id);
  s.service!.walkoutParties++;
  const table = s.tables.find((t) => t.id === c.tableId);
  if (table) { table.occupiedBy = undefined; table.dirtyTicks = 0; }
}
