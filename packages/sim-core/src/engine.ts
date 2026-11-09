/**
 * Engine — runs the per-tick service pipeline and the evening pipeline, and moves the
 * day through its phases: planning → service → evening|event → (END_DAY|RESOLVE_EVENT) → planning.
 */
import { SHORT_DELIVERY_CHANCE, SHORT_DELIVERY_SHARE } from "./constants";
import { buyOpeningStock } from "./forecast";
import { incidentLinesOf } from "./contentText";
import { fill } from "./incidents/text";
import { hashSeed, Rng } from "./rng";
import { addStock, canPlate } from "./stock";
import { arrivalSystem, planArrivals } from "./systems/arrival";
import { clearingSystem } from "./systems/clearing";
import { eventDeckSystem } from "./systems/eventDeck";
import { checkSolvency, financeSystem } from "./systems/finance";
import { goalSystem } from "./systems/goals";
import { closeIncidents, floorSystem, incidentSystem } from "./systems/incidents";
import { deliverPlate, kitchenSystem } from "./systems/kitchen";
import { orderSystem } from "./systems/order";
import { payParties, paymentSystem } from "./systems/payment";
import { reputationSystem } from "./systems/reputation";
import { seatingSystem } from "./systems/seating";
import { serviceSystem } from "./systems/service";
import { staffMoodSystem } from "./systems/staffMood";
import { statsSystem, buildDayResult } from "./systems/stats";
import { coveringRoles, frontCharm, serverActionsPerTick, type System, type SystemResult } from "./systems/system";
import { wasteSystem } from "./systems/waste";
import type { ContentPack, Customer, GameState, SimEvent, StepResult, Table } from "./types";
import { SERVICE_TICKS } from "./types";
import { emptyTally, findDish, findIngredient, foldLog, logEvent, tallyOf } from "./util";

/** Per-tick order from ARCHITECTURE.md (LogSystem = foldLog at the end of each step). */
export const SERVICE_SYSTEMS: readonly System[] = [
  floorSystem, // round 2: breaks end, incident modifiers expire
  arrivalSystem,
  seatingSystem,
  orderSystem,
  kitchenSystem,
  serviceSystem,
  incidentSystem, // round 2: incidents count down, time out, start
  paymentSystem,
  clearingSystem,
];

/** Evening order from ARCHITECTURE.md; solvency is checked straight after finance. */
export const EVENING_SYSTEMS: readonly System[] = [
  financeSystem,
  (c, s) => checkSolvency(c, s),
  wasteSystem,
  reputationSystem,
  staffMoodSystem,
  eventDeckSystem,
  statsSystem,
  (c, s) => goalSystem(c, s),
];

export function runSystems(content: ContentPack, state: GameState, systems: readonly System[], rng: Rng): SystemResult {
  let cur = state;
  const events: SimEvent[] = [];
  for (const sys of systems) {
    const r = sys(content, cur, rng);
    cur = r.state;
    for (const e of r.events) events.push(e);
  }
  return { state: cur, events };
}

/** Runs `fn` with an Rng restored from state, then stores the advanced RNG state and folds logs. */
export function withRng(state: GameState, fn: (rng: Rng) => SystemResult): StepResult {
  const rng = new Rng(state.rngState);
  const r = fn(rng);
  return { state: foldLog({ ...r.state, rngState: rng.getState() }, r.events), events: r.events };
}

// ── service open/close ──

/** Active dishes that cannot be plated from current stock are 86'd before doors open. */
function autoEightySix(content: ContentPack, state: GameState): { pulled: string[]; events: SimEvent[] } {
  const pulled = [...(state.eightySixed ?? [])];
  const events: SimEvent[] = [];
  for (const m of state.menu) {
    const dish = findDish(content, m.dishId);
    if (!m.active || !dish || pulled.includes(dish.id) || canPlate(state.stock, dish)) continue;
    pulled.push(dish.id);
    events.push(logEvent(state, `No stock for ${dish.name} — 86'd for today.`, "bad"));
  }
  return { pulled, events };
}

/**
 * Rebuilds the state with every field in one fixed order (absent optionals as undefined, which serialize drops).
 * Service runs ~120 ticks × 9 systems of `{ ...state, x }` copies; a single object shape keeps V8's property
 * access monomorphic. Optional fields that come and go (shortDelivery, activeEvent, …) otherwise multiply shapes.
 */
export function canonicalState(s: GameState): GameState {
  // Typed as every key of GameState (optional ones included): a field added to GameState but not listed here is a
  // compile error instead of being silently dropped on the first service tick.
  const out: { [K in keyof Required<GameState>]: GameState[K] } = {
    version: s.version, seed: s.seed, rngState: s.rngState, difficulty: s.difficulty, day: s.day, tick: s.tick, phase: s.phase,
    restaurantName: s.restaurantName, districtId: s.districtId, cash: s.cash, loan: s.loan, reputation: s.reputation,
    menu: s.menu, staff: s.staff, tables: s.tables, stock: s.stock, orders: s.orders, customers: s.customers, tickets: s.tickets,
    todays: s.todays, history: s.history, activeEvent: s.activeEvent, footfallMods: s.footfallMods, log: s.log, stats: s.stats,
    eightySixed: s.eightySixed, hiredCandidates: s.hiredCandidates, distressDays: s.distressDays, service: s.service,
    eventHistory: s.eventHistory, gameOverReason: s.gameOverReason, incidents: s.incidents, goals: s.goals,
    ownerCovering: s.ownerCovering, ownerFatigue: s.ownerFatigue, shortDelivery: s.shortDelivery, incidentsHandled: s.incidentsHandled,
    handsOn: s.handsOn, setMenu: s.setMenu, ownerProfile: s.ownerProfile, recruitmentFee: s.recruitmentFee,
  };
  return out;
}

/** The first service of a new game buys its opening stock (newGame starts with an empty larder). */
/** (Round 3: days shut with CLOSE_TODAY before the first service don't count, so the opening stock is still bought.) */
export const isFirstService = (state: GameState): boolean =>
  state.stats.daysOpen === 0 && state.history.every((h) => h.closed === true) && (state.day === 0 || state.history.length > 0);

export function openService(content: ContentPack, state: GameState): StepResult {
  const opening = isFirstService(state) ? buyOpeningStock(content, state) : { state, events: [] };
  const auto = autoEightySix(content, opening.state);
  const base: GameState = {
    ...opening.state,
    eightySixed: auto.pulled,
    phase: "service",
    tick: 0,
    customers: [],
    tickets: [],
    incidents: [],
    todays: { reviews: [] },
  };
  const covering = coveringRoles(base);
  const withOwner: GameState = { ...base, ownerCovering: covering };
  const tally = {
    ...emptyTally(),
    arrivals: planArrivals(content, withOwner),
    actionsPerTick: serverActionsPerTick(content, withOwner),
    frontCharm: frontCharm(content, withOwner),
  };
  tally.potentialParties = Math.round(tally.arrivals.reduce((a, p) => a + p.potentialParties, 0));
  const events = [...opening.events, ...auto.events];
  if (covering.length) {
    const what = covering.length === 2 ? "cooking AND serving" : covering[0] === "chef" ? "cooking" : "serving";
    events.push(logEvent(base, `Nobody else is on today, so you're ${what} yourself.`, "bad"));
  }
  return { state: canonicalState({ ...withOwner, service: tally }), events };
}

const ALL_ACTIONS = 1e6;

/** At close: eating and paying parties settle their bill; anyone still waiting for food walks out; the queue is turned away. */
export function settleAtClose(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  // Round 3: plates still held at the pass (hands-on) go out first.
  const held = state.tickets.filter((t) => t.atPass);
  const served = held.length
    ? state.customers.map((c) => held.filter((t) => t.customerId === c.id).reduce((acc, t) => deliverPlate(acc, t.quality, state.tick, t.remakeOf), c))
    : state.customers;
  const ready = served.map((c): Customer =>
    c.stage === "eating" || (c.stage === "ordered" && c.servedTick !== undefined) ? { ...c, stage: "paying" } : c,
  );
  const tally = tallyOf(state);
  const paid = payParties(content, { ...state, customers: ready, service: { ...tally, actionsLeft: ALL_ACTIONS } }, rng, true);
  let walkoutCovers = 0;
  let walkoutParties = 0;
  for (const c of paid.state.customers) {
    if (c.stage === "seated" || c.stage === "ordered") {
      walkoutCovers += c.partySize;
      walkoutParties++;
    }
  }
  const s = paid.state;
  const tables: Table[] = s.tables.map(({ occupiedBy: _o, ...t }) => ({ ...t, dirtyTicks: 0 }));
  const events = [...paid.events];
  if (walkoutParties) events.push(logEvent(s, `Closing time: ${walkoutParties} part${walkoutParties === 1 ? "y" : "ies"} left without food.`, "bad"));
  return {
    state: {
      ...s,
      customers: [],
      tickets: [],
      tables,
      todays: { ...s.todays, walkouts: (s.todays.walkouts ?? 0) + walkoutCovers },
      service: { ...tallyOf(s), actionsLeft: 0, walkoutParties: tallyOf(s).walkoutParties + walkoutParties },
    },
    events,
  };
}

/** Closes service, runs the evening systems and emits SERVICE_ENDED. */
export function closeService(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const quiet = closeIncidents(state, content);
  const settled = settleAtClose(content, quiet.state, rng);
  const evening = runSystems(content, settled.state, EVENING_SYSTEMS, rng);
  // Round 3: the hands-on human leaves the floor at close.
  let { handsOn: _h, ...s } = evening.state;
  if (s.phase !== "gameover") s = { ...s, phase: s.activeEvent ? "event" : "evening" };
  const result = s.history.at(-1) ?? buildDayResult(s);
  return { state: s, events: [...quiet.events, ...settled.events, ...evening.events, { type: "SERVICE_ENDED", result }] };
}

export function tickService(content: ContentPack, state: GameState): StepResult {
  if (state.phase !== "service") return { state, events: [] };
  return withRng(state, (rng) => {
    // A save loaded mid-service (or a hand-built test state) may have a different key order: normalise once.
    const r = runSystems(content, canonicalState(state), SERVICE_SYSTEMS, rng);
    const next = { ...r.state, tick: state.tick + 1 };
    if (next.tick < SERVICE_TICKS) return { state: next, events: r.events };
    const closed = closeService(content, next, rng);
    return { state: closed.state, events: [...r.events, ...closed.events] };
  });
}

/**
 * CLOSE_TODAY (round 3): the restaurant stays shut. No service runs; the evening systems run on an empty tally with
 * `todays.closed`, so rent, the loan and fixed overheads are paid, rostered wages at CLOSED_DAY_WAGE_SHARE, stock
 * still ages, popularity/prestige drift, and the DayResult has `closed: true` and zero covers.
 */
export function closeForDay(content: ContentPack, state: GameState): StepResult {
  return withRng(state, (rng) => {
    const base = canonicalState({
      ...state,
      tick: 0,
      customers: [],
      tickets: [],
      incidents: [],
      ownerCovering: [],
      handsOn: undefined,
      todays: { reviews: [], closed: true },
      service: emptyTally(),
    });
    const evening = runSystems(content, base, EVENING_SYSTEMS, rng);
    let s = evening.state;
    if (s.phase !== "gameover") s = { ...s, phase: s.activeEvent ? "event" : "evening" };
    const result = s.history.at(-1) ?? buildDayResult(s);
    const events: SimEvent[] = [logEvent(s, `${s.restaurantName} stayed closed today.`, "info"), ...evening.events, { type: "SERVICE_ENDED", result }];
    return { state: s, events };
  });
}

/** Replaces the footfall mod tagged `source` (or adds it); `mod: null` removes it. Other entries are untouched. */
export function setFootfallMod(state: GameState, source: string, mod: { mult: number; daysRemaining: number } | null): GameState {
  const others = state.footfallMods.filter((m) => m.source !== source);
  return { ...state, footfallMods: mod && mod.daysRemaining > 0 ? [...others, { ...mod, source }] : others };
}

// ── day advance ──

/** Salt for the supplier's own random stream (kept apart from the main game RNG). */
const SUPPLIER_SALT = 0x5a771e5;

/**
 * Sometimes one line of the morning delivery comes up short (the supplier refunds the missing part).
 * Uses a stream hashed from seed + day, so it is deterministic and never shifts the main RNG.
 */
export function shortLine(state: GameState, day: number): { index: number; missing: number } | undefined {
  const lines = state.orders.map((o, index) => ({ o, index })).filter((x) => x.o.qty >= 4);
  if (lines.length === 0) return undefined;
  const rng = Rng.fromSeed(hashSeed(state.seed, day, SUPPLIER_SALT));
  if (!rng.chance(SHORT_DELIVERY_CHANCE)) return undefined;
  const { o, index } = rng.pick(lines);
  const [lo, hi] = SHORT_DELIVERY_SHARE;
  const arrived = Math.floor(o.qty * (lo + rng.float() * (hi - lo)));
  return { index, missing: o.qty - arrived };
}

/** Morning: deliveries arrive (one may be short), event footfall mods tick down, per-day state resets. */
export function advanceDay(state: GameState, content?: ContentPack): StepResult {
  const day = state.day + 1;
  let stock = state.stock;
  let cash = state.cash;
  const short = shortLine(state, day);
  state.orders.forEach((o, i) => {
    const missing = short && short.index === i ? short.missing : 0;
    if (missing) cash += Math.round((o.cost * missing) / o.qty); // refunded
    stock = addStock(stock, o.ingredientId, o.qty - missing, day, o.qty > 0 ? o.cost / o.qty : undefined);
  });
  const footfallMods = state.footfallMods
    .map((m) => ({ ...m, daysRemaining: m.daysRemaining - 1 }))
    .filter((m) => m.daysRemaining > 0);
  const { activeEvent: _a, service: _s, shortDelivery: _sd, ownerCovering: _oc, handsOn: _h, ...rest } = state;
  const shortOrder = short ? state.orders[short.index] : undefined;
  const next: GameState = {
    ...rest,
    day,
    tick: 0,
    phase: "planning",
    cash,
    stock,
    ...(short && shortOrder ? { shortDelivery: { ingredientId: shortOrder.ingredientId, missing: short.missing } } : {}),
    orders: [],
    customers: [],
    tickets: [],
    todays: { reviews: [] },
    footfallMods,
    eightySixed: [],
    hiredCandidates: [],
  };
  const events: SimEvent[] = [];
  if (state.orders.length) events.push(logEvent(next, `${state.orders.length} deliver${state.orders.length === 1 ? "y" : "ies"} arrived.`, "info"));
  if (short && shortOrder) {
    const name = (content && findIngredient(content, shortOrder.ingredientId)?.name) ?? shortOrder.ingredientId;
    events.push(logEvent(next, fill(incidentLinesOf(content).shortDeliveryLog, { ingredient: name, missing: short.missing }), "bad"));
  }
  return { state: foldLog(next, events), events };
}
