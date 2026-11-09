/**
 * The hands-on session: a pure state machine over (session, GameState, input, dt).
 *
 * Determinism: nothing here reads the clock or Math.random. Time is the sum of the dt values passed in; the only
 * randomness (chop-mark jitter, where the green band sits) comes from sim-core's xoshiro Rng whose state lives in the
 * session. The same session + state + input/dt sequence always gives identical sessions and results.
 */
import { weekdayOf, type ContentPack, type Customer, type GameState, type KitchenTicket, type TableId } from "@full-plate/sim-core";
import { buildLayout, dishProfiles, isBlocked, profileFor, SPAWN } from "./layout";
import { Rng, hashSeed } from "./rng";
import { addPoints, emptyScore } from "./score";
import type {
  ActiveAction, CarriedPlate, DishProfile, HandsOnInput, HandsOnResult, HandsOnRole, HandsOnSession, Item, Prompt,
  Station, UpdateResult, Verb,
} from "./types";
import { chefSpeedBonus, chopHit, cookBand, cookQuality, plateExecution, POINTS, pourQuality, serveSpeedBonus, TUNING } from "./verbs";
import { COVER_EXECUTION, stationTickets, type StationPlan } from "./station";
import { railCapFor } from "./pacing";

/** A plate whose ticket waited longer than this (seconds) "went cold" on the end-of-shift notes. */
export const COLD_PLATE_SECS = 60;
/** The "need a hand?" nudge comes at this share of the sous chef's idle cover time. */
export const NUDGE_SHARE = 0.6;

export interface SessionOptions {
  /** Show the next sensible action as a hint with a pointer (default true for the first shift). */
  tutorial?: boolean;
  /** Shift mode: the session ends after this many seconds (the demo uses 180). Omit for an open-ended "jump in". */
  shiftSeconds?: number;
  /** The player's Staff id in the GameState, if they are one (career mode). Chef verbs then only take tickets assigned to them or unassigned. */
  playerStaffId?: string;
  /** Content pack for real dish names, food costs and quality ceilings. */
  content?: ContentPack;
  /** Seed for verb variation; defaults to a hash of the state's seed, day and tick. */
  seed?: number;
  /**
   * Round 4 career commis station (station.ts `commisStation`): the chef only sees and takes tickets on their own
   * rail; a sous chef covers when they idle. The game sends the same dishIds/cap to sim-core's SET_HANDS_ON.
   */
  station?: StationPlan;
}

export const PLAYER_RADIUS = 0.32;

export const NO_INPUT: HandsOnInput = { up: false, down: false, left: false, right: false, interact: false, cancel: false };

export function createSession(state: GameState, role: HandsOnRole, opts: SessionOptions = {}): HandsOnSession {
  const L = buildLayout(state.tables);
  const spawn = SPAWN[role];
  const seed = opts.seed ?? hashSeed(state.seed, state.day, state.tick, role.length);
  return {
    version: 1,
    role,
    tutorial: opts.tutorial ?? true,
    time: 0,
    player: { x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: role === "chef" ? "up" : "down", wobble: 0 },
    stations: L.stations,
    props: L.props,
    grid: L.grid,
    dishes: dishProfiles(state, opts.content),
    tableNumbers: L.tableNumbers,
    claimed: {}, cooked: {}, picked: {}, served: {}, cleared: {}, paid: {},
    seenAt: {},
    score: emptyScore(),
    ...(opts.shiftSeconds ? { shift: { duration: opts.shiftSeconds, over: false } } : {}),
    rng: Rng.fromSeed(seed).getState(),
    prevInteract: false,
    prevCancel: false,
    toasts: [],
    opts: {
      ...(opts.playerStaffId ? { playerStaffId: opts.playerStaffId } : {}),
      carryLimit: role === "server" ? 3 : role === "bar" ? 2 : 1,
      ...(opts.station && role === "chef" ? { station: { ...opts.station, dishIds: [...opts.station.dishIds] } } : {}),
    },
    lastActiveAt: 0,
    plateTimes: [],
  };
}

// ───────────────────────── derived views of the GameState ─────────────────────────

export function profile(session: HandsOnSession, dishId: string): DishProfile {
  return session.dishes[dishId] ?? profileFor(dishId);
}

const byAge = (a: KitchenTicket, b: KitchenTicket) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Food tickets the chef could start now (oldest first). */
export function openFoodTickets(session: HandsOnSession, state: GameState): KitchenTicket[] {
  if (session.opts.station) return stationTickets(session, state).filter((t) => !session.claimed[t.id]);
  const pid = session.opts.playerStaffId;
  return state.tickets
    .filter((t) => t.ticksRemaining > 0 && profile(session, t.dishId).method !== "pour" && !session.claimed[t.id] && !session.cooked[t.id]
      && (!pid || !t.chefId || t.chefId === pid))
    .sort(byAge);
}

/** Drink tickets the bar could pour now (oldest first). */
export function openDrinkTickets(session: HandsOnSession, state: GameState): KitchenTicket[] {
  return state.tickets
    .filter((t) => t.ticksRemaining > 0 && profile(session, t.dishId).method === "pour" && !session.claimed[t.id] && !session.cooked[t.id])
    .sort(byAge);
}

export function isReady(session: HandsOnSession, t: KitchenTicket): boolean {
  return (t.ticksRemaining <= 0 || !!session.cooked[t.id]) && !session.picked[t.id] && !session.served[t.id];
}

/** Plates/drinks waiting to be carried, grouped by party, oldest first. `where` = the pass (food) or the bar (drinks). */
export function readyGroups(session: HandsOnSession, state: GameState, where: "pass" | "bar"): { customerId: string; tickets: KitchenTicket[] }[] {
  const groups = new Map<string, KitchenTicket[]>();
  for (const t of [...state.tickets].sort(byAge)) {
    if (!isReady(session, t)) continue;
    const drink = profile(session, t.dishId).method === "pour";
    if ((where === "bar") !== drink) continue;
    const list = groups.get(t.customerId) ?? [];
    list.push(t);
    groups.set(t.customerId, list);
  }
  return [...groups.entries()].map(([customerId, tickets]) => ({ customerId, tickets }));
}

export function dirtyTables(session: HandsOnSession, state: GameState): TableId[] {
  return state.tables.filter((t) => t.dirtyTicks > 0 && !t.occupiedBy && !session.cleared[t.id]).map((t) => t.id);
}

export function payingParties(session: HandsOnSession, state: GameState): Customer[] {
  return state.customers.filter((c) => c.stage === "paying" && !session.paid[c.id]).sort((a, b) => (a.stageTick ?? 0) - (b.stageTick ?? 0) || a.arrivedTick - b.arrivedTick);
}

export function tableNumberOf(session: HandsOnSession, state: GameState, customerId: string): number | undefined {
  const c = state.customers.find((x) => x.id === customerId);
  return c?.tableId ? session.tableNumbers[c.tableId] : undefined;
}

// ───────────────────────── geometry ─────────────────────────

function rectDist(px: number, py: number, s: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(s.x - px, 0, px - (s.x + s.w));
  const dy = Math.max(s.y - py, 0, py - (s.y + s.h));
  return Math.hypot(dx, dy);
}

/** The station the player is at (nearest within reach; ties go to the one they face). */
export function nearestStation(session: HandsOnSession): Station | undefined {
  const { x, y, facing } = session.player;
  const fx = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const fy = facing === "up" ? -1 : facing === "down" ? 1 : 0;
  let best: Station | undefined;
  let bestScore = Infinity;
  for (const s of session.stations) {
    const d = rectDist(x, y, s);
    if (d > TUNING.reach) continue;
    const cx = s.x + s.w / 2 - x, cy = s.y + s.h / 2 - y;
    const facingBonus = (cx * fx + cy * fy) / (Math.hypot(cx, cy) || 1); // −1..1
    const score = d - 0.25 * facingBonus;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function collides(grid: readonly string[], x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-9);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r - 1e-9);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isBlocked(grid, tx, ty)) return true;
  return false;
}

function move(s: HandsOnSession, input: HandsOnInput, dt: number): number {
  let ix = input.moveX ?? ((input.right ? 1 : 0) - (input.left ? 1 : 0));
  let iy = input.moveY ?? ((input.down ? 1 : 0) - (input.up ? 1 : 0));
  const mag = Math.hypot(ix, iy);
  if (mag < 0.2) { ix = 0; iy = 0; } else if (mag > 1) { ix /= mag; iy /= mag; }
  const p = s.player;
  const tvx = ix * TUNING.walkSpeed, tvy = iy * TUNING.walkSpeed;
  const approach = (v: number, target: number) => {
    const rate = (target === 0 ? TUNING.decel : TUNING.accel) * dt;
    return Math.abs(target - v) <= rate ? target : v + Math.sign(target - v) * rate;
  };
  p.vx = approach(p.vx, tvx);
  p.vy = approach(p.vy, tvy);
  if (ix !== 0 || iy !== 0) {
    p.facing = Math.abs(ix) > Math.abs(iy) ? (ix > 0 ? "right" : "left") : (iy > 0 ? "down" : "up");
  }
  let bump = 0;
  // axis-separated sweep in small steps so a fast frame can't tunnel
  const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 0.2));
  for (let i = 0; i < steps; i++) {
    const nx = p.x + (p.vx * dt) / steps;
    if (!collides(s.grid, nx, p.y)) p.x = nx;
    else { bump = Math.max(bump, Math.abs(p.vx)); p.vx = 0; }
    const ny = p.y + (p.vy * dt) / steps;
    if (!collides(s.grid, p.x, ny)) p.y = ny;
    else { bump = Math.max(bump, Math.abs(p.vy)); p.vy = 0; }
  }
  return bump;
}

// ───────────────────────── what interact would do ─────────────────────────

interface Plan extends Prompt { start?: () => void }

const STATION_FOR: Record<string, string> = { stove: "hob", oven: "oven", fryer: "fryer" };

function plan(s: HandsOnSession, state: GameState, st: Station, results: HandsOnResult[]): Plan {
  const base = { stationId: st.id };
  const carrying = s.carrying;
  const role = s.role;
  const act = (verb: Verb, dur: number, extra: Partial<ActiveAction> = {}) => () => {
    s.activeAction = { verb, stationId: st.id, t: 0, dur, ...extra };
  };
  const no = (label: string): Plan => ({ ...base, label, enabled: false });
  const rng = () => new Rng(s.rng);
  const kitchen = st.kind === "fridge" || st.kind === "prep" || st.kind === "stove" || st.kind === "oven" || st.kind === "fryer";

  if (kitchen && role !== "chef") return no("Kitchen only — chefs' station");
  if ((st.kind === "table" || st.kind === "dishReturn") && role === "chef") return no("Front of house job");

  switch (st.kind) {
    case "fridge": {
      if (carrying) return no("Hands full");
      const next = openFoodTickets(s, state)[0];
      if (!next) return no("No tickets waiting");
      const tn = tableNumberOf(s, state, next.customerId);
      return { ...base, verb: "grab", label: `Grab ${profile(s, next.dishId).short}${tn ? ` (T${tn})` : ""}`, enabled: true, start: act("grab", TUNING.grabSecs, { ticketId: next.id }) };
    }
    case "prep": {
      if (carrying?.kind !== "raw") return no(carrying ? "Already prepped" : "Grab ingredients first");
      return {
        ...base, verb: "chop", label: `Chop ${profile(s, carrying.dishId).short}`, enabled: true,
        start: () => {
          const r = rng();
          const marks = TUNING.chopMarks.map((m) => m + (r.float() * 2 - 1) * TUNING.chopJitter);
          s.rng = r.getState();
          act("chop", TUNING.chopSecs, { marks, marked: marks.map(() => 0), ticketId: carrying.ticketId })();
        },
      };
    }
    case "stove": case "oven": case "fryer": {
      if (carrying?.kind !== "prepped") return no(carrying?.kind === "raw" ? "Chop it first" : carrying ? "Already cooked" : "Nothing to cook");
      const method = profile(s, carrying.dishId).method;
      if (method === "none") return no("Cold dish — straight to the pass");
      if (method !== st.kind) return no(`This one goes in the ${STATION_FOR[method] ?? method}`);
      const k = st.kind;
      return {
        ...base, verb: "cook", label: `Hold to cook ${profile(s, carrying.dishId).short}`, enabled: true,
        start: () => {
          const r = rng();
          const [a, b] = TUNING.cookBandCentre;
          const band = cookBand(a + r.float() * (b - a), k);
          s.rng = r.getState();
          act("cook", TUNING.cookSecs[k], { band, ticketId: carrying.ticketId })();
        },
      };
    }
    case "pass": {
      if (role === "chef") {
        if (!carrying || carrying.kind === "raw") return no(carrying ? "Prep and cook it first" : "Plates go out from here");
        if (carrying.kind === "prepped" && profile(s, carrying.dishId).method !== "none") return no("Cook it first");
        if (carrying.kind !== "prepped" && carrying.kind !== "cooked") return no("Hands full");
        return { ...base, verb: "plate", label: `Plate ${profile(s, carrying.dishId).short}`, enabled: true, start: act("plate", TUNING.plateSecs, { ticketId: carrying.ticketId }) };
      }
      if (role === "bar") return no("Servers carry food");
      return pickupPlan(s, state, st, "pass", act);
    }
    case "bar": {
      if (role === "bar") {
        if (carrying?.kind === "plates") return pickupPlan(s, state, st, "bar", act);
        if (carrying) return no("Hands full");
        const next = openDrinkTickets(s, state)[0];
        if (!next) return readyGroups(s, state, "bar").length ? pickupPlan(s, state, st, "bar", act) : no("No drinks ordered");
        const tn = tableNumberOf(s, state, next.customerId);
        return {
          ...base, verb: "pour", label: `Hold to pour ${profile(s, next.dishId).short}${tn ? ` (T${tn})` : ""}`, enabled: true,
          start: () => {
            const r = rng();
            const line = TUNING.pourLine[0] + r.float() * (TUNING.pourLine[1] - TUNING.pourLine[0]);
            s.rng = r.getState();
            s.claimed[next.id] = true;
            act("pour", TUNING.pourSecs, { line, ticketId: next.id, dishId: next.dishId })();
          },
        };
      }
      if (role === "chef") return no("Bar staff pour drinks");
      return pickupPlan(s, state, st, "bar", act);
    }
    case "table": {
      const table = state.tables.find((t) => t.id === st.tableId);
      if (!table) return no("Table");
      const party = table.occupiedBy ? state.customers.find((c) => c.id === table.occupiedBy) : undefined;
      if (carrying?.kind === "plates") {
        const mine = carrying.plates.filter((p) => p.customerId === table.occupiedBy);
        if (mine.length) {
          return { ...base, verb: "serve", label: `Serve ${mine.length > 1 ? `${mine.length} plates` : profile(s, mine[0]!.dishId).short} to T${st.number}`, enabled: true, start: act("serve", TUNING.serveSecs, { tableId: table.id, customerId: table.occupiedBy }) };
        }
        const want = tableNumberOf(s, state, carrying.plates[0]!.customerId);
        return no(want ? `Not this one — that's for table ${want}` : "Nobody here ordered that");
      }
      if (table.dirtyTicks > 0 && !table.occupiedBy && !s.cleared[table.id]) {
        if (carrying) return no("Hands full");
        return { ...base, verb: "clear", label: `Tap to clear T${st.number}`, enabled: true, start: act("clear", 3, { taps: 0, need: TUNING.clearTaps, tableId: table.id }) };
      }
      if (party?.stage === "paying") return no(`T${st.number} wants to pay — at the till`);
      if (party) return no(party.stage === "eating" ? `T${st.number} is eating` : `T${st.number} is waiting for food`);
      return no(`Table ${st.number} — clean and set`);
    }
    case "dishReturn": {
      if (carrying?.kind !== "dirty") return no(carrying ? "Wash-up is for dirty plates" : "Wash-up");
      return { ...base, verb: "dropoff", label: "Drop the dirty plates", enabled: true, start: act("dropoff", TUNING.dropoffSecs) };
    }
    case "till": {
      if (role === "chef") return no("Front of house takes payment");
      const party = payingParties(s, state)[0];
      if (!party) return no("Nobody waiting to pay");
      if (carrying && carrying.kind !== "plates") return no("Hands full");
      const tn = party.tableId ? s.tableNumbers[party.tableId] : undefined;
      return { ...base, verb: "payment", label: `Take payment${tn ? ` from T${tn}` : ""}`, enabled: true, start: act("payment", TUNING.paymentSecs, { customerId: party.id }) };
    }
  }
  void results;
  return no(st.label);
}

function pickupPlan(s: HandsOnSession, state: GameState, st: Station, where: "pass" | "bar", act: (v: Verb, d: number, e?: Partial<ActiveAction>) => () => void): Plan {
  const base = { stationId: st.id };
  const carrying = s.carrying;
  if (carrying && carrying.kind !== "plates") return { ...base, label: carrying.kind === "dirty" ? "Drop the dirty plates first" : "Hands full", enabled: false };
  const have = carrying?.kind === "plates" ? carrying.plates.length : 0;
  const room = s.opts.carryLimit - have;
  if (room <= 0) return { ...base, label: `Hands full (${s.opts.carryLimit} ${s.opts.carryLimit === 1 ? "plate" : "plates"})`, enabled: false };
  const groups = readyGroups(s, state, where);
  // prefer more for a party already in hand, then the oldest
  const inHand = new Set(carrying?.kind === "plates" ? carrying.plates.map((p) => p.customerId) : []);
  const g = groups.find((x) => inHand.has(x.customerId)) ?? groups[0];
  if (!g) return { ...base, label: where === "pass" ? "Nothing on the pass yet" : "No drinks ready", enabled: false };
  const n = Math.min(room, g.tickets.length);
  const tn = tableNumberOf(s, state, g.customerId);
  return {
    ...base, verb: "pickup", enabled: true,
    label: `Pick up ${n > 1 ? `${n} plates` : profile(s, g.tickets[0]!.dishId).short}${tn ? ` for T${tn}` : ""}`,
    start: act("pickup", TUNING.pickupSecs, { customerId: g.customerId }),
  };
}

// ───────────────────────── finishing verbs ─────────────────────────

function toast(s: HandsOnSession, text: string, tone: "good" | "bad" | "info" | "money", at?: { x: number; y: number }) {
  const p = at ?? s.player;
  s.toasts.push({ text, x: p.x, y: p.y - 0.6, born: s.time, tone });
}
function say(s: HandsOnSession, text: string, secs = 2.2) { s.message = { text, until: s.time + secs }; }

function stationCentre(s: HandsOnSession, id: string) {
  const st = s.stations.find((x) => x.id === id);
  return st ? { x: st.x + st.w / 2, y: st.y } : s.player;
}

function emitPlate(s: HandsOnSession, ticketId: string, dishId: string, execution: number, method: DishProfile["method"], results: HandsOnResult[], state: GameState) {
  const prof = profile(s, dishId);
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket && s.opts.station) {
    // Round 4: nobody else cooks a station's rail, so a vanished ticket means the table left (or service closed).
    // Not the player's fault: no cost, no penalty.
    say(s, "That table has gone — no harm done. Grab your next ticket!");
    return;
  }
  if (!ticket) {
    // an AI cook (or a remake) beat us to it: nothing to send; it counts as a small waste
    results.push({ type: "DROPPED", cost: prof.cost, item: "cooked" });
    s.score.drops++; s.score.dropCost += prof.cost; addPoints(s.score, POINTS.drop);
    say(s, "That ticket already went out — binned");
    return;
  }
  const age = s.time - (s.seenAt[`t:${ticketId}`] ?? s.time);
  const speedBonus = round2(chefSpeedBonus(age));
  const quality = round2(execution * prof.ceiling);
  results.push({ type: "PLATE_COOKED", ticketId, quality, execution: round2(execution), station: method, speedBonus });
  s.cooked[ticketId] = true;
  s.seenAt[`r:${ticketId}`] = s.time;
  s.score.plates++;
  s.plateTimes = [...(s.plateTimes ?? []), s.time].slice(-40);
  if (age > COLD_PLATE_SECS) s.score.slowPlates = (s.score.slowPlates ?? 0) + 1;
  s.score.qualitySum += execution * 100;
  s.score.speedBonus += speedBonus;
  s.score.speedCount++;
  addPoints(s.score, POINTS.platePerQuality * execution * 100 + POINTS.plateSpeed * speedBonus);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function finishAction(s: HandsOnSession, state: GameState, results: HandsOnResult[]) {
  const a = s.activeAction!;
  s.activeAction = undefined;
  s.lastActiveAt = s.time;
  const at = stationCentre(s, a.stationId);
  switch (a.verb) {
    case "grab": {
      const t = state.tickets.find((x) => x.id === a.ticketId);
      if (!t || !a.ticketId) { say(s, "That ticket's gone"); return; }
      s.claimed[a.ticketId] = true;
      s.carrying = { kind: "raw", ticketId: a.ticketId, dishId: t.dishId };
      results.push({ type: "TICKET_CLAIMED", ticketId: a.ticketId });
      return;
    }
    case "chop": {
      if (s.carrying?.kind !== "raw") return;
      const marked = a.marked ?? [];
      const hits = marked.filter((m) => m > 0);
      const mean = marked.length ? marked.reduce((sum, m) => sum + Math.max(0, m), 0) / marked.length : 0;
      const prep = 0.4 + 0.6 * mean; // soft floor: ragged veg still cooks
      s.score.chopHits += hits.length;
      s.score.chopMarks += marked.length;
      s.carrying = { kind: "prepped", ticketId: s.carrying.ticketId, dishId: s.carrying.dishId, prep };
      toast(s, hits.length === marked.length ? "Neat!" : hits.length ? `${hits.length}/${marked.length} chops` : "Rough chop", hits.length === marked.length ? "good" : "info", at);
      return;
    }
    case "cook": {
      if (s.carrying?.kind !== "prepped") return;
      const needle = Math.min(1, a.t / a.dur);
      const { quality, result } = cookQuality(needle, a.band ?? [0.6, 0.75]);
      if (result === "perfect") s.score.perfect++;
      else if (result === "under") s.score.undercooked++;
      else s.score.overcooked++;
      s.carrying = { kind: "cooked", ticketId: s.carrying.ticketId, dishId: s.carrying.dishId, prep: s.carrying.prep, cook: quality, ...(result === "burnt" ? { burnt: true } : {}) };
      toast(s, result === "perfect" ? "Perfect!" : result === "under" ? "A bit pale" : result === "over" ? "Overdone" : "Burnt!", result === "perfect" ? "good" : "bad", at);
      return;
    }
    case "plate": {
      const c = s.carrying;
      if (!c || (c.kind !== "prepped" && c.kind !== "cooked")) return;
      const method = profile(s, c.dishId).method;
      const exec = plateExecution(method, c.prep, c.kind === "cooked" ? c.cook : c.prep);
      s.carrying = undefined;
      delete s.claimed[c.ticketId];
      emitPlate(s, c.ticketId, c.dishId, exec, method, results, state);
      const tn = state.tickets.find((t) => t.id === c.ticketId) ? tableNumberOf(s, state, state.tickets.find((t) => t.id === c.ticketId)!.customerId) : undefined;
      if (results.at(-1)?.type === "PLATE_COOKED") toast(s, `Service! ${tn ? `T${tn} ` : ""}${Math.round(exec * 100)}%`, "good", at);
      return;
    }
    case "pour": {
      // reached only by release (see update); overflow is handled there
      const level = Math.min(1, a.t / a.dur);
      const q = pourQuality(level, a.line ?? 0.78);
      s.score.pours++;
      s.score.pourSum += q;
      const t = state.tickets.find((x) => x.id === a.ticketId);
      if (a.ticketId) delete s.claimed[a.ticketId];
      if (t && a.ticketId) {
        emitPlate(s, a.ticketId, t.dishId, q, "pour", results, state);
        toast(s, q >= 0.9 ? "Spot on!" : level < (a.line ?? 0.78) ? "Bit short" : "Bit full", q >= 0.9 ? "good" : "info", at);
      }
      return;
    }
    case "pickup": {
      const where = a.stationId === "bar" ? "bar" : "pass";
      const g = readyGroups(s, state, where).find((x) => x.customerId === a.customerId);
      if (!g) return;
      const have = s.carrying?.kind === "plates" ? s.carrying.plates : [];
      const room = s.opts.carryLimit - have.length;
      const take = g.tickets.slice(0, room).map<CarriedPlate>((t) => ({
        ticketId: t.id, dishId: t.dishId, customerId: t.customerId,
        readyAt: s.seenAt[`r:${t.id}`] ?? s.time,
        ...(where === "bar" ? { glass: true } : {}),
      }));
      for (const p of take) s.picked[p.ticketId] = true;
      s.carrying = { kind: "plates", plates: [...have, ...take] };
      return;
    }
    case "serve": {
      if (s.carrying?.kind !== "plates") return;
      const table = state.tables.find((t) => t.id === a.tableId);
      const cid = table?.occupiedBy;
      const mine = s.carrying.plates.filter((p) => p.customerId === cid);
      if (!cid || !mine.length) return;
      let bonusSum = 0;
      for (const p of mine) {
        const bonus = round2(serveSpeedBonus(s.time - p.readyAt));
        bonusSum += bonus;
        results.push({ type: "TABLE_SERVED", customerId: cid, ticketId: p.ticketId, speedBonus: bonus });
        s.served[p.ticketId] = true;
        s.score.served++;
        s.score.speedBonus += bonus;
        s.score.speedCount++;
        addPoints(s.score, POINTS.serve + POINTS.serveSpeed * bonus);
      }
      const rest = s.carrying.plates.filter((p) => p.customerId !== cid);
      s.carrying = rest.length ? { kind: "plates", plates: rest } : undefined;
      toast(s, bonusSum / mine.length > 0.8 ? "Hot and fast!" : "Enjoy!", "good", at);
      return;
    }
    case "clear": {
      if (!a.tableId) return;
      s.cleared[a.tableId] = true;
      const table = state.tables.find((t) => t.id === a.tableId);
      s.carrying = { kind: "dirty", tableId: a.tableId, count: Math.min(4, table?.seats ?? 2) };
      results.push({ type: "TABLE_CLEARED", tableId: a.tableId });
      s.score.cleared++;
      addPoints(s.score, POINTS.clear);
      toast(s, "Reset!", "good", at);
      return;
    }
    case "dropoff": {
      if (s.carrying?.kind === "dirty") s.carrying = undefined;
      return;
    }
    case "payment": {
      const c = state.customers.find((x) => x.id === a.customerId);
      if (!c || c.stage !== "paying" || !a.customerId) return;
      s.paid[a.customerId] = true;
      results.push({ type: "PAYMENT_TAKEN", customerId: a.customerId });
      s.score.payments++;
      addPoints(s.score, POINTS.payment);
      toast(s, "Paid — thank you!", "money", at);
      return;
    }
  }
}

function dropCarried(s: HandsOnSession, results: HandsOnResult[], why: string) {
  const c = s.carrying;
  if (!c) return;
  let cost = 0;
  let ticketIds: string[] | undefined;
  if (c.kind === "plates") {
    cost = c.plates.reduce((sum, p) => sum + profile(s, p.dishId).cost, 0);
    ticketIds = c.plates.map((p) => p.ticketId);
  } else if (c.kind !== "dirty") {
    // raw costs less than a cooked plate (only part of the ingredients are spoiled)
    const full = profile(s, c.dishId).cost;
    cost = c.kind === "raw" ? Math.round(full * 0.6) : full;
    delete s.claimed[c.ticketId];
  }
  s.carrying = undefined;
  s.player.wobble = 0;
  if (c.kind === "dirty") {
    // a dropped tub of dirty plates: a breakage, not food
    cost = 80 * c.count;
  }
  results.push({ type: "DROPPED", cost, item: c.kind, ...(ticketIds ? { ticketIds } : {}) });
  s.score.drops++;
  s.score.dropCost += cost;
  addPoints(s.score, POINTS.drop);
  toast(s, `${why} −£${(cost / 100).toFixed(2)}`, "bad");
}

// ───────────────────────── housekeeping ─────────────────────────

function sync(s: HandsOnSession, state: GameState) {
  const live = new Map(state.tickets.map((t) => [t.id, t]));
  for (const t of state.tickets) {
    if (!(`t:${t.id}` in s.seenAt)) s.seenAt[`t:${t.id}`] = s.time;
    if ((t.ticksRemaining <= 0 || s.cooked[t.id]) && !(`r:${t.id}` in s.seenAt)) s.seenAt[`r:${t.id}`] = s.time;
  }
  for (const k of Object.keys(s.seenAt)) if (!live.has(k.slice(2))) delete s.seenAt[k];
  const carriedIds = new Set<string>();
  if (s.carrying?.kind === "plates") for (const p of s.carrying.plates) carriedIds.add(p.ticketId);
  if (s.carrying && "ticketId" in s.carrying) carriedIds.add(s.carrying.ticketId);
  for (const id of Object.keys(s.claimed)) if (!live.has(id) && !carriedIds.has(id)) delete s.claimed[id];
  for (const id of Object.keys(s.cooked)) if (!live.has(id)) delete s.cooked[id];
  for (const id of Object.keys(s.served)) if (!live.has(id)) delete s.served[id];
  // picked: gone, or re-fired after a drop (back in the kitchen)
  for (const id of Object.keys(s.picked)) {
    const t = live.get(id);
    if (carriedIds.has(id)) continue;
    if (!t || (t.ticksRemaining > 0 && !s.cooked[id])) delete s.picked[id];
  }
  // a carried plate whose ticket vanished (the AI delivered it, or the sim timed out): quietly drop it from the tray
  if (s.carrying?.kind === "plates") {
    const keep = s.carrying.plates.filter((p) => live.has(p.ticketId));
    if (keep.length !== s.carrying.plates.length) s.carrying = keep.length ? { kind: "plates", plates: keep } : undefined;
  }
  const tables = new Map(state.tables.map((t) => [t.id, t]));
  for (const id of Object.keys(s.cleared)) {
    const t = tables.get(id);
    if (!t || t.dirtyTicks <= 0 || t.occupiedBy) delete s.cleared[id];
  }
  const customers = new Map(state.customers.map((c) => [c.id, c]));
  for (const id of Object.keys(s.paid)) if (customers.get(id)?.stage !== "paying") delete s.paid[id];
  // dish names for tickets that turned up after creation (new menu items, remakes)
  for (const t of state.tickets) if (!s.dishes[t.dishId]) s.dishes[t.dishId] = profileFor(t.dishId);
}

// ───────────────────────── round 4: the sous chef covers an idle commis ─────────────────────────

/** The AI chef who covers (the first other chef on today's floor), for the nudge. */
function sousName(s: HandsOnSession, state: GameState): string {
  const pid = s.opts.playerStaffId;
  const other = state.staff.find((x) => x.role === "chef" && x.id !== pid && x.rota[weekdayOf(state.day)]);
  return other ? other.name.split(" ")[0]! : "Chef";
}

/**
 * With a station, nobody hard-stalls service: if the player has done nothing for `idleCoverSecs` while a ticket sits
 * on their rail (or in their hands), the sous chef plates it (PLATE_COOKED `covered`, COVER_EXECUTION quality, no
 * points) with a friendly nudge; a rail ticket left `hardCoverSecs` is covered however busy the player is.
 * A "need a hand?" nudge comes first, at NUDGE_SHARE of the idle time.
 */
function sousChef(s: HandsOnSession, state: GameState, results: HandsOnResult[]) {
  const st = s.opts.station!;
  if (s.shift?.over) return;
  const rail = stationTickets(s, state);
  const held = s.carrying && "ticketId" in s.carrying ? s.carrying : undefined;
  const heldTicket = held ? rail.find((t) => t.id === held.ticketId) : undefined;
  const waiting = rail.filter((t) => t.id !== held?.ticketId);
  const oldest = waiting[0];
  const seen = (t: KitchenTicket) => s.seenAt[`t:${t.id}`] ?? s.time;
  // Idle since the last verb, but never before the work arrived (waiting patiently for a ticket is not idling).
  const workSince = heldTicket ? 0 : oldest ? seen(oldest) : Infinity;
  const idleFrom = Math.max(s.lastActiveAt ?? 0, workSince);
  const idle = s.activeAction ? 0 : s.time - idleFrom;
  const who = sousName(s, state);
  if (idle >= st.idleCoverSecs) {
    const t = heldTicket ?? oldest!;
    cover(s, state, t, results, true);
    const tn = tableNumberOf(s, state, t.customerId);
    say(s, `${who}: “I've plated ${tn ? `table ${tn}'s ` : "the "}${profile(s, t.dishId).short} for you — grab your next ticket!”`, 3.6);
    s.lastActiveAt = s.time;
    return;
  }
  if (idle >= st.idleCoverSecs * NUDGE_SHARE && (s.nudgedAt ?? -Infinity) < idleFrom) {
    s.nudgedAt = s.time;
    say(s, `${who}: “Need a hand? ${heldTicket ? "Keep going with that one" : "Your ticket's on the rail — grab it from the fridge"}!”`, 3);
  }
  const stale = waiting.find((t) => s.time - seen(t) >= st.hardCoverSecs);
  if (stale) {
    cover(s, state, stale, results, false);
    const tn = tableNumberOf(s, state, stale.customerId);
    say(s, `${who}: “I'll take ${tn ? `table ${tn}'s ` : "that "}${profile(s, stale.dishId).short} — you keep going!”`, 3);
  }
}

function cover(s: HandsOnSession, state: GameState, t: KitchenTicket, results: HandsOnResult[], idle: boolean) {
  const prof = profile(s, t.dishId);
  results.push({ type: "PLATE_COOKED", ticketId: t.id, quality: round2(COVER_EXECUTION * prof.ceiling), execution: COVER_EXECUTION, station: prof.method, speedBonus: 0, covered: true });
  s.cooked[t.id] = true;
  delete s.claimed[t.id];
  if (s.carrying && "ticketId" in s.carrying && s.carrying.ticketId === t.id) {
    s.carrying = undefined;
    if (s.activeAction?.ticketId === t.id) s.activeAction = undefined;
  }
  s.score.covered = (s.score.covered ?? 0) + 1;
  if (idle) s.score.idleCovers = (s.score.idleCovers ?? 0) + 1;
  toast(s, "Covered by the sous chef", "info", stationCentre(s, "pass"));
  void state;
}

// ───────────────────────── the update ─────────────────────────

export function updateSession(session: HandsOnSession, state: GameState, input: HandsOnInput, dt: number): UpdateResult {
  const s: HandsOnSession = structuredClone(session);
  const results: HandsOnResult[] = [];
  const step = Math.max(0, Math.min(dt, 0.1)); // clamp long frames (tab switches) so verbs can't skip
  if (s.shift?.over) {
    s.prevInteract = input.interact; s.prevCancel = input.cancel;
    return { session: s, results };
  }
  s.time = round6(s.time + step);
  const pressed = input.interact && !s.prevInteract;
  const cancelPressed = input.cancel && !s.prevCancel;
  s.prevInteract = input.interact;
  s.prevCancel = input.cancel;

  sync(s, state);
  if (s.role !== "chef" && payingParties(s, state).length) s.score.tillWait = round6(s.score.tillWait + step);
  if (s.opts.station) {
    sousChef(s, state, results);
    const cap = railCapFor(s);
    if (cap !== (s.railCap ?? s.opts.station.cap)) { s.railCap = cap; results.push({ type: "RAIL_RESIZED", cap }); }
  }

  const a = s.activeAction;
  if (a) {
    a.t = round6(a.t + step);
    if (cancelPressed) {
      if ((a.verb === "cook") && a.t > TUNING.holdGrace) finishAction(s, state, results); // take it off the heat
      else { if (a.verb === "pour" && a.ticketId) delete s.claimed[a.ticketId]; s.activeAction = undefined; }
    } else if (a.verb === "chop") {
      const marks = a.marks ?? [];
      const marked = a.marked ?? [];
      const cursor = a.t / a.dur;
      if (pressed) {
        const i = marked.findIndex((m) => m === 0);
        if (i >= 0) {
          const hit = chopHit(cursor, marks[i]!);
          marked[i] = hit > 0 ? hit : -1;
        }
      }
      // marks the cursor has passed without a press are misses
      marks.forEach((m, i) => { if (marked[i] === 0 && cursor > m + TUNING.chopWindow) marked[i] = -1; });
      if (a.t >= a.dur) finishAction(s, state, results);
    } else if (a.verb === "cook") {
      if (!input.interact) {
        if (a.t <= TUNING.holdGrace) s.activeAction = undefined;
        else finishAction(s, state, results);
      } else if (a.t >= a.dur) finishAction(s, state, results); // left on: burnt (soft — still plates)
    } else if (a.verb === "pour") {
      if (!input.interact) {
        if (a.t <= TUNING.holdGrace) { if (a.ticketId) delete s.claimed[a.ticketId]; s.activeAction = undefined; }
        else finishAction(s, state, results);
      } else if (a.t >= a.dur) {
        // overflow: wipe up, a little lost, pour again
        s.activeAction = undefined;
        if (a.ticketId) delete s.claimed[a.ticketId];
        const cost = Math.round(profile(s, a.dishId ?? "").cost * 0.5);
        results.push({ type: "DROPPED", cost, item: "plates" });
        s.score.drops++; s.score.dropCost += cost; addPoints(s.score, POINTS.drop);
        toast(s, `Overflow! −£${(cost / 100).toFixed(2)}`, "bad", stationCentre(s, a.stationId));
      }
    } else if (a.verb === "clear") {
      if (pressed) a.taps = (a.taps ?? 0) + 1;
      if ((a.taps ?? 0) >= (a.need ?? TUNING.clearTaps)) finishAction(s, state, results);
      else if (a.t >= a.dur) s.activeAction = undefined; // wandered off mentally; table still dirty, no harm
    } else if (a.t >= a.dur) {
      finishAction(s, state, results);
    }
    s.player.vx = 0; s.player.vy = 0;
  } else {
    const bump = move(s, input, step);
    if (s.carrying?.kind === "plates" && bump >= TUNING.bumpSpeed) {
      s.player.wobble += TUNING.wobbleBase + TUNING.wobblePerPlate * (s.carrying.plates.length - 1);
      if (s.player.wobble >= 1) dropCarried(s, results, "Crash!");
      else say(s, "Careful — the plates are wobbling!", 1.4);
    }
    s.player.wobble = Math.max(0, s.player.wobble - TUNING.wobbleDecay * step);

    if (cancelPressed && s.carrying) {
      if (s.carrying.kind === "dirty") say(s, "Dirty plates go to the wash-up");
      else if (s.binArmedUntil !== undefined && s.time <= s.binArmedUntil) { s.binArmedUntil = undefined; dropCarried(s, results, "Binned"); }
      else { s.binArmedUntil = s.time + TUNING.binConfirmSecs; say(s, "Press Q again to bin it", TUNING.binConfirmSecs); }
    }

    const st = nearestStation(s);
    const p = st ? plan(s, state, st, results) : undefined;
    s.prompt = p ? { stationId: p.stationId, label: p.label, enabled: p.enabled, ...(p.verb ? { verb: p.verb } : {}) } : undefined;
    if (pressed && p?.enabled && p.start) {
      p.start();
      s.lastActiveAt = s.time;
      s.prompt = undefined;
    } else if (pressed && p && !p.enabled) {
      say(s, p.label, 1.6);
    }
  }

  if (s.shift && s.time >= s.shift.duration) {
    s.shift.over = true;
    s.activeAction = undefined;
    s.prompt = undefined;
  }
  s.toasts = s.toasts.filter((t) => s.time - t.born < 1.6);
  if (s.message && s.time > s.message.until) s.message = undefined;
  return { session: s, results };
}

/** Rounds accumulated time so long sessions don't drift between platforms' float printing (values stay exact enough). */
function round6(v: number) { return Math.round(v * 1e6) / 1e6; }

export type { Item };
