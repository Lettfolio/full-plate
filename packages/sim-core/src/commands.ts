/**
 * Command handlers. Each validates and either returns the new state or rejects with a
 * LOG event of kind "bad" (state unchanged). Never throws on bad input.
 */
import {
  COMP_SATISFACTION_BONUS,
  DIFFICULTY,
  FIRE_MOOD_HIT,
  HIRE_CASH_BUFFER_SHIFTS,
  MAX_MENU_ITEMS,
  MAX_ORDER_QTY,
  MAX_PRICE,
  MAX_STAFF,
  RECRUITMENT_FEE,
  STOCK_OVERDRAFT_LIMIT,
  TABLE_COST,
} from "./constants";
import { advanceDay, openService } from "./engine";
import { staffFromCandidate } from "./staff";
import { purchaseCost } from "./stock";
import { planArrivals } from "./systems/arrival";
import { applyChoice } from "./systems/eventDeck";
import { shiftCost } from "./systems/finance";
import type { Command, ContentPack, GameState, Phase, SimEvent, StepResult } from "./types";
import { clamp, findDish, findIngredient, foldLog, logEvent, monthOf, round2, tallyOf } from "./util";

type Cmd<T extends Command["type"]> = Extract<Command, { type: T }>;
type Handler<T extends Command["type"]> = (content: ContentPack, state: GameState, cmd: Cmd<T>) => StepResult;

// ── result helpers ──
export function reject(state: GameState, reason: string): StepResult {
  const events: SimEvent[] = [logEvent(state, reason, "bad")];
  return { state: foldLog(state, events), events };
}

function ok(state: GameState, text?: string, kind: "info" | "good" | "money" = "info"): StepResult {
  const events: SimEvent[] = text ? [logEvent(state, text, kind)] : [];
  return { state: foldLog(state, events), events };
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const PLANNING: readonly Phase[] = ["planning"];

function requirePhase(state: GameState, allowed: readonly Phase[], what: string): StepResult | undefined {
  return allowed.includes(state.phase) ? undefined : reject(state, `Can't ${what} during ${state.phase}.`);
}

function validPrice(price: unknown): price is number {
  return isInt(price) && price >= 0 && price <= MAX_PRICE;
}

// ── menu ──
const setMenuItem: Handler<"SET_MENU_ITEM"> = (_c, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "change the menu");
  if (bad) return bad;
  const item = state.menu.find((m) => m.dishId === cmd.dishId);
  if (!item) return reject(state, `That dish isn't on the menu.`);
  if (cmd.price !== undefined && !validPrice(cmd.price)) return reject(state, "Prices must be whole pence between £0 and £1,000.");
  const menu = state.menu.map((m) =>
    m.dishId === cmd.dishId
      ? { ...m, ...(cmd.price !== undefined ? { price: cmd.price } : {}), ...(cmd.active !== undefined ? { active: !!cmd.active } : {}) }
      : m,
  );
  return ok({ ...state, menu });
};

const addMenuItem: Handler<"ADD_MENU_ITEM"> = (content, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "change the menu");
  if (bad) return bad;
  const dish = findDish(content, cmd.dishId);
  if (!dish) return reject(state, "Unknown dish.");
  if (state.menu.some((m) => m.dishId === cmd.dishId)) return reject(state, `${dish.name} is already on the menu.`);
  if (!validPrice(cmd.price)) return reject(state, "Prices must be whole pence between £0 and £1,000.");
  if (state.menu.length >= MAX_MENU_ITEMS) return reject(state, `The menu is full (${MAX_MENU_ITEMS} dishes).`);
  const item = { dishId: dish.id, price: cmd.price, active: true, sold7d: 0, margin7d: 0, recent: [] };
  return ok({ ...state, menu: [...state.menu, item] }, `${dish.name} added to the menu.`);
};

const removeMenuItem: Handler<"REMOVE_MENU_ITEM"> = (_c, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "change the menu");
  if (bad) return bad;
  if (!state.menu.some((m) => m.dishId === cmd.dishId)) return reject(state, "That dish isn't on the menu.");
  return ok({ ...state, menu: state.menu.filter((m) => m.dishId !== cmd.dishId) });
};

// ── staff ──
const hire: Handler<"HIRE"> = (content, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "hire");
  if (bad) return bad;
  if (!isInt(cmd.candidateIndex) || cmd.candidateIndex < 0) return reject(state, "No such candidate.");
  if ((state.hiredCandidates ?? []).includes(cmd.candidateIndex)) return reject(state, "You've already hired that candidate.");
  if (state.staff.length >= MAX_STAFF) return reject(state, `There's no room for more than ${MAX_STAFF} staff.`);
  const staff = staffFromCandidate(content, state, cmd.candidateIndex);
  if (!staff) return reject(state, "No such candidate.");
  const needed = RECRUITMENT_FEE + HIRE_CASH_BUFFER_SHIFTS * shiftCost(staff);
  if (state.cash < needed) return reject(state, `Not enough cash to hire ${staff.name} (need £${(needed / 100).toFixed(0)}).`);
  const next: GameState = {
    ...state,
    cash: state.cash - RECRUITMENT_FEE,
    staff: [...state.staff, staff],
    hiredCandidates: [...(state.hiredCandidates ?? []), cmd.candidateIndex],
  };
  return ok(next, `Hired ${staff.name} (${staff.role}).`, "good");
};

const fire: Handler<"FIRE"> = (_c, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "fire staff");
  if (bad) return bad;
  const leaver = state.staff.find((s) => s.id === cmd.staffId);
  if (!leaver) return reject(state, "No such staff member.");
  const staff = state.staff
    .filter((s) => s.id !== cmd.staffId)
    .map((s) => ({ ...s, mood: round2(clamp(s.mood - FIRE_MOOD_HIT, 0, 100)) }));
  return ok({ ...state, staff }, `${leaver.name} has left.`);
};

const setRota: Handler<"SET_ROTA"> = (_c, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "change the rota");
  if (bad) return bad;
  if (!Array.isArray(cmd.rota) || cmd.rota.length !== 7 || !cmd.rota.every((d) => typeof d === "boolean")) {
    return reject(state, "A rota needs exactly 7 days.");
  }
  if (!state.staff.some((s) => s.id === cmd.staffId)) return reject(state, "No such staff member.");
  return ok({ ...state, staff: state.staff.map((s) => (s.id === cmd.staffId ? { ...s, rota: cmd.rota.slice() } : s)) });
};

// ── purchasing ──
const orderStock: Handler<"ORDER_STOCK"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["planning", "evening", "event"], "order stock");
  if (bad) return bad;
  const ing = findIngredient(content, cmd.ingredientId);
  if (!ing) return reject(state, "Unknown ingredient.");
  if (!isInt(cmd.qty) || cmd.qty <= 0 || cmd.qty > MAX_ORDER_QTY) return reject(state, `Order between 1 and ${MAX_ORDER_QTY} portions.`);
  // Delivered tomorrow morning, so priced at tomorrow's season.
  const cost = purchaseCost(ing, cmd.qty, monthOf(state.day + 1), DIFFICULTY[state.difficulty].costMult);
  if (state.cash - cost < -STOCK_OVERDRAFT_LIMIT) return reject(state, `The supplier won't extend more credit for ${ing.name}.`);
  const next: GameState = {
    ...state,
    cash: state.cash - cost,
    orders: [...state.orders, { ingredientId: ing.id, qty: cmd.qty, cost }],
  };
  return ok(next, `Ordered ${cmd.qty} × ${ing.name} for £${(cost / 100).toFixed(2)} (arrives tomorrow).`, "money");
};

const buyTable: Handler<"BUY_TABLE"> = (content, state) => {
  const bad = requirePhase(state, PLANNING, "buy tables");
  if (bad) return bad;
  if (state.tables.length >= content.balance.maxTables) return reject(state, "There's no floor space for another table.");
  if (state.cash < TABLE_COST) return reject(state, "Not enough cash for a new table.");
  const n = state.tables.length + 1;
  const table = { id: `T${n}`, seats: content.balance.seatsPerTable, dirtyTicks: 0 };
  return ok({ ...state, cash: state.cash - TABLE_COST, tables: [...state.tables, table] }, `Table ${n} added.`, "money");
};

// ── service ──
const startService: Handler<"START_SERVICE"> = (content, state) => {
  const bad = requirePhase(state, PLANNING, "open for service");
  if (bad) return bad;
  const opened = openService(content, state);
  const events: SimEvent[] = [...opened.events, logEvent(state, `${state.restaurantName} is open!`, "good")];
  return { state: foldLog(opened.state, events), events };
};

const compTable: Handler<"COMP_TABLE"> = (_c, state, cmd) => {
  const bad = requirePhase(state, ["service"], "comp a table");
  if (bad) return bad;
  const c = state.customers.find((x) => x.id === cmd.customerId);
  if (!c || c.stage === "left" || c.stage === "queue") return reject(state, "You can only comp a seated party.");
  if (c.comped) return reject(state, "That table is already comped.");
  const customers = state.customers.map((x) =>
    x.id === c.id ? { ...x, comped: true, patience: Math.min(100, x.patience + COMP_SATISFACTION_BONUS) } : x,
  );
  return ok({ ...state, customers }, `Comped a party of ${c.partySize}.`, "money");
};

const eightySix: Handler<"EIGHTY_SIX"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["planning", "service"], "86 a dish");
  if (bad) return bad;
  if (!state.menu.some((m) => m.dishId === cmd.dishId)) return reject(state, "That dish isn't on the menu.");
  if ((state.eightySixed ?? []).includes(cmd.dishId)) return reject(state, "That dish is already 86'd.");
  let next: GameState = { ...state, eightySixed: [...(state.eightySixed ?? []), cmd.dishId] };
  if (state.phase === "service") next = { ...next, service: { ...tallyOf(next), arrivals: planArrivals(content, next) } };
  return ok(next, `${findDish(content, cmd.dishId)?.name ?? cmd.dishId} is 86'd for today.`);
};

const endDay: Handler<"END_DAY"> = (_c, state) => {
  const bad = requirePhase(state, ["evening"], "end the day");
  if (bad) return bad;
  return advanceDay(state);
};

const resolveEvent: Handler<"RESOLVE_EVENT"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["event"], "resolve an event");
  if (bad) return bad;
  const ev = content.events.find((e) => e.id === state.activeEvent?.eventId);
  const choice = ev?.choices.find((c) => c.id === cmd.choiceId);
  if (!ev || !choice) return reject(state, "That isn't one of the choices.");
  const chosen = applyChoice(state, choice);
  const day = advanceDay(chosen.state);
  return { state: foldLog(day.state, chosen.events), events: [...chosen.events, ...day.events] };
};

const newGameCmd: Handler<"NEW_GAME"> = (_c, state) => reject(state, "Use newGame() to start a new game.");

const HANDLERS: { [T in Command["type"]]: Handler<T> } = {
  NEW_GAME: newGameCmd,
  SET_MENU_ITEM: setMenuItem,
  ADD_MENU_ITEM: addMenuItem,
  REMOVE_MENU_ITEM: removeMenuItem,
  HIRE: hire,
  FIRE: fire,
  SET_ROTA: setRota,
  ORDER_STOCK: orderStock,
  BUY_TABLE: buyTable,
  START_SERVICE: startService,
  COMP_TABLE: compTable,
  EIGHTY_SIX: eightySix,
  END_DAY: endDay,
  RESOLVE_EVENT: resolveEvent,
};

export function dispatch(content: ContentPack, state: GameState, cmd: Command): StepResult {
  if (state.phase === "gameover") return reject(state, "The restaurant has closed. Start a new game.");
  const handler = HANDLERS[cmd?.type as Command["type"]] as Handler<Command["type"]> | undefined;
  if (!handler) return reject(state, "Unknown command.");
  return handler(content, state, cmd as never);
}

