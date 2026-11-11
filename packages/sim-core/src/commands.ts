/**
 * Command handlers. Each validates and either returns the new state or rejects with a
 * LOG event of kind "bad" (state unchanged). Never throws on bad input.
 */
import { formatPence, formatPounds } from "./money";
import {
  COMP_SATISFACTION_BONUS,
  DEFAULT_ROTA,
  DIFFICULTY,
  FIRE_MOOD_HIT,
  HANDS_ON,
  PLAYER_COOK_ID,
  SET_MENU_MAX_DISHES,
  HIRE_CASH_BUFFER_SHIFTS,
  MAX_MENU_ITEMS,
  MAX_ORDER_QTY,
  MAX_PRICE,
  MAX_STAFF,
  RECRUITMENT_FEE,
  START_MOOD,
  STOCK_OVERDRAFT_LIMIT,
  TABLE_COST,
  TRAINING_FEE,
  TRAINING_SKILL_GAIN,
} from "./constants";
import { hashSeed, Rng } from "./rng";
import { updateGoals } from "./systems/goals";
import { respondIncident, startBreak } from "./systems/incidents";
import { advanceDay, closeForDay, openService, withRng } from "./engine";
import { recordAdvice } from "./advice";
import { deliverPlate, holdsAtPass, tallyPlate, toPass, untallyPlate } from "./systems/kitchen";
import { aiDueTick, stationOf } from "./systems/station";
import { bookTakings, settleParty } from "./systems/payment";
import { frontCharm } from "./systems/system";
import { candidateStaffId, staffFromCandidate } from "./staff";
import { nextTrackFee, trackById, trackLevel, TRACK_MAX_LEVEL } from "./personality";
import { purchaseCost } from "./stock";
import { planArrivals } from "./systems/arrival";
import { applyChoice } from "./systems/eventDeck";
import { shiftCost } from "./systems/finance";
import { findDecorItem, installed, isDecorSlot, wearOf } from "./decor";
import { hireNeed, recruitmentFeeOf, starterLoanOffer } from "./bank";
import { dailyInstalment } from "./systems/finance";
import type { Command, ContentPack, GameState, KitchenTicket, Phase, SimEvent, Staff, StaffRole, StepResult } from "./types";
import { clamp, findDish, findIngredient, foldLog, logEvent, monthOf, onFloor, round2, tallyOf, worksToday } from "./util";

type Cmd<T extends Command["type"]> = Extract<Command, { type: T }>;
type Handler<T extends Command["type"]> = (content: ContentPack, state: GameState, cmd: Cmd<T>) => StepResult;

// ── result helpers ──
/** Results produced by reject(): their state must stay exactly the input (plus the log line). */
const rejected = new WeakSet<StepResult>();

export function reject(state: GameState, reason: string): StepResult {
  const events: SimEvent[] = [logEvent(state, reason, "bad")];
  const r = { state: foldLog(state, events), events };
  rejected.add(r);
  return r;
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
/** Recruitment fee in effect: GameState.recruitmentFee (career perk) or RECRUITMENT_FEE (round 11: lives in bank.ts). */
export { recruitmentFeeOf };

/** [round 10] Today's candidate index from a Candidate.id ("s<day>-<index>"); NaN when it isn't today's. */
function candidateIndexOf(state: GameState, id: string | undefined): number {
  const m = typeof id === "string" ? /^s(\d+)-(\d+)$/.exec(id) : null;
  return m && Number(m[1]) === state.day ? Number(m[2]) : NaN;
}

const hire: Handler<"HIRE"> = (content, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "hire");
  if (bad) return bad;
  const index = cmd.candidateIndex ?? candidateIndexOf(state, cmd.candidateId);
  if (!isInt(index) || index < 0) return reject(state, "No such candidate.");
  if (cmd.candidateId !== undefined && cmd.candidateId !== candidateStaffId(state.day, index)) return reject(state, "No such candidate.");
  if ((state.hiredCandidates ?? []).includes(index)) return reject(state, "You've already hired that candidate.");
  if (state.staff.length >= MAX_STAFF) return reject(state, `There's no room for more than ${MAX_STAFF} staff.`);
  const staff = staffFromCandidate(content, state, index);
  if (!staff) return reject(state, "No such candidate.");
  // Round 11 (G13): ids are unique (a HIRE_STAFF may already have used this candidate's id); FIRE would take both.
  if (state.staff.some((s) => s.id === staff.id)) return reject(state, `${staff.name} already works here.`);
  const { fee, needed, canAfford } = hireNeed(state, staff.wage);
  if (!canAfford) return reject(state, `Not enough cash to hire ${staff.name} (need ${formatPounds(needed)}).`);
  const next: GameState = {
    ...state,
    cash: state.cash - fee,
    staff: [...state.staff, staff],
    hiredCandidates: [...(state.hiredCandidates ?? []), index],
  };
  return ok(next, `Hired ${staff.name} (${staff.role}).`, "good");
};

const STAFF_ROLES: readonly StaffRole[] = ["chef", "server", "bar", "porter", "manager"];

/**
 * HIRE_STAFF: bring a known person in (CAREER-NOTES "former colleagues", Empire poaching). Same fee and cash rule as
 * HIRE. The record's id, name, role, stats, wage, traits and potential are kept (stats clamped 0-100, wage whole
 * pence ≥ 1); mood, fatigue, hiredDay and the default rota start fresh, as for any new hire.
 */
const hireStaff: Handler<"HIRE_STAFF"> = (_c, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "hire");
  if (bad) return bad;
  const p = cmd.staff;
  if (!p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name) return reject(state, "That person needs a name and an id.");
  if (!STAFF_ROLES.includes(p.role)) return reject(state, "Unknown role.");
  if (!isNum(p.skill) || !isNum(p.speed) || !isNum(p.charm)) return reject(state, "Skills must be numbers 0-100.");
  if (!isInt(p.wage) || p.wage < 1) return reject(state, "A wage must be whole pence per hour.");
  if (state.staff.some((s) => s.id === p.id || s.name === p.name)) return reject(state, `${p.name} already works here.`);
  if (state.staff.length >= MAX_STAFF) return reject(state, `There's no room for more than ${MAX_STAFF} staff.`);
  const skill = round2(clamp(p.skill, 0, 100));
  const staff = {
    id: p.id,
    name: p.name.slice(0, 40),
    role: p.role,
    skill,
    speed: round2(clamp(p.speed, 0, 100)),
    charm: round2(clamp(p.charm, 0, 100)),
    wage: p.wage,
    mood: START_MOOD,
    fatigue: 0,
    traits: Array.isArray(p.traits) ? p.traits.filter((t) => typeof t === "string") : [],
    hiredDay: state.day,
    potential: round2(clamp(isNum(p.potential) ? Math.max(p.potential, skill) : skill, 0, 100)),
    rota: DEFAULT_ROTA.slice(),
  };
  const { fee, needed, canAfford } = hireNeed(state, staff.wage);
  if (!canAfford) return reject(state, `Not enough cash to hire ${staff.name} (need ${formatPounds(needed)}).`);
  return ok({ ...state, cash: state.cash - fee, staff: [...state.staff, staff] }, `Hired ${staff.name} (${staff.role}).`, "good");
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
  // Round 11: a for loop, not every() — every() skips the holes of Array(7), which then saved as nulls.
  if (!Array.isArray(cmd.rota) || cmd.rota.length !== 7 || !Array.from(cmd.rota).every((d) => typeof d === "boolean")) {
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
  return ok(next, `Ordered ${cmd.qty} × ${ing.name} for ${formatPence(cost)} (arrives tomorrow).`, "money");
};

/**
 * [round 6 review] The over-stock tip's one-tap fix: takes `qty` portions of an ingredient off the orders that arrive
 * tomorrow morning (the newest lines first) and refunds what they cost, pro rata to the penny. More than is pending
 * cancels it all.
 */
const cancelOrder: Handler<"CANCEL_ORDER"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["planning", "evening", "event"], "change an order");
  if (bad) return bad;
  const ing = findIngredient(content, cmd.ingredientId);
  if (!ing) return reject(state, "Unknown ingredient.");
  if (!isInt(cmd.qty) || cmd.qty <= 0) return reject(state, "Cancel at least 1 portion.");
  const pending = state.orders.reduce((a, o) => a + (o.ingredientId === ing.id ? o.qty : 0), 0);
  if (!pending) return reject(state, `Nothing of ${ing.name} is on order.`);
  let left = Math.min(cmd.qty, pending);
  let refund = 0;
  const orders: GameState["orders"] = [];
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const o = state.orders[i]!;
    if (o.ingredientId !== ing.id || left <= 0) { orders.unshift(o); continue; }
    const cut = Math.min(left, o.qty);
    left -= cut;
    // Round 11 (G14): round the refund down — the kept portions keep the odd penny, so order-2-cancel-1 never beats buying 1.
    const back = cut === o.qty ? o.cost : Math.floor((o.cost * cut) / o.qty);
    refund += back;
    if (cut < o.qty) orders.unshift({ ...o, qty: o.qty - cut, cost: o.cost - back });
  }
  const n = Math.min(cmd.qty, pending);
  return ok({ ...state, cash: state.cash + refund, orders }, `Cancelled ${n} × ${ing.name} (${formatPence(refund)} back).`, "money");
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

const endDay: Handler<"END_DAY"> = (content, state) => {
  const bad = requirePhase(state, ["evening"], "end the day");
  if (bad) return bad;
  return withAdviceLog(advanceDay(state, content), state, content);
};

/** [round 6] Records tonight's evening tip (computed on the evening state, before any event choice) in the new day. */
function withAdviceLog(r: StepResult, evening: GameState, content: ContentPack): StepResult {
  const log = recordAdvice(evening, content);
  return log === r.state.adviceLog ? r : { ...r, state: { ...r.state, adviceLog: log } };
}

const resolveEvent: Handler<"RESOLVE_EVENT"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["event"], "resolve an event");
  if (bad) return bad;
  const ev = content.events.find((e) => e.id === state.activeEvent?.eventId);
  if (!ev) {
    // The card no longer exists (old save, content changed): dismiss it with any choiceId and carry on.
    const events: SimEvent[] = [logEvent(state, "The morning post got lost. It happens.", "info")];
    const day = withAdviceLog(advanceDay(state, content), state, content);
    return { state: foldLog(day.state, events), events: [...events, ...day.events] };
  }
  const choice = ev.choices.find((c) => c.id === cmd.choiceId);
  if (!choice) return reject(state, "That isn't one of the choices.");
  const chosen = applyChoice(state, choice);
  const day = withAdviceLog(advanceDay(chosen.state, content), state, content);
  return { state: foldLog(day.state, chosen.events), events: [...chosen.events, ...day.events] };
};

// ── round 2: incidents, training, breaks ──
const respond: Handler<"RESPOND_INCIDENT"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["service"], "deal with that");
  if (bad) return bad;
  const r = respondIncident(content, state, cmd.incidentId, cmd.optionId);
  if ("error" in r) return reject(state, r.error);
  return { state: foldLog(r.state, r.events), events: r.events };
};

/** Salt for training outcomes (independent of the main RNG so planning commands stay order-free). */
const TRAIN_SALT = 0x7a1a1e;

const train: Handler<"TRAIN"> = (_c, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "send staff on training");
  if (bad) return bad;
  const who = state.staff.find((s) => s.id === cmd.staffId);
  if (!who) return reject(state, "No such staff member.");
  if (who.trainingDay === state.day) return reject(state, `${who.name} is already on a course today.`);
  if (cmd.track !== undefined) return trainTrack(state, who, cmd.track);
  if (who.skill >= who.potential) return reject(state, `${who.name} has learned all a course can teach them.`);
  if (state.cash < TRAINING_FEE) return reject(state, `Not enough cash for a course (${formatPounds(TRAINING_FEE)}).`);
  const rng = Rng.fromSeed(hashSeed(state.seed, state.day, TRAIN_SALT, state.staff.indexOf(who)));
  const gain = rng.int(TRAINING_SKILL_GAIN[0], TRAINING_SKILL_GAIN[1]);
  const skill = round2(Math.min(who.potential, who.skill + gain));
  const staff = state.staff.map((s) => (s.id === who.id ? { ...s, skill, trainingDay: state.day } : s));
  const shift = worksToday(who, state.day) ? " They're off the floor today." : "";
  return ok({ ...state, cash: state.cash - TRAINING_FEE, staff }, `${who.name} is on a training course: skill ${Math.round(who.skill)} → ${Math.round(skill)}.${shift}`, "good");
};

/**
 * [round 10] TRAIN with a track: the next level (1-3) of a training path (personality.ts TRAINING_TRACKS). Costs that
 * level's fee and the day (off the floor, still paid); the stat rises now by the track's gain (capped at 100; potential
 * is raised with skill so plating isn't undone), and the evening says "level up".
 */
function trainTrack(state: GameState, who: Staff, trackId: string): StepResult {
  const t = trackById(trackId);
  if (!t) return reject(state, "No such training course.");
  if (!t.roles.includes(who.role)) return reject(state, `${t.name} isn't a course for a ${who.role}.`);
  const fee = nextTrackFee(who, t);
  if (fee === undefined) return reject(state, `${who.name} has finished every level of ${t.name}.`);
  if (state.cash < fee) return reject(state, `Not enough cash for ${t.name} (${formatPounds(fee)}).`);
  const level = trackLevel(who, t.id) + 1;
  const raised: Partial<Staff> = {};
  if (t.stat) {
    const v = round2(Math.min(100, who[t.stat] + t.gain));
    raised[t.stat] = v;
    if (t.stat === "skill") raised.potential = round2(Math.max(who.potential, v));
  }
  const next: Staff = { ...who, ...raised, tracks: { ...(who.tracks ?? {}), [t.id]: level }, trainingDay: state.day, trainingTrack: t.id };
  const staff = state.staff.map((s) => (s.id === who.id ? next : s));
  const shift = worksToday(who, state.day) ? " They're off the floor today." : "";
  const top = level === TRACK_MAX_LEVEL ? " (the top level!)" : "";
  return ok({ ...state, cash: state.cash - fee, staff }, `${who.name} is learning ${t.name}, level ${level}${top}.${shift}`, "good");
}

const giveBreak: Handler<"GIVE_BREAK"> = (content, state, cmd) => {
  const bad = requirePhase(state, ["service"], "give a break");
  if (bad) return bad;
  const who = state.staff.find((s) => s.id === cmd.staffId);
  if (!who) return reject(state, "No such staff member.");
  if ((who.breakUntilTick ?? 0) > state.tick) return reject(state, `${who.name} is already on a break.`);
  if (!onFloor(who, state)) return reject(state, `${who.name} isn't working right now.`);
  return ok(startBreak(content, state, who), `${who.name} is having a short break.`, "info");
};

// ── round 3: hands-on results (service) ──
const SERVICE: readonly Phase[] = ["service"];
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const ROLES: readonly StaffRole[] = ["chef", "server", "bar", "porter", "manager"];
/** Who the human cooks as in the tally (DayResult.perChef): their Staff id in career mode, else "player". */
const humanCookId = (state: GameState): string => state.handsOn?.staffId ?? PLAYER_COOK_ID;

const playerCooked: Handler<"PLAYER_COOKED"> = (content, state, cmd) => {
  const bad = requirePhase(state, SERVICE, "plate up");
  if (bad) return bad;
  if (!isNum(cmd.quality)) return reject(state, "That plate has no quality score.");
  const t = state.tickets.find((x) => x.id === cmd.ticketId);
  if (!t) return reject(state, "That ticket has already gone.");
  if (t.atPass) return reject(state, "That plate is already on the pass.");
  const cook = humanCookId(state);
  // Round 5: never cook a ticket twice — one an AI cook has (and the human never claimed) is theirs.
  if (t.chefId !== undefined && t.chefId !== cook) return reject(state, "Another chef is already cooking that one.");
  const quality = round2(clamp(cmd.quality, 0, 100));
  const tally = tallyPlate(tallyOf(state), { ...tallyOf(state).dishes }, t, cook, quality);
  const events: SimEvent[] = [{ type: "DISH_PLATED", ticketId: t.id, quality }];
  let next: GameState;
  if (holdsAtPass(content, state, t)) {
    // A hands-on server/bar carries it (or an AI colleague after HANDS_ON.passHoldTicks).
    next = { ...state, service: tally, tickets: state.tickets.map((x) => (x === t ? toPass(t, cook, quality, state.tick) : x)) };
  } else {
    next = {
      ...state,
      service: tally,
      tickets: state.tickets.filter((x) => x !== t),
      // Round 5: with a station, the plate's dueTick is when an AI cook would have had it out (station dilation).
      customers: state.customers.map((c) => (c.id === t.customerId ? deliverPlate(c, quality, state.tick, t.remakeOf, stationOf(state) ? aiDueTick(content, t, state.tick) : undefined) : c)),
    };
  }
  return { state: foldLog(next, events), events };
};

const playerServed: Handler<"PLAYER_SERVED"> = (_c, state, cmd) => {
  const bad = requirePhase(state, SERVICE, "serve");
  if (bad) return bad;
  const t = state.tickets.find((x) => x.id === cmd.ticketId);
  if (!t || !t.atPass) return reject(state, "That plate isn't on the pass.");
  if (t.customerId !== cmd.customerId) return reject(state, "That plate is for another table.");
  const c = state.customers.find((x) => x.id === cmd.customerId);
  if (!c || c.stage === "left" || c.stage === "queue") return reject(state, "That table has already gone.");
  // speedBonus 1 on every plate of the party adds HANDS_ON.speedBonusSatisfaction in total.
  const lift = isNum(cmd.speedBonus) ? (clamp(cmd.speedBonus, 0, 1) * HANDS_ON.speedBonusSatisfaction) / Math.max(1, c.order.length) : 0;
  const served = deliverPlate(c, t.quality, state.tick, t.remakeOf);
  const customer = { ...served, satisfactionBonus: round2((served.satisfactionBonus ?? 0) + lift) };
  return ok({
    ...state,
    tickets: state.tickets.filter((x) => x !== t),
    customers: state.customers.map((x) => (x === c ? customer : x)),
  });
};

const playerCleared: Handler<"PLAYER_CLEARED"> = (_c, state, cmd) => {
  const bad = requirePhase(state, SERVICE, "clear a table");
  if (bad) return bad;
  const table = state.tables.find((t) => t.id === cmd.tableId);
  if (!table) return reject(state, "No such table.");
  if (table.occupiedBy) return reject(state, "Someone is still sitting there.");
  if (table.dirtyTicks <= 0) return reject(state, "That table is already clean.");
  return ok({ ...state, tables: state.tables.map((t) => (t === table ? { ...t, dirtyTicks: 0 } : t)) });
};

const playerTookPayment: Handler<"PLAYER_TOOK_PAYMENT"> = (content, state, cmd) => {
  const bad = requirePhase(state, SERVICE, "take payment");
  if (bad) return bad;
  const c = state.customers.find((x) => x.id === cmd.customerId);
  if (!c || c.stage !== "paying") return reject(state, "That table isn't ready to pay.");
  // The walk to the till was the action: no FOH action is spent.
  return withRng(state, (rng) => {
    const tally = tallyOf(state);
    const r = settleParty(content, state, rng, c, tally, tally.frontCharm ?? frontCharm(content, state));
    if (!r) return { state, events: [] };
    return { state: bookTakings(state, new Map([[c.id, r.customer]]), r.tally), events: r.events };
  });
};

const playerDropped: Handler<"PLAYER_DROPPED"> = (content, state, cmd) => {
  const bad = requirePhase(state, SERVICE, "drop that");
  if (bad) return bad;
  if (!isInt(cmd.cost) || cmd.cost < 0) return reject(state, "A drop costs whole pence.");
  if (!Array.isArray(cmd.ticketIds)) return reject(state, "Which plates were dropped?");
  const cost = Math.min(cmd.cost, HANDS_ON.maxDropCost);
  const ids = new Set(cmd.ticketIds);
  let tally = tallyOf(state);
  // Each dropped ticket goes back on the rail to be cooked again (stock was used when it fired; no new stock).
  const tickets = state.tickets.map((t): KitchenTicket => {
    if (!ids.has(t.id)) return t;
    if (t.atPass) tally = untallyPlate(tally, t);
    const { atPass: _a, platedAtTick: _p, chefId: _c, claimedAtTick: _k, ...rest } = t;
    return { ...rest, quality: 0, ticksRemaining: findDish(content, t.dishId)?.prepTicks ?? Math.max(1, t.ticksRemaining) };
  });
  // The cost is real money now (a re-cook, breakage): cash, today's food cost and the plate-waste line.
  tally = { ...tally, plateWaste: tally.plateWaste + cost, foodCost: (tally.foodCost ?? 0) + cost };
  return ok({ ...state, cash: state.cash - cost, tickets, service: tally }, cost ? `Dropped! That cost ${formatPence(cost)}.` : undefined, "money");
};

/**
 * PLAYER_CLAIMED: the human picked a ticket up (grabbed it from the fridge or started pouring). The kitchen leaves it to
 * them until HANDS_ON.claimTimeoutTicks pass. A ticket an AI cook already has is refused (round 5; it used to be taken
 * off the AI mid-cook and the human's plate binned when the AI's landed first).
 */
const playerClaimed: Handler<"PLAYER_CLAIMED"> = (_c, state, cmd) => {
  const bad = requirePhase(state, SERVICE, "pick that up");
  if (bad) return bad;
  if (!state.handsOn) return reject(state, "Nobody is hands-on.");
  const t = state.tickets.find((x) => x.id === cmd.ticketId);
  if (!t) return reject(state, "That ticket has already gone.");
  if (t.atPass || t.ticksRemaining <= 0) return reject(state, "That plate is already cooked.");
  const human = humanCookId(state);
  if (t.chefId === human) return ok(state);
  // Round 5: an AI cook already has it (the session was a tick behind). Taking it would cook it twice: refuse, and the
  // session lets go of it without a cost.
  if (t.chefId !== undefined) return reject(state, "Another chef is already cooking that one.");
  const tickets = state.tickets.map((x) => (x === t ? { ...x, chefId: human, claimedAtTick: state.tick } : x));
  return ok({ ...state, tickets });
};

const setHandsOn: Handler<"SET_HANDS_ON"> = (_c, state, cmd) => {
  const bad = requirePhase(state, ["planning", "service"], "jump in");
  if (bad) return bad;
  if (cmd.role === null) {
    if (!state.handsOn) return ok(state);
    // Held plates go out on the next tick (the kitchen no longer holds them).
    const { handsOn: _h, ...rest } = state;
    return ok(rest as GameState, "Back to the office.");
  }
  if (!ROLES.includes(cmd.role)) return reject(state, "Unknown role.");
  if (cmd.staffId !== undefined && !state.staff.some((s) => s.id === cmd.staffId)) return reject(state, "No such staff member.");
  const st = cmd.station;
  if (st !== undefined) {
    if (cmd.role !== "chef") return reject(state, "Only a chef has a station.");
    if (!st || !Array.isArray(st.dishIds) || st.dishIds.some((d) => typeof d !== "string") || !isInt(st.cap) || st.cap < 1 || st.cap > HANDS_ON.stationMaxCap) return reject(state, "That station doesn't make sense.");
    if (st.coverTicks !== undefined && (!isInt(st.coverTicks) || st.coverTicks < 1 || st.coverTicks > HANDS_ON.stationMaxCoverTicks)) return reject(state, "That station doesn't make sense.");
  }
  // Round 4: re-sending the same role/person (a new station or rail size) keeps `since`.
  const prev = state.handsOn;
  const same = !!prev && prev.role === cmd.role && prev.staffId === cmd.staffId;
  const handsOn = {
    role: cmd.role,
    since: same ? prev.since : state.phase === "service" ? state.tick : 0,
    ...(cmd.staffId !== undefined ? { staffId: cmd.staffId } : {}),
    ...(st ? { station: { dishIds: [...st.dishIds], cap: st.cap, ...(st.coverTicks !== undefined ? { coverTicks: st.coverTicks } : {}) } } : {}),
  };
  return ok({ ...state, handsOn });
};

// ── round 3: closed days, set menus, owner skills ──
const closeToday: Handler<"CLOSE_TODAY"> = (content, state) => {
  const bad = requirePhase(state, PLANNING, "close for the day");
  if (bad) return bad;
  return closeForDay(content, state);
};

const setSetMenu: Handler<"SET_SET_MENU"> = (content, state, cmd) => {
  const bad = requirePhase(state, PLANNING, "change the set menu");
  if (bad) return bad;
  if (!Array.isArray(cmd.dishIds)) return reject(state, "A set menu needs a list of dishes.");
  if (cmd.dishIds.length === 0 && !cmd.active) {
    const { setMenu: _s, ...rest } = state;
    return ok(rest as GameState, "Set menu removed.");
  }
  if (cmd.dishIds.length === 0 || cmd.dishIds.length > SET_MENU_MAX_DISHES) return reject(state, `A set menu has 1 to ${SET_MENU_MAX_DISHES} dishes.`);
  if (new Set(cmd.dishIds).size !== cmd.dishIds.length) return reject(state, "Each dish can only be in the set menu once.");
  if (cmd.dishIds.some((id) => !findDish(content, id))) return reject(state, "Unknown dish.");
  if (!validPrice(cmd.price)) return reject(state, "Prices must be whole pence between £0 and £1,000.");
  const setMenu = { dishIds: cmd.dishIds.slice(), price: cmd.price, active: !!cmd.active };
  return ok({ ...state, setMenu }, setMenu.active ? `Set menu on: ${setMenu.dishIds.length} courses for ${formatPence(setMenu.price)}.` : "Set menu saved (off).");
};

/**
 * Round 13 (E, red-team G14): the owner's skills are set once, by the career handover, on a restaurant that has just
 * opened: planning, before its first service, and only if nobody has set them yet. Any later call is refused, so a
 * screen (or a hand-edited command) can't make the owner a better cook mid-game.
 */
const setOwnerProfile: Handler<"SET_OWNER_PROFILE"> = (_c, state, cmd) => {
  const bad = requirePhase(state, ["planning"], "change the owner's skills");
  if (bad) return bad;
  if (state.ownerProfile) return reject(state, "The owner's skills are already set.");
  if (state.history.length > 0) return reject(state, "The owner's skills are set when the restaurant opens.");
  if (!isNum(cmd.skill) || !isNum(cmd.speed) || !isNum(cmd.charm)) return reject(state, "Skills must be numbers 0-100.");
  const ownerProfile = { skill: round2(clamp(cmd.skill, 0, 100)), speed: round2(clamp(cmd.speed, 0, 100)), charm: round2(clamp(cmd.charm, 0, 100)) };
  return ok({ ...state, ownerProfile });
};

// ── round 10: decorating ──
const DECOR_PHASES: readonly Phase[] = ["planning", "evening"];
const pounds = (p: number) => formatPence(p, { trim: true });

const buyDecor: Handler<"BUY_DECOR"> = (content, state, cmd) => {
  const bad = requirePhase(state, DECOR_PHASES, "decorate");
  if (bad) return bad;
  if (!content.decor) return reject(state, "There's nothing to decorate with.");
  if (!isDecorSlot(cmd.slot)) return reject(state, "That isn't part of the room.");
  const item = findDecorItem(content, cmd.itemId);
  if (!item || item.slot !== cmd.slot) return reject(state, "That doesn't go there.");
  const pending = state.decor?.pending ?? [];
  const already = pending.find((p) => p.slot === cmd.slot);
  if (already?.itemId === item.id) return reject(state, `${item.name} is already coming tomorrow.`);
  const now = installed(content, state, cmd.slot);
  if (!already && now?.item.id === item.id) return reject(state, `You already have ${item.name}.`);
  const refund = already?.paid ?? 0;
  if (state.cash + refund < item.price) return reject(state, `Not enough cash for ${item.name} (${pounds(item.price)}).`);
  // Choosing the item that is already in the room just cancels tomorrow's fitting there.
  const others = pending.filter((p) => p.slot !== cmd.slot);
  const next = now?.item.id === item.id ? others : [...others, { slot: cmd.slot, itemId: item.id, paid: item.price, tables: item.fitTables }];
  const decor = { slots: {}, ...state.decor, pending: next };
  if (!next.length) delete (decor as { pending?: unknown }).pending;
  const cash = state.cash + refund - (now?.item.id === item.id ? 0 : item.price);
  const text = now?.item.id === item.id
    ? `Kept your ${item.name} — tomorrow's fitting is off${refund ? ` (${pounds(refund)} back)` : ""}.`
    : `${item.name} bought — the fitters come tomorrow morning${item.fitTables ? ` (${item.fitTables} table${item.fitTables === 1 ? "" : "s"} closed tomorrow night)` : ""}.`;
  return ok({ ...state, cash, decor }, text, "money");
};

const refreshDecor: Handler<"REFRESH_DECOR"> = (content, state, cmd) => {
  const bad = requirePhase(state, DECOR_PHASES, "decorate");
  if (bad) return bad;
  if (!content.decor) return reject(state, "There's nothing to decorate with.");
  if (!isDecorSlot(cmd.slot)) return reject(state, "That isn't part of the room.");
  const it = installed(content, state, cmd.slot);
  if (!it?.bought || !state.decor) return reject(state, "The starter kit doesn't need a refresh.");
  if (wearOf(it.item, it.since, state.day) === "fresh") return reject(state, `Your ${it.item.name} still look${it.item.name.endsWith("s") ? "" : "s"} fresh.`);
  if (state.cash < it.item.refreshCost) return reject(state, `Not enough cash to refresh ${it.item.name} (${pounds(it.item.refreshCost)}).`);
  const decor = { ...state.decor, slots: { ...state.decor.slots, [cmd.slot]: { itemId: it.item.id, since: state.day } } };
  return ok({ ...state, cash: state.cash - it.item.refreshCost, decor }, `${it.item.name} refreshed — good as new.`, "money");
};

/**
 * [round 11] STARTER_LOAN: the bank lends a staffless Normal/Hard owner a first wage (bank.ts `starterLoanOffer`: what
 * the cheapest chef needs, £1,000–£5,000), once, on the game's own loan terms — added to the loan, the daily instalment
 * re-spread over the days left (a new term if it was already paid off). Planning, evening or the morning post.
 */
const starterLoan: Handler<"STARTER_LOAN"> = (content, state) => {
  const bad = requirePhase(state, ["planning", "evening", "event"], "borrow");
  if (bad) return bad;
  if (state.starterLoan) return reject(state, "The bank has already lent you a first wage.");
  const amount = starterLoanOffer(content, state);
  if (amount === null) return reject(state, state.staff.length ? "The starter loan is for a first hire." : "The bank won't lend you that.");
  const remaining = state.loan.remaining + amount;
  const days = state.loan.daysRemaining > 0 ? state.loan.daysRemaining : content.balance.loanTermDays;
  const loan = { ...state.loan, principal: state.loan.principal + amount, remaining, daysRemaining: days, dailyPayment: dailyInstalment(remaining, content.balance.loanApr, days) };
  return ok({ ...state, cash: state.cash + amount, loan, starterLoan: true }, `The bank lent you ${pounds(amount)} for a first wage. Now hire a chef.`, "money");
};

const newGameCmd: Handler<"NEW_GAME"> = (_c, state) => reject(state, "Use newGame() to start a new game.");

const HANDLERS: { [T in Command["type"]]: Handler<T> } = {
  NEW_GAME: newGameCmd,
  SET_MENU_ITEM: setMenuItem,
  ADD_MENU_ITEM: addMenuItem,
  REMOVE_MENU_ITEM: removeMenuItem,
  HIRE: hire,
  HIRE_STAFF: hireStaff,
  PLAYER_CLAIMED: playerClaimed,
  FIRE: fire,
  SET_ROTA: setRota,
  ORDER_STOCK: orderStock,
  CANCEL_ORDER: cancelOrder,
  BUY_TABLE: buyTable,
  START_SERVICE: startService,
  COMP_TABLE: compTable,
  EIGHTY_SIX: eightySix,
  END_DAY: endDay,
  RESOLVE_EVENT: resolveEvent,
  RESPOND_INCIDENT: respond,
  TRAIN: train,
  GIVE_BREAK: giveBreak,
  PLAYER_COOKED: playerCooked,
  PLAYER_SERVED: playerServed,
  PLAYER_CLEARED: playerCleared,
  PLAYER_TOOK_PAYMENT: playerTookPayment,
  PLAYER_DROPPED: playerDropped,
  SET_HANDS_ON: setHandsOn,
  CLOSE_TODAY: closeToday,
  SET_SET_MENU: setSetMenu,
  SET_OWNER_PROFILE: setOwnerProfile,
  BUY_DECOR: buyDecor,
  REFRESH_DECOR: refreshDecor,
  STARTER_LOAN: starterLoan,
};

export function dispatch(content: ContentPack, state: GameState, cmd: Command): StepResult {
  if (state.phase === "gameover") return reject(state, "The restaurant has closed. Start a new game.");
  // Round 11 (G9): own keys only — "toString", "__proto__" and friends are not commands.
  const type = (cmd as { type?: unknown } | null | undefined)?.type;
  const handler = typeof type === "string" && Object.hasOwn(HANDLERS, type) ? (HANDLERS[type as Command["type"]] as Handler<Command["type"]>) : undefined;
  if (!handler) return reject(state, "Unknown command.");
  const r = handler(content, state, cmd as never);
  if (rejected.has(r)) return r;
  // Goals track what the player does (menu, hires, orders, opening, incidents).
  const g = updateGoals(content, r.state);
  if (g.state === r.state) return r;
  return { state: foldLog(g.state, g.events), events: [...r.events, ...g.events] };
}

