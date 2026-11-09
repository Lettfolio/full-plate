/**
 * IncidentSystem — small live problems during service that the player can react to with one click.
 *
 *  - floorSystem (first each tick): ends staff breaks and drops expired incident modifiers.
 *  - incidentSystem (after ServiceSystem): counts live incidents down (timeout ⇒ the `ignored` outcome),
 *    scores critics who walked out, and may start one new incident whose condition holds.
 *  - respondIncident: applies a chosen option (RESPOND_INCIDENT).
 *  - closeIncidents: at close, anything still live resolves as "ignored" with no further effect.
 *
 * Rules: ≤ INCIDENT_MAX_LIVE live at once, never two live of the same kind, ≤ INCIDENT_MAX_PER_SERVICE per
 * service, at least INCIDENT_MIN_GAP_TICKS between starts. Outcomes are mechanical (cash, chef time, FOH actions,
 * satisfaction, stock, prestige); all text comes from src/incidents/text.ts.
 */
import {
  BREAK_FATIGUE_RELIEF,
  BREAK_TICKS,
  DIFFICULTY,
  INCIDENT,
  INCIDENT_LAST_START_TICK,
  INCIDENT_MAX_LIVE,
  INCIDENT_MAX_PER_SERVICE,
  INCIDENT_MIN_GAP_TICKS,
  INCIDENT_RATES,
  INCIDENT_TIMEOUT_TICKS,
  LAST_SEATING_TICK,
  PATIENCE_START,
  RUSH_MIN_POTENTIAL_PARTIES,
  RUSH_MIN_QUEUE,
  SENT_BACK_QUALITY,
  STAFF_WOBBLE_FATIGUE,
  VIP_MIN_POPULARITY,
} from "../constants";
import { incidentLinesOf, incidentTextOf } from "../contentText";
import { fill } from "../incidents/text";
import type { Rng } from "../rng";
import { addStock, canPlate, consumeDish, purchaseCost } from "../stock";
import type {
  ContentPack,
  Customer,
  GameState,
  Incident,
  IncidentKind,
  IncidentOption,
  KitchenTicket,
  ServiceMod,
  ServiceTally,
  SimEvent,
  Staff,
} from "../types";
import {
  clamp,
  findDish,
  findIngredient,
  findSegment,
  logEvent,
  monthOf,
  onFloor,
  onShift,
  plateCost,
  round2,
  tallyOf,
} from "../util";
import { offeredDishes, newCustomer, planArrivals } from "./arrival";
import { OWNER_ID, cooksOnShift } from "./kitchen";
import { findTable } from "./seating";
import { effectiveCharm, effectiveSkill, refreshFloor, type SystemResult } from "./system";

const money = (p: number): string => `£${(p / 100).toFixed(p % 100 === 0 ? 0 : 2)}`;
const tableNo = (id: string | undefined): string => (id ?? "").replace(/^T/, "");
const isFoh = (s: Staff): boolean => s.role === "server" || s.role === "bar" || s.role === "manager";

export const liveIncidents = (state: GameState): Incident[] => (state.incidents ?? []).filter((i) => !i.resolution);

// ── helpers on the service tally ──
function addMod(state: GameState, mod: ServiceMod): GameState {
  const t = tallyOf(state);
  return { ...state, service: { ...t, mods: [...(t.mods ?? []), mod] } };
}

function dropMods(state: GameState, source: string): GameState {
  const t = tallyOf(state);
  if (!t.mods?.some((m) => m.source === source)) return state;
  return { ...state, service: { ...t, mods: t.mods.filter((m) => m.source !== source) } };
}

function patchTally(state: GameState, patch: Partial<ServiceTally>): GameState {
  return { ...state, service: { ...tallyOf(state), ...patch } };
}

function patchCustomer(state: GameState, id: string | undefined, fn: (c: Customer) => Customer): GameState {
  if (!id) return state;
  return { ...state, customers: state.customers.map((c) => (c.id === id ? fn(c) : c)) };
}

const bonus = (n: number) => (c: Customer): Customer => ({ ...c, satisfactionBonus: round2((c.satisfactionBonus ?? 0) + n) });

function spendCash(state: GameState, cost: number): GameState {
  if (cost <= 0) return state;
  const t = tallyOf(state);
  return { ...state, cash: state.cash - cost, service: { ...t, incidentCosts: (t.incidentCosts ?? 0) + cost } };
}

/** The most charming member of front of house on the floor (undefined ⇒ the owner). */
function bestFoh(content: ContentPack, state: GameState): Staff | undefined {
  let best: Staff | undefined;
  for (const s of onShift(state)) if (isFoh(s) && (!best || effectiveCharm(content, s) > effectiveCharm(content, best))) best = s;
  return best;
}

function charmOf(content: ContentPack, state: GameState, s: Staff | undefined): number {
  return s ? effectiveCharm(content, s) : tallyOf(state).frontCharm ?? 50;
}

// ── floor upkeep (first system each tick) ──
export function floorSystem(content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  let s = state;
  if (s.staff.some((x) => x.breakUntilTick !== undefined && x.breakUntilTick <= s.tick)) {
    const events: SimEvent[] = [];
    const staff = s.staff.map((x) => {
      if (x.breakUntilTick === undefined || x.breakUntilTick > s.tick) return x;
      events.push(logEvent(s, `${x.name} is back from their break.`, "info"));
      const { breakUntilTick: _b, ...rest } = x;
      return rest;
    });
    s = refreshFloor(content, { ...s, staff });
    return { state: pruneMods(s), events };
  }
  return { state: pruneMods(s), events: [] };
}

function pruneMods(state: GameState): GameState {
  const mods = state.service?.mods;
  if (!mods || mods.every((m) => m.untilTick > state.tick)) return state;
  return patchTally(state, { mods: mods.filter((m) => m.untilTick > state.tick) });
}

// ── building incidents ──
interface Ctx {
  customer?: Customer;
  staff?: Staff;
  dishId?: string;
  ingredientId?: string;
  value?: number;
}

function textVars(content: ContentPack, state: GameState, i: Pick<Incident, "tableId" | "dishId" | "staffId" | "value" | "kind">, cost?: number) {
  const staff = state.staff.find((s) => s.id === i.staffId);
  const ingredientId = i.kind === "supplier_short" ? state.shortDelivery?.ingredientId : undefined;
  return {
    table: tableNo(i.tableId),
    dish: i.dishId ? findDish(content, i.dishId)?.name ?? i.dishId : "the dish",
    name: staff?.name ?? "You",
    size: i.value,
    missing: i.value,
    ingredient: ingredientId ? findIngredient(content, ingredientId)?.name ?? ingredientId : "stock",
    cost: cost === undefined ? undefined : money(cost),
  };
}

/** Option ids and their costs for an incident (an option missing here is not offered). */
function optionCosts(content: ContentPack, state: GameState, kind: IncidentKind, ctx: Ctx): Record<string, number | undefined> {
  switch (kind) {
    case "sent_back":
      return { remake: undefined, comp: ctx.customer?.spend ?? 0, apologise: undefined };
    case "spill":
      return { mop: undefined, leave: undefined };
    case "big_party":
      return { push: undefined, decline: undefined };
    case "rush":
      return ctx.dishId ? { callin: INCIDENT.rushCallInCost, simplify: undefined, ride: undefined } : { callin: INCIDENT.rushCallInCost, ride: undefined };
    case "supplier_short":
      return { shop: cornerShopCost(content, state), pull: undefined };
    case "equipment":
      return { fix: undefined, engineer: INCIDENT.engineerCost };
    case "vip":
      return { best: undefined, freebie: freebieCost(content, state), normal: undefined };
    case "staff_wobble":
      return { break: undefined, push: undefined };
  }
}

export function cornerShopCost(content: ContentPack, state: GameState): number {
  const short = state.shortDelivery;
  const ing = short && findIngredient(content, short.ingredientId);
  if (!short || !ing) return 0;
  return Math.round(purchaseCost(ing, short.missing, monthOf(state.day), DIFFICULTY[state.difficulty].costMult) * INCIDENT.cornerShopMult);
}

/** A starter or dessert on the house: the cheapest one's ingredient cost (or a flat fallback). */
function freebieCost(content: ContentPack, state: GameState): number {
  let best: number | undefined;
  for (const o of offeredDishes(content, state)) {
    if (o.dish.course !== "starter" && o.dish.course !== "dessert") continue;
    const c = plateCost(content, o.dish);
    if (best === undefined || c < best) best = c;
  }
  return best ?? INCIDENT.vipFreebieCost;
}

function buildIncident(content: ContentPack, state: GameState, rng: Rng, kind: IncidentKind, ctx: Ctx): Incident {
  const t = tallyOf(state);
  const [lo, hi] = INCIDENT_TIMEOUT_TICKS;
  const base = {
    kind,
    ...(ctx.customer ? { customerId: ctx.customer.id } : {}),
    ...(ctx.customer?.tableId ? { tableId: ctx.customer.tableId } : {}),
    ...(ctx.staff ? { staffId: ctx.staff.id } : {}),
    ...(ctx.dishId ? { dishId: ctx.dishId } : {}),
    ...(ctx.value !== undefined ? { value: ctx.value } : {}),
  };
  const text = incidentTextOf(content)[kind];
  const options: IncidentOption[] = Object.entries(optionCosts(content, state, kind, ctx)).map(([id, cost]) => {
    const o = text.options[id]!;
    const vars = textVars(content, state, base, cost);
    return { id, label: fill(o.label, vars), description: fill(o.description, vars), ...(cost ? { cost } : {}) };
  });
  const vars = textVars(content, state, base);
  const inc: Incident = {
    id: `i${state.day}-${t.incidentsStarted ?? 0}`,
    startedTick: state.tick,
    ticksLeft: rng.int(lo, hi),
    title: fill(text.title, vars),
    body: fill(text.body, vars),
    options,
    ...base,
  };
  return withAvailability(content, state, inc);
}

// ── option availability (IncidentOption.disabled) ──
/** Why an option can't be chosen right now, mirroring the checks in respondIncident/applyOption. */
function optionBlocker(content: ContentPack, state: GameState, inc: Incident, o: IncidentOption): string | undefined {
  if ((o.cost ?? 0) > 0 && o.id !== "comp" && state.cash < o.cost!) return incidentLinesOf(content).cantAfford;
  switch (`${inc.kind}:${o.id}`) {
    case "big_party:push": {
      const first = findTable(state.tables, 1);
      return first && findTable(state.tables.filter((x) => x.id !== first.id), 1) ? undefined : incidentLinesOf(content).needTablesShort;
    }
    case "sent_back:remake": {
      const dish = inc.dishId ? findDish(content, inc.dishId) : undefined;
      return dish && !canPlate(state.stock, dish) ? fill(incidentLinesOf(content).noStockRemake, { dish: dish.name }) : undefined;
    }
    case "staff_wobble:break": {
      const who = state.staff.find((x) => x.id === inc.staffId);
      return who && onFloor(who, state) ? undefined : fill(incidentLinesOf(content).notOnFloor, { name: who?.name ?? "They" });
    }
  }
  return undefined;
}

/** The incident with each option's `disabled` reason brought up to date (the same object when nothing changed). */
function withAvailability(content: ContentPack, state: GameState, inc: Incident): Incident {
  let changed = false;
  const options = inc.options.map((o) => {
    const why = optionBlocker(content, state, inc, o);
    if (why === o.disabled) return o;
    changed = true;
    if (why === undefined) {
      const { disabled: _d, ...rest } = o;
      return rest;
    }
    return { ...o, disabled: why };
  });
  return changed ? { ...inc, options } : inc;
}

// ── conditions: each returns the context for a new incident, or undefined ──
type Detector = (content: ContentPack, state: GameState, rng: Rng) => Ctx | undefined;

const meanQuality = (c: Customer): number => (c.order.length ? (c.qualitySum ?? 0) / c.order.length : 100);

const DETECTORS: Record<IncidentKind, Detector> = {
  sent_back: (_c, state, rng) => {
    for (const customer of state.customers) {
      if (customer.stage !== "eating" || customer.stageTick !== state.tick || customer.comped || meanQuality(customer) >= SENT_BACK_QUALITY) continue;
      if (rng.chance(INCIDENT_RATES.sentBackPerParty)) return { customer, dishId: customer.order[0], value: round2(meanQuality(customer)) };
    }
    return undefined;
  },
  spill: (_c, state, rng) => {
    let covers = 0;
    for (const c of state.customers) if (c.tableId && (c.stage === "seated" || c.stage === "ordered" || c.stage === "eating")) covers += c.partySize;
    // One draw for "does anything spill this tick"; only then pick the table.
    if (covers === 0 || !rng.chance(covers * INCIDENT_RATES.spillPerCoverTick)) return undefined;
    const seated = state.customers.filter((c) => c.tableId && (c.stage === "seated" || c.stage === "ordered" || c.stage === "eating"));
    return { customer: rng.pick(seated) };
  },
  big_party: (content, state, rng) => {
    if (state.tick > LAST_SEATING_TICK || !rng.chance(INCIDENT_RATES.bigParty)) return undefined;
    if (tallyOf(state).arrivals.every((a) => a.entryLogit <= -40)) return undefined; // nothing on the menu
    const seats = content.balance.seatsPerTable;
    return { value: rng.int(seats + 1, seats * 2) };
  },
  rush: (content, state, rng) => {
    const t = tallyOf(state);
    if (state.tick > LAST_SEATING_TICK - INCIDENT.rushTicks || t.potentialParties < RUSH_MIN_POTENTIAL_PARTIES) return undefined;
    let queue = 0;
    for (const c of state.customers) if (c.stage === "queue") queue++;
    if (queue < RUSH_MIN_QUEUE || !rng.chance(INCIDENT_RATES.rush)) return undefined;
    // The slowest dish on offer is the one to pull (only offered if pulling leaves a menu).
    const offered = offeredDishes(content, state);
    const slowest = offered.length > 1 ? [...offered].sort((a, b) => b.dish.prepTicks - a.dish.prepTicks || a.dish.id.localeCompare(b.dish.id))[0] : undefined;
    return { ...(slowest ? { dishId: slowest.dish.id } : {}) };
  },
  supplier_short: (content, state, rng) => {
    const short = state.shortDelivery;
    if (!short || (state.incidents ?? []).some((i) => i.kind === "supplier_short") || !rng.chance(INCIDENT_RATES.supplierShort)) return undefined;
    const uses = offeredDishes(content, state).find((o) => o.dish.ingredients.some((x) => x.id === short.ingredientId));
    if (!uses) return undefined;
    return { dishId: uses.dish.id, ingredientId: short.ingredientId, value: short.missing };
  },
  equipment: (_c, state, rng) => (state.tickets.length > 0 && rng.chance(INCIDENT_RATES.equipment) ? {} : undefined),
  vip: (_c, state, rng) => {
    if (state.reputation.popularity <= VIP_MIN_POPULARITY) return undefined;
    if ((state.incidents ?? []).some((i) => i.kind === "vip") || !rng.chance(INCIDENT_RATES.vip)) return undefined;
    const seated = state.customers.filter((c) => c.stage === "seated" && c.tableId);
    return seated.length ? { customer: rng.pick(seated) } : undefined;
  },
  staff_wobble: (_c, state, rng) => {
    if (!state.staff.some((s) => s.fatigue > STAFF_WOBBLE_FATIGUE)) return undefined;
    const already = new Set((state.incidents ?? []).filter((i) => i.kind === "staff_wobble").map((i) => i.staffId));
    const tired = onShift(state).filter((s) => s.fatigue > STAFF_WOBBLE_FATIGUE && !already.has(s.id));
    if (tired.length === 0 || !rng.chance(INCIDENT_RATES.staffWobble)) return undefined;
    return { staff: rng.pick(tired) };
  },
};

/** Fixed detection order so draws are deterministic. */
const KINDS: readonly IncidentKind[] = ["sent_back", "spill", "big_party", "rush", "supplier_short", "equipment", "vip", "staff_wobble"];

/** Effects applied the moment an incident starts (the problem itself). */
function onStart(state: GameState, inc: Incident): GameState {
  if (inc.kind === "rush") {
    return addMod(state, { kind: "arrivals", value: INCIDENT.rushArrivalMult, untilTick: state.tick + INCIDENT.rushTicks, source: inc.id });
  }
  if (inc.kind === "equipment") {
    // The fryer is down until someone deals with it.
    return addMod(state, { kind: "kitchen", value: 0.5, untilTick: state.tick + inc.ticksLeft + 1, source: inc.id });
  }
  if (inc.kind === "vip") return patchCustomer(state, inc.customerId, (c) => ({ ...c, vip: true }));
  return state;
}

const NONE: SimEvent[] = [];

function maybeStart(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const t = tallyOf(state);
  if (state.tick > INCIDENT_LAST_START_TICK || (t.incidentsStarted ?? 0) >= INCIDENT_MAX_PER_SERVICE) return { state, events: NONE };
  const live = liveIncidents(state);
  if (state.tick > INCIDENT_LAST_START_TICK || live.length >= INCIDENT_MAX_LIVE) return { state, events: [] };
  if ((t.incidentsStarted ?? 0) >= INCIDENT_MAX_PER_SERVICE) return { state, events: [] };
  if (t.lastIncidentTick !== undefined && state.tick - t.lastIncidentTick < INCIDENT_MIN_GAP_TICKS) return { state, events: [] };
  const liveKinds = new Set(live.map((i) => i.kind));
  for (const kind of KINDS) {
    if (liveKinds.has(kind)) continue;
    const ctx = DETECTORS[kind](content, state, rng);
    if (!ctx) continue;
    const inc = buildIncident(content, state, rng, kind, ctx);
    let s: GameState = { ...state, incidents: [...(state.incidents ?? []), inc] };
    s = patchTally(s, { incidentsStarted: (t.incidentsStarted ?? 0) + 1, lastIncidentTick: state.tick });
    // A porter on shift deals with spills before anyone has to decide (no floor time lost, a small bonus).
    if (kind === "spill" && onShift(s, "porter").length) {
      s = patchCustomer(s, inc.customerId, bonus(INCIDENT.spillCleanBonus));
      const porter = onShift(s, "porter")[0]!;
      const r = finish(s, inc, "porter", fill(incidentLinesOf(content).porterMopped, { name: porter.name, table: tableNo(inc.tableId) }), "good");
      return { state: r.state, events: r.events };
    }
    s = onStart(s, inc);
    return { state: s, events: [{ type: "INCIDENT_STARTED", incidentId: inc.id }, logEvent(state, inc.title, "info")] };
  }
  return { state, events: [] };
}

// ── resolving ──
type Tone = "good" | "bad" | "neutral";
const LOG_KIND: Record<Tone, "good" | "bad" | "info"> = { good: "good", bad: "bad", neutral: "info" };

/** How a chosen option reads: most fixes are good; leaving a mess or pushing a tired person on is not. */
const OPTION_TONE: Partial<Record<string, Tone>> = {
  "spill:leave": "bad",
  "staff_wobble:push": "bad",
  "big_party:decline": "neutral",
  "rush:ride": "neutral",
  "vip:normal": "neutral",
};
export const optionTone = (kind: IncidentKind, optionId: string): Tone =>
  optionId === "ignored" ? "bad" : OPTION_TONE[`${kind}:${optionId}`] ?? "good";

function finish(state: GameState, inc: Incident, resolution: string, outcome: string, tone: Tone): SystemResult {
  const incidents = (state.incidents ?? []).map((i) => (i.id === inc.id ? { ...i, resolution, outcome, ticksLeft: 0 } : i));
  return {
    state: { ...state, incidents },
    events: [{ type: "INCIDENT_RESOLVED", incidentId: inc.id, resolution, outcome, tone }, logEvent(state, outcome, LOG_KIND[tone])],
  };
}

function outcomeText(content: ContentPack, state: GameState, inc: Incident, optionId: string, staffId?: string): string {
  const text = incidentTextOf(content)[inc.kind];
  const template = optionId === "ignored" ? text.ignored : text.options[optionId]?.outcome ?? text.ignored;
  const vars = textVars(content, state, { ...inc, ...(staffId ? { staffId } : {}) }, inc.options.find((o) => o.id === optionId)?.cost);
  return fill(template, vars);
}

/** The `ignored` effects (timeout). */
function applyIgnored(content: ContentPack, state: GameState, inc: Incident): GameState {
  const s = dropMods(state, inc.id);
  switch (inc.kind) {
    case "sent_back":
      return patchCustomer(s, inc.customerId, bonus(INCIDENT.sentBackIgnoredHit));
    case "spill":
      return patchCustomer(s, inc.customerId, bonus(INCIDENT.spillIgnoredHit));
    case "big_party":
      return patchTally(s, { popularityBonus: round2((tallyOf(s).popularityBonus ?? 0) + INCIDENT.bigPartyIgnoredPopularity) });
    case "equipment":
      return addMod(s, { kind: "kitchen", value: INCIDENT.equipmentIgnoredKitchen, untilTick: s.tick + INCIDENT.equipmentIgnoredTicks, source: inc.id });
    case "staff_wobble":
      return {
        ...s,
        staff: s.staff.map((x) =>
          x.id === inc.staffId
            ? { ...x, mood: round2(clamp(x.mood + INCIDENT.wobbleIgnoredMood, 0, 100)), fatigue: round2(clamp(x.fatigue + INCIDENT.wobbleIgnoredFatigue, 0, 100)) }
            : x,
        ),
      };
    case "rush": // the surge carries on regardless
      return state;
    default:
      return s;
  }
}

export function incidentSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const t = tallyOf(state);
  const idle = state.tick > INCIDENT_LAST_START_TICK || (t.incidentsStarted ?? 0) >= INCIDENT_MAX_PER_SERVICE;
  if (idle && !state.incidents?.some((i) => !i.resolution) && !state.customers.some((c) => c.vip)) return { state, events: NONE };
  let s = state;
  const events: SimEvent[] = [];
  for (const inc of liveIncidents(state)) {
    if (inc.ticksLeft > 1) {
      const cur = s;
      s = { ...s, incidents: (s.incidents ?? []).map((i) => (i.id === inc.id ? withAvailability(content, cur, { ...i, ticksLeft: i.ticksLeft - 1 }) : i)) };
      continue;
    }
    s = applyIgnored(content, s, inc);
    const r = finish(s, inc, "ignored", outcomeText(content, s, inc, "ignored"), "bad");
    s = r.state;
    events.push(...r.events);
  }
  // A critic who walked out this tick writes a stinker.
  for (const c of s.customers) {
    if (c.vip && c.walkedOut && c.leftTick === s.tick) {
      s = patchTally(s, { prestigeBonus: round2((tallyOf(s).prestigeBonus ?? 0) + INCIDENT.vipWalkoutPrestige) });
      events.push(logEvent(s, incidentLinesOf(content).vipWalkout, "bad"));
    }
  }
  const started = maybeStart(content, s, rng);
  if (started.events.length === 0) return { state: started.state, events };
  return { state: started.state, events: [...events, ...started.events] };
}

/** Prestige verdict when a critic pays (called by PaymentSystem). */
export function vipVerdict(content: ContentPack, state: GameState, rating: number, delta: number): SimEvent[] {
  const line = delta > 0 ? incidentLinesOf(content).vipVerdictGood : delta < 0 ? incidentLinesOf(content).vipVerdictBad : incidentLinesOf(content).vipVerdictMeh;
  return [logEvent(state, fill(line, { stars: rating }), delta > 0 ? "good" : delta < 0 ? "bad" : "info")];
}

/** At close: whatever is still live ends quietly. */
export function closeIncidents(state: GameState, content?: ContentPack): SystemResult {
  let s = state;
  const events: SimEvent[] = [];
  for (const inc of liveIncidents(state)) {
    const r = finish(dropMods(s, inc.id), inc, "ignored", incidentLinesOf(content).closingTime, "neutral");
    s = r.state;
    events.push(r.events[0]!); // no ticker line for each one at closing
  }
  return { state: s, events };
}

// ── options (RESPOND_INCIDENT) ──
type Applied = { state: GameState; staffId?: string } | { error: string };

function remake(content: ContentPack, state: GameState, inc: Incident): Applied {
  const c = state.customers.find((x) => x.id === inc.customerId);
  const dish = inc.dishId ? findDish(content, inc.dishId) : undefined;
  if (!c || c.stage === "left" || !dish) return { error: "That table has already gone." };
  if (!canPlate(state.stock, dish)) return { error: fill(incidentLinesOf(content).noStockRemake, { dish: dish.name }) };
  const used = consumeDish(content, state.stock, dish, state.day, monthOf(state.day));
  const t = tallyOf(state);
  // The best cook on the floor drops everything for it.
  const cooks = cooksOnShift(content, state).filter((k) => !k.drinksOnly);
  const cook = [...cooks].sort((a, b) => b.skill - a.skill)[0];
  const ticket: KitchenTicket = {
    id: `t${state.day}-${t.nextTicket + 1}`,
    customerId: c.id,
    dishId: dish.id,
    createdTick: state.tick,
    ticksRemaining: INCIDENT.remakeTicks,
    quality: 0,
    freshness: used.freshness,
    remakeOf: inc.value ?? meanQuality(c),
    ...(cook ? { chefId: cook.id } : {}),
  };
  const usedMap = { ...t.ingredientsUsed };
  for (const ing of dish.ingredients) usedMap[ing.id] = (usedMap[ing.id] ?? 0) + ing.qty;
  let s: GameState = { ...state, stock: used.stock, tickets: [ticket, ...state.tickets] };
  s = patchTally(s, { nextTicket: t.nextTicket + 1, foodCost: (t.foodCost ?? 0) + used.cost, ingredientsUsed: usedMap });
  s = patchCustomer(s, c.id, (x) => ({
    ...x,
    foodCost: Math.round((x.foodCost ?? 0) + used.cost),
    eatUntil: Math.max(x.eatUntil ?? s.tick, s.tick + INCIDENT.remakeTicks + INCIDENT.remakeWaitTicks),
  }));
  return { state: s, ...(cook && cook.id !== OWNER_ID ? { staffId: cook.id } : {}) };
}

function pushTables(content: ContentPack, state: GameState, inc: Incident): Applied {
  const size = inc.value ?? content.balance.seatsPerTable + 1;
  const first = findTable(state.tables, 1);
  const second = first && findTable(state.tables.filter((x) => x.id !== first.id), 1);
  if (!first || !second) return { error: incidentLinesOf(content).needTables };
  const t = tallyOf(state);
  // The district's commonest walk-in segment (deterministic).
  const plan = [...(t.arrivals.length ? t.arrivals : planArrivals(content, state))].sort((a, b) => b.potentialParties - a.potentialParties || a.segment.localeCompare(b.segment));
  const seg = plan.map((p) => findSegment(content, p.segment)).find(Boolean) ?? content.segments[0];
  if (!seg) return { error: "Nobody to seat." };
  const id = `c${state.day}-${t.nextCustomer}`;
  const guest: Customer = { ...newCustomer(id, seg, size, state.tick), stage: "seated", tableId: first.id, stageTick: state.tick, patience: PATIENCE_START };
  const tables = state.tables.map((x) => (x.id === first.id || x.id === second.id ? { ...x, occupiedBy: id } : x));
  let s: GameState = { ...state, tables, customers: [...state.customers, guest] };
  s = patchTally(s, { nextCustomer: t.nextCustomer + 1, parties: t.parties + 1 });
  s = addMod(s, { kind: "actions", value: INCIDENT.bigPartyServerActions, untilTick: s.tick + INCIDENT.bigPartyServerTicks, source: inc.id });
  return { state: s };
}

function giveBreakTo(content: ContentPack, state: GameState, staffId: string | undefined): Applied {
  const who = state.staff.find((x) => x.id === staffId);
  if (!who || !onFloor(who, state)) return { error: fill(incidentLinesOf(content).notOnFloor, { name: who?.name ?? "They" }) };
  return { state: startBreak(content, state, who) };
}

/** GIVE_BREAK effect: fatigue down, off the floor for BREAK_TICKS (owner/others cover). */
export function startBreak(content: ContentPack, state: GameState, who: Staff): GameState {
  const staff = state.staff.map((x) =>
    x.id === who.id ? { ...x, fatigue: round2(clamp(x.fatigue - BREAK_FATIGUE_RELIEF, 0, 100)), breakUntilTick: state.tick + BREAK_TICKS } : x,
  );
  return refreshFloor(content, { ...state, staff });
}

function applyOption(content: ContentPack, state: GameState, inc: Incident, optionId: string): Applied {
  const cost = inc.options.find((o) => o.id === optionId)?.cost ?? 0;
  switch (`${inc.kind}:${optionId}`) {
    case "sent_back:remake":
      return remake(content, state, inc);
    case "sent_back:comp": {
      const c = state.customers.find((x) => x.id === inc.customerId);
      if (!c || c.stage === "left") return { error: "That table has already gone." };
      return { state: patchCustomer(state, c.id, (x) => ({ ...x, comped: true })) };
    }
    case "sent_back:apologise": {
      const who = bestFoh(content, state);
      const s = patchCustomer(state, inc.customerId, bonus(round2((INCIDENT.apologyMaxBonus * charmOf(content, state, who)) / 100)));
      return { state: s, ...(who ? { staffId: who.id } : {}) };
    }
    case "spill:mop": {
      const s = patchCustomer(state, inc.customerId, bonus(INCIDENT.spillCleanBonus));
      if (onShift(s, "porter").length) return { state: s }; // the porter has it
      return { state: addMod(s, { kind: "actions", value: INCIDENT.spillServerActions, untilTick: s.tick + INCIDENT.spillServerTicks, source: inc.id }) };
    }
    case "spill:leave":
      return { state: patchCustomer(state, inc.customerId, bonus(INCIDENT.spillIgnoredHit / 2)) };
    case "big_party:push":
      return pushTables(content, state, inc);
    case "big_party:decline":
      return { state: patchTally(state, { popularityBonus: round2((tallyOf(state).popularityBonus ?? 0) + INCIDENT.bigPartyTurnAwayPopularity) }) };
    case "rush:callin": {
      let s = spendCash(state, cost);
      const until = s.tick + INCIDENT.rushTicks;
      s = addMod(s, { kind: "actions", value: INCIDENT.rushCallInActions, untilTick: until, source: `${inc.id}-help` });
      return { state: addMod(s, { kind: "kitchen", value: INCIDENT.rushCallInKitchen, untilTick: until, source: `${inc.id}-help` }) };
    }
    case "rush:simplify": {
      if (!inc.dishId) return { error: "There's nothing to take off." };
      let s: GameState = { ...state, eightySixed: [...new Set([...(state.eightySixed ?? []), inc.dishId])] };
      s = patchTally(s, { arrivals: planArrivals(content, s) });
      return { state: addMod(s, { kind: "kitchen", value: INCIDENT.rushSimplifyKitchen, untilTick: s.tick + INCIDENT.rushTicks, source: `${inc.id}-help` }) };
    }
    case "rush:ride":
      return { state };
    case "supplier_short:shop": {
      const short = state.shortDelivery;
      if (!short) return { error: "The delivery problem has sorted itself out." };
      const stock = addStock(state.stock, short.ingredientId, short.missing, state.day, cost / short.missing);
      const { shortDelivery: _s, ...rest } = state;
      // Stock, not an incident cost: it reaches the P&L as food cost (or waste) when used.
      return { state: { ...rest, cash: state.cash - cost, stock } };
    }
    case "supplier_short:pull": {
      const id = state.shortDelivery?.ingredientId;
      const pulled = state.menu
        .filter((m) => findDish(content, m.dishId)?.ingredients.some((x) => x.id === id))
        .map((m) => m.dishId);
      let s: GameState = { ...state, eightySixed: [...new Set([...(state.eightySixed ?? []), ...pulled])] };
      s = patchTally(s, { arrivals: planArrivals(content, s) });
      return { state: s };
    }
    case "equipment:fix": {
      const s = dropMods(state, inc.id);
      // A porter does the fetching and holding: the fryer's back quicker (as fast as the engineer, but free).
      if (onShift(s, "porter").length) {
        return { state: addMod(s, { kind: "kitchen", value: INCIDENT.engineerKitchen, untilTick: s.tick + INCIDENT.engineerTicks, source: inc.id }) };
      }
      const chef = onShift(s, "chef").sort((a, b) => effectiveSkill(content, b) - effectiveSkill(content, a))[0];
      return {
        state: addMod(s, { kind: "kitchen", value: INCIDENT.equipmentFixKitchen, untilTick: s.tick + INCIDENT.equipmentFixTicks, source: inc.id }),
        ...(chef ? { staffId: chef.id } : {}),
      };
    }
    case "equipment:engineer": {
      const s = spendCash(dropMods(state, inc.id), cost);
      return { state: addMod(s, { kind: "kitchen", value: INCIDENT.engineerKitchen, untilTick: s.tick + INCIDENT.engineerTicks, source: inc.id }) };
    }
    case "vip:best": {
      const who = bestFoh(content, state);
      let s = patchCustomer(state, inc.customerId, bonus(round2((INCIDENT.vipBestServerMaxBonus * charmOf(content, state, who)) / 100)));
      s = addMod(s, { kind: "actions", value: INCIDENT.vipServerActions, untilTick: s.tick + INCIDENT.vipServerTicks, source: inc.id });
      return { state: s, ...(who ? { staffId: who.id } : {}) };
    }
    case "vip:freebie":
      return { state: patchCustomer(spendCash(state, cost), inc.customerId, bonus(INCIDENT.vipFreebieBonus)) };
    case "vip:normal":
      return { state };
    case "staff_wobble:break":
      return giveBreakTo(content, state, inc.staffId);
    case "staff_wobble:push":
      return {
        state: { ...state, staff: state.staff.map((x) => (x.id === inc.staffId ? { ...x, mood: round2(clamp(x.mood + INCIDENT.wobblePushOnMood, 0, 100)) } : x)) },
      };
  }
  return { error: "That isn't one of the options." };
}

/** RESPOND_INCIDENT: validates and applies one option. */
export function respondIncident(content: ContentPack, state: GameState, incidentId: string, optionId: string): SystemResult | { error: string } {
  const inc = (state.incidents ?? []).find((i) => i.id === incidentId);
  if (!inc) return { error: "That problem has gone away." };
  if (inc.resolution) return { error: "You've already dealt with that." };
  const opt = inc.options.find((o) => o.id === optionId);
  if (!opt) return { error: "That isn't one of the options." };
  const cost = opt.cost ?? 0;
  if (cost > 0 && optionId !== "comp" && state.cash < cost) return { error: `You can't afford that (${money(cost)}).` };
  const applied = applyOption(content, state, inc, optionId);
  if ("error" in applied) return applied;
  const s = { ...applied.state, incidentsHandled: (applied.state.incidentsHandled ?? 0) + 1 };
  // Text is filled from the state *before* the option (buying at the corner shop clears shortDelivery, which names
  // the ingredient); the staff member who acted comes from the option.
  return finish(s, inc, optionId, outcomeText(content, state, inc, optionId, applied.staffId), optionTone(inc.kind, optionId));
}
