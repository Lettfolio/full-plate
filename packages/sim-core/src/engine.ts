/**
 * Engine — runs the per-tick service pipeline and the evening pipeline, and moves the
 * day through its phases: planning → service → evening|event → (END_DAY|RESOLVE_EVENT) → planning.
 */
import { Rng } from "./rng";
import { addStock, canPlate } from "./stock";
import { arrivalSystem, planArrivals } from "./systems/arrival";
import { clearingSystem } from "./systems/clearing";
import { eventDeckSystem } from "./systems/eventDeck";
import { checkSolvency, financeSystem } from "./systems/finance";
import { kitchenSystem } from "./systems/kitchen";
import { orderSystem } from "./systems/order";
import { paymentSystem } from "./systems/payment";
import { reputationSystem } from "./systems/reputation";
import { seatingSystem } from "./systems/seating";
import { serviceSystem } from "./systems/service";
import { staffMoodSystem } from "./systems/staffMood";
import { statsSystem, buildDayResult } from "./systems/stats";
import { serverActionsPerTick, type System, type SystemResult } from "./systems/system";
import { wasteSystem } from "./systems/waste";
import type { ContentPack, Customer, GameState, SimEvent, StepResult, Table } from "./types";
import { SERVICE_TICKS } from "./types";
import { emptyTally, findDish, foldLog, logEvent, tallyOf } from "./util";

/** Per-tick order from ARCHITECTURE.md (LogSystem = foldLog at the end of each step). */
export const SERVICE_SYSTEMS: readonly System[] = [
  arrivalSystem,
  seatingSystem,
  orderSystem,
  kitchenSystem,
  serviceSystem,
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

export function openService(content: ContentPack, state: GameState): StepResult {
  const auto = autoEightySix(content, state);
  const base: GameState = {
    ...state,
    eightySixed: auto.pulled,
    phase: "service",
    tick: 0,
    customers: [],
    tickets: [],
    todays: { reviews: [] },
  };
  const tally = {
    ...emptyTally(),
    arrivals: planArrivals(content, base),
    actionsPerTick: serverActionsPerTick(content, base),
  };
  tally.potentialParties = Math.round(tally.arrivals.reduce((a, p) => a + p.potentialParties, 0));
  return { state: { ...base, service: tally }, events: auto.events };
}

const ALL_ACTIONS = 1e6;

/** At close: eating and paying parties settle their bill; anyone still waiting for food walks out; the queue is turned away. */
export function settleAtClose(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const ready = state.customers.map((c): Customer =>
    c.stage === "eating" || (c.stage === "ordered" && c.servedTick !== undefined) ? { ...c, stage: "paying" } : c,
  );
  const tally = tallyOf(state);
  const paid = paymentSystem(content, { ...state, customers: ready, service: { ...tally, actionsLeft: ALL_ACTIONS } }, rng);
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
  const settled = settleAtClose(content, state, rng);
  const evening = runSystems(content, settled.state, EVENING_SYSTEMS, rng);
  let s = evening.state;
  if (s.phase !== "gameover") s = { ...s, phase: s.activeEvent ? "event" : "evening" };
  const result = s.history.at(-1) ?? buildDayResult(s);
  return { state: s, events: [...settled.events, ...evening.events, { type: "SERVICE_ENDED", result }] };
}

export function tickService(content: ContentPack, state: GameState): StepResult {
  if (state.phase !== "service") return { state, events: [] };
  return withRng(state, (rng) => {
    const r = runSystems(content, state, SERVICE_SYSTEMS, rng);
    const next = { ...r.state, tick: state.tick + 1 };
    if (next.tick < SERVICE_TICKS) return { state: next, events: r.events };
    const closed = closeService(content, next, rng);
    return { state: closed.state, events: [...r.events, ...closed.events] };
  });
}

// ── day advance ──

/** Morning: deliveries arrive, event footfall mods tick down, per-day state resets. */
export function advanceDay(state: GameState): StepResult {
  const day = state.day + 1;
  let stock = state.stock;
  for (const o of state.orders) stock = addStock(stock, o.ingredientId, o.qty, day);
  const footfallMods = state.footfallMods
    .map((m) => ({ ...m, daysRemaining: m.daysRemaining - 1 }))
    .filter((m) => m.daysRemaining > 0);
  const { activeEvent: _a, service: _s, ...rest } = state;
  const next: GameState = {
    ...rest,
    day,
    tick: 0,
    phase: "planning",
    stock,
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
  return { state: foldLog(next, events), events };
}
