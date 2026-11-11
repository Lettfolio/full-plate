/**
 * Round 13 (F): the LIVE co-op shift — two people in one hands-on service, over the artifact runtime's `room`
 * capability (room.d.ts, contract 0.2.96). Pure: no React, no runtime calls; the screens give it an emit function and
 * a clock, and feed it what the room hears. docs/COOP-NOTES.md "Round 13" is the design note.
 *
 * Host-authoritative. The host runs the real shift (their own HandsOnShift, the real sim); the guest plays the other
 * role (host cooks, guest serves, or the reverse) in a hands-on session of their own, drawn over a GameState rebuilt
 * from the host's snapshots. Only RESULTS travel guest → host (a plate served, a table cleared, a ticket claimed …):
 *
 *   guest  emit("fp-in",  {k:"act", p:[[seq, results[]], …]})   every unacknowledged batch, until the host acks it
 *   host   checks shape, range, rate and role (the guest's role only, never an owner command), then applies the batch
 *          through the game's own `handsOnResults` action at the host's current tick, in seq order, exactly once
 *   host   emit("fp-st",  {k:"st", …})   absolute state ~5–10 Hz and on every change; {k:"base"} (the room, menu, team)
 *          every 2 s and when the guest says theirs is stale
 *   both   presence({fp:{x,y,f,c}})      where you are, for the partner's marker (display only, never authority)
 *   both   emit("fp-emo", {id, n})        the six emotes
 *
 * Messages drop and reorder: state is absolute, inputs are re-sent until acknowledged and applied once by seq. A guest
 * quiet for 3 s is "away": the host tells the sim to back the guest's role off (SET_HANDS_ON to the host's own role,
 * the normal hands-on fallback); a returning guest gets it back. Every message carries a tag — SHA-256 of the session
 * nonce (from the host's db document, readable only with the code) and the sender's platform-stamped `peer` — so a
 * peer who joined the room by name alone can neither speak for the host or the guest nor replay their messages.
 */
import type { Customer, CustomerStage, GameState, KitchenTicket, Staff, StaffRole } from "@full-plate/sim-core";
import type { CookMethod, HandsOnResult, HandsOnSession } from "@full-plate/handson";
import type { ContentPack } from "@full-plate/sim-core";
import { checkCustomDish, CUSTOM_MAX_PER_GAME, isCustomDishId, syncedCustomDishes, withCustomDishes, type CustomDishSpec } from "@full-plate/content";
import { content, customRef, newGame } from "../../sim";
import { cleanLabel } from "../../state/share";
import { emoteOf, END_WHYS, type Emote, type EmoteId, type EndWhy, type LiveRole } from "./protocol";
export type { EndWhy, LiveDoc, LiveRole } from "./protocol";
export { checkLive, newNonce } from "./protocol";
import { sha256Hex } from "./sha256";

// ───────────────────────── vocabulary ─────────────────────────

export const TOPIC = { in: "fp-in", st: "fp-st", emo: "fp-emo" } as const;
/** What the publisher declares (COOP-NOTES "Round 13 — capabilities"): the three topics, open to Contributors. */
export const ROOM_DECLARATION = { topics: { "fp-in": "interact", "fp-st": "interact", "fp-emo": "interact" } } as const;

export const otherRole = (r: LiveRole): LiveRole => (r === "chef" ? "server" : "chef");

/** Snapshot pacing: at most 10 a second, at least 5. */
export const SNAP_MIN_MS = 100;
export const SNAP_IDLE_MS = 200;
export const BASE_EVERY_MS = 2000;
export const BEAT_MS = 500;
export const HELLO_MS = 1000;
/** The guest's unacknowledged input is re-sent this often (new input goes at once, ≥ ACT_MIN_MS apart). */
export const ACT_RESEND_MS = 250;
export const ACT_MIN_MS = 80;
/** A guest heard nothing from for this long is away (the sim's fallback takes the role); the host likewise for the guest. */
export const QUIET_MS = 3000;
export const HOST_QUIET_MS = 5000;
/** A round trip above this, sustained, offers the turn-based day instead. */
export const SLOW_MS = 400;
export const SLOW_SUSTAIN_MS = 8000;
/** room.d.ts: `data` at most 4 KiB. Snapshots trim themselves under this. */
export const MSG_MAX = 4096;
export const SNAP_BUDGET = 3800;
/** Host-side input limits. */
export const IN_RATE = 15; // fp-in messages a second (burst 2×)
export const MAX_BATCH = 16; // results in one acknowledged batch
export const MAX_PENDING = 20; // batches the guest keeps for re-sending
export const EMOTE_MIN_MS = 1000; // receiver-side: faster emotes from a peer are ignored

const ID = /^[A-Za-z0-9_:.-]{1,40}$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const num = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
/** An index into a list of `n`, or -1 (out of range is refused, not clamped). */
const idx = (v: unknown, n: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n ? v : -1);

/** The named room for a session: from the code AND the nonce, so an old code never opens a new session's room. */
export const roomName = (code: string, nonce: string): string => `fp-${sha256Hex(`fp-room|${code}|${nonce}`).slice(0, 28)}`;
/** A sender's tag: binds the message to the session (nonce) and to the platform-stamped peer that sent it. */
export const tagOf = (nonce: string, peer: string): string => sha256Hex(`fp-tag|${nonce}|${peer}`).slice(0, 20);

/** What the room delivers (room.d.ts `Message`): the platform's stamps plus untrusted `data`. */
export interface RoomMsg {
  peer: string;
  by: string | null;
  isMe: boolean;
  sameTab: boolean;
  kind: "viewer" | "agent";
  topic: string;
  data?: unknown;
}

// ───────────────────────── the snapshot codec ─────────────────────────

const STAGES: readonly CustomerStage[] = ["queue", "seated", "ordered", "eating", "paying", "left"];
const STAFF_ROLES: readonly StaffRole[] = ["chef", "server", "bar", "porter", "manager"];
const SEGMENTS = (): string[] => content.segments.map((s) => s.id);
const LIMIT = { tables: 24, staff: 40, dishes: 60, customers: 90, tickets: 90, order: 8 } as const;

/** What doesn't change during a service: the room, the menu, the team, who plays what. */
export interface Base {
  b: number;
  day: number;
  seed: number;
  name: string;
  dishes: string[];
  /** R13 review: the host's invented dishes on tonight's menu (each re-checked like a save), so the guest can cook/serve them. */
  custom: CustomDishSpec[];
  staff: { id: string; role: StaffRole; on: boolean; name: string }[];
  tables: { id: string; seats: number }[];
  hostRole: LiveRole;
}
/** The live state of the floor: everything the hands-on view reads that moves. */
export interface Floor {
  seq: number;
  t: number;
  b: number;
  tick: number;
  /** The guest's last input batch the host has applied. */
  ack: number;
  /** The host's measured round trip (median), ms. */
  rtt: number | null;
  /** The role the sim is backing off (GameState.handsOn.role). */
  simRole: StaffRole | null;
  /** Is the guest's role theirs right now (false: away, the team covers). */
  guestOn: boolean;
  tables: { dirty: number; occ: number }[];
  customers: Customer[];
  tickets: KitchenTicket[];
}

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
const weekday = (day: number): number => ((day % 7) + 7) % 7;

/** Host: the base message for this game. */
export function encodeBase(game: GameState, hostRole: LiveRole): Record<string, unknown> {
  const dishes = [...new Set([...game.menu.map((m) => m.dishId), ...game.tickets.map((t) => t.dishId)])].filter(isId).slice(0, LIMIT.dishes);
  const wd = weekday(game.day);
  const body = {
    dy: game.day, sd: game.seed, nm: cleanLabel(game.restaurantName, 32),
    d: dishes,
    sf: game.staff.filter((s) => isId(s.id)).slice(0, LIMIT.staff).map((s) => [s.id, STAFF_ROLES.indexOf(s.role), s.rota[wd] ? 1 : 0, cleanLabel(s.name, 16)]),
    tb: game.tables.slice(0, LIMIT.tables).filter((t) => isId(t.id)).map((t) => [t.id, t.seats]),
    hr: hostRole === "chef" ? 0 : 1,
  };
  // R13 review: the invented dishes tonight's menu names travel with the base (the guest's pack has only the shipped
  // dishes); fewest first if the 4 KiB cap would be crossed, and none rather than a base that can't be sent.
  const specs = new Map(syncedCustomDishes().map((x) => [x.id, x]));
  let cd = dishes.filter(isCustomDishId).map((id) => specs.get(id)).filter((x): x is CustomDishSpec => !!x).slice(0, CUSTOM_MAX_PER_GAME).map(packSpec);
  const size = (c: unknown[]) => bytes({ k: "base", b: 0, ...body, ...(c.length ? { cd: c } : {}) });
  while (cd.length && size(cd) > SNAP_BUDGET) cd = cd.slice(0, -1);
  const full = cd.length ? { ...body, cd } : body;
  return { k: "base", b: fnv(JSON.stringify(full)), ...full };
}

/** A recipe as the base carries it: [id, name, course, icon, [[ingredient, qty], …], createdDay, refined?]. */
function packSpec(x: CustomDishSpec): unknown[] {
  const r = [x.id, x.name, x.course, x.icon, x.ingredients.map((i) => [i.id, i.qty]), x.createdDay];
  return x.refined ? [...r, [x.refined.season, x.refined.suffix, x.refined.prose]] : r;
}
/** The guest's side: a recipe back from the wire, or null unless it passes the same check a save's recipe does. */
function unpackSpec(r: unknown): CustomDishSpec | null {
  if (!Array.isArray(r) || r.length < 6 || r.length > 7 || !Array.isArray(r[4])) return null;
  const ingredients = r[4].slice(0, 6).map((i: unknown) => (Array.isArray(i) ? { id: i[0] as string, qty: i[1] as number } : null));
  if (ingredients.some((i) => i === null)) return null;
  const ref = Array.isArray(r[6]) ? r[6] : null;
  const spec = {
    id: r[0], name: r[1], course: r[2], icon: r[3], ingredients, createdDay: r[5],
    ...(ref ? { refined: { season: int(ref[0], 0, 1e6), suffix: int(ref[1], 0, 999), prose: int(ref[2], 0, 999) } } : {}),
  } as CustomDishSpec;
  return checkCustomDish(spec, customRef).length === 0 ? spec : null;
}

/** The guest's pack for a base: the shipped dishes plus the host's invented ones on tonight's menu. */
export function guestContent(base: Pick<Base, "custom">): ContentPack {
  return base.custom.length ? withCustomDishes(content, base.custom, customRef) : content;
}

export function decodeBase(raw: unknown): Base | null {
  const o = obj(raw);
  if (o.k !== "base") return null;
  const custom = (Array.isArray(o.cd) ? o.cd.slice(0, CUSTOM_MAX_PER_GAME) : []).map(unpackSpec).filter((x): x is CustomDishSpec => x !== null)
    .filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i);
  const known = new Set([...content.dishes.map((d) => d.id), ...custom.map((x) => x.id)]);
  const dishes = (Array.isArray(o.d) ? o.d.slice(0, LIMIT.dishes) : []).filter((d): d is string => isId(d) && known.has(d));
  const staff = (Array.isArray(o.sf) ? o.sf.slice(0, LIMIT.staff) : []).flatMap((r) => {
    if (!Array.isArray(r) || !isId(r[0])) return [];
    const role = STAFF_ROLES[idx(r[1], STAFF_ROLES.length)];
    return role ? [{ id: r[0], role, on: r[2] === 1, name: cleanLabel(r[3], 16) || "Someone" }] : [];
  });
  const tables = (Array.isArray(o.tb) ? o.tb.slice(0, LIMIT.tables) : []).flatMap((r) => (Array.isArray(r) && isId(r[0]) ? [{ id: r[0], seats: int(r[1], 1, 12, 2) }] : []));
  if (!tables.length) return null;
  return { b: int(o.b, 0, 2 ** 32), day: int(o.dy, 0, 1e6), seed: int(o.sd, 0, 2 ** 32), name: cleanLabel(o.nm, 32) || "Their restaurant", dishes, custom: custom.filter((x) => dishes.includes(x.id)), staff, tables, hostRole: o.hr === 1 ? "server" : "chef" };
}

/** Host: the floor message. Trims queues, then leavers, then the oldest tickets, to stay under SNAP_BUDGET bytes. */
export function encodeFloor(game: GameState, base: Base, f: { seq: number; t: number; ack: number; rtt: number | null; guestOn: boolean }): Record<string, unknown> {
  const dIdx = new Map(base.dishes.map((d, i) => [d, i]));
  const sIdx = new Map(base.staff.map((s, i) => [s.id, i]));
  const tIdx = new Map(base.tables.map((t, i) => [t.id, i]));
  const dish = (id: string): number | string => dIdx.get(id) ?? id;
  let customers = game.customers.filter((c) => isId(c.id)).slice(0, LIMIT.customers);
  let tickets = game.tickets.filter((t) => isId(t.id)).slice(0, LIMIT.tickets);
  const build = () => {
    const cIdx = new Map(customers.map((c, i) => [c.id, i]));
    const tb = base.tables.map((bt) => {
      const t = game.tables.find((x) => x.id === bt.id);
      return [int(t?.dirtyTicks, 0, 9999), t?.occupiedBy !== undefined ? cIdx.get(t.occupiedBy) ?? -1 : -1];
    });
    const c = customers.map((x) => [
      x.id, x.segment, x.partySize, STAGES.indexOf(x.stage), x.tableId !== undefined ? tIdx.get(x.tableId) ?? -1 : -1,
      x.order.slice(0, LIMIT.order).map(dish), Math.round(x.patience), x.arrivedTick, x.stageTick ?? -1, x.platesReady ?? 0, x.servedTick ?? -1, x.eatUntil ?? -1,
      (x.walkedOut ? 1 : 0) | (x.vip ? 2 : 0) | (x.courseOut ? 4 : 0) | (x.setMenu ? 8 : 0),
    ]);
    const k = tickets.flatMap((t) => {
      const ci = cIdx.get(t.customerId);
      if (ci === undefined) return [];
      const chef = t.chefId === undefined ? -1 : t.chefId === "player" ? -2 : sIdx.get(t.chefId) ?? -3;
      return [[t.id, ci, dish(t.dishId), t.createdTick, t.ticksRemaining, chef, t.atPass ? 1 : 0, t.platedAtTick ?? -1, t.claimedAtTick ?? -1, Math.round(t.quality)]];
    });
    return {
      k: "st", q: f.seq, t: Math.round(f.t), b: base.b, tk: game.tick, a: f.ack, rt: f.rtt, g: f.guestOn ? 1 : 0,
      ho: game.handsOn ? STAFF_ROLES.indexOf(game.handsOn.role) : -1,
      tb, c, x: k,
    };
  };
  let out = build();
  // Room for the tag and the envelope: trim the least-needed rows first.
  for (let guard = 0; bytes(out) > SNAP_BUDGET && guard < 200; guard++) {
    const queue = customers.filter((c) => c.stage === "queue");
    if (queue.length > 4) customers = customers.filter((c) => c !== queue.at(-1));
    else if (customers.some((c) => c.stage === "left")) customers = customers.filter((c) => c !== customers.find((x) => x.stage === "left"));
    else if (tickets.length > 8) tickets = tickets.slice(1);
    else if (customers.length > 8) customers = customers.slice(0, -1);
    else break;
    out = build();
  }
  return out;
}

export function decodeFloor(raw: unknown, base: Base): Floor | null {
  const o = obj(raw);
  if (o.k !== "st" || int(o.b, 0, 2 ** 32, -1) !== base.b) return null;
  const segs = SEGMENTS();
  const known = new Set(content.dishes.map((d) => d.id));
  const dishOf = (v: unknown): string | null => (typeof v === "number" ? base.dishes[idx(v, base.dishes.length)] ?? null : isId(v) && known.has(v) ? v : null);
  const customers: Customer[] = [];
  for (const r of Array.isArray(o.c) ? o.c.slice(0, LIMIT.customers) : []) {
    if (!Array.isArray(r) || !isId(r[0]) || typeof r[1] !== "string" || !segs.includes(r[1])) continue;
    const stage = STAGES[idx(r[3], STAGES.length)];
    if (!stage) continue;
    const ti = idx(r[4], base.tables.length);
    const order = (Array.isArray(r[5]) ? r[5].slice(0, LIMIT.order) : []).map(dishOf).filter((d): d is string => d !== null);
    const opt = (v: unknown) => { const n = int(v, -1, 1e7, -1); return n >= 0 ? n : undefined; };
    const flags = int(r[12], 0, 15);
    const stageTick = opt(r[8]), servedTick = opt(r[10]), eatUntil = opt(r[11]);
    customers.push({
      id: r[0], segment: r[1], partySize: int(r[2], 1, 12, 2), arrivedTick: int(r[7], 0, 1e7), stage,
      ...(ti >= 0 ? { tableId: base.tables[ti]!.id } : {}),
      order, patience: int(r[6], 0, 100, 50), satisfaction: 50, spend: 0, tip: 0,
      ...(stageTick !== undefined ? { stageTick } : {}), platesReady: int(r[9], 0, LIMIT.order),
      ...(servedTick !== undefined ? { servedTick } : {}), ...(eatUntil !== undefined ? { eatUntil } : {}),
      ...(flags & 1 ? { walkedOut: true } : {}), ...(flags & 2 ? { vip: true } : {}), ...(flags & 4 ? { courseOut: true } : {}), ...(flags & 8 ? { setMenu: true } : {}),
    });
  }
  const tickets: KitchenTicket[] = [];
  for (const r of Array.isArray(o.x) ? o.x.slice(0, LIMIT.tickets) : []) {
    if (!Array.isArray(r) || !isId(r[0])) continue;
    const cust = customers[idx(r[1], customers.length)];
    const dishId = dishOf(r[2]);
    if (!cust || !dishId) continue;
    const chef = r[5] === -2 || r[5] === -3 ? r[5] : idx(r[5], base.staff.length);
    const plated = int(r[7], -1, 1e7, -1), claimed = int(r[8], -1, 1e7, -1);
    tickets.push({
      id: r[0], customerId: cust.id, dishId, createdTick: int(r[3], 0, 1e7), ticksRemaining: int(r[4], 0, 9999), quality: int(r[9], 0, 100),
      ...(chef === -2 ? { chefId: "player" } : chef === -3 ? { chefId: "team" } : chef >= 0 ? { chefId: base.staff[chef]!.id } : {}),
      ...(r[6] === 1 ? { atPass: true } : {}), ...(plated >= 0 ? { platedAtTick: plated } : {}), ...(claimed >= 0 ? { claimedAtTick: claimed } : {}),
    });
  }
  const custIds = new Set(customers.map((c) => c.id));
  const tables = base.tables.map((_, i) => {
    const r = Array.isArray(o.tb) ? o.tb[i] : undefined;
    const occ = Array.isArray(r) ? idx(r[1], customers.length) : -1;
    return { dirty: Array.isArray(r) ? int(r[0], 0, 9999) : 0, occ: occ >= 0 && custIds.has(customers[occ]!.id) ? occ : -1 };
  });
  const ho = idx(o.ho, STAFF_ROLES.length);
  const rt = o.rt === null || o.rt === undefined ? null : int(o.rt, 0, 60_000);
  return { seq: int(o.q, 0, 1e12), t: int(o.t, 0, 1e15), b: base.b, tick: int(o.tk, 0, 1e6), ack: int(o.a, 0, 1e12), rtt: rt, simRole: ho >= 0 ? STAFF_ROLES[ho]! : null, guestOn: o.g === 1, tables, customers, tickets };
}

/** Guest: the throwaway GameState the hands-on view draws (a fresh `newGame` with the host's room laid over it). */
export function skeletonOf(base: Base): GameState {
  const g = newGame(content, { type: "NEW_GAME", seed: base.seed || 1, districtId: content.districts[0]!.id, restaurantName: base.name, difficulty: "normal" });
  const wd = weekday(base.day);
  return {
    ...g,
    day: base.day,
    seed: base.seed,
    phase: "service",
    restaurantName: base.name,
    tables: base.tables.map((t) => ({ id: t.id, seats: t.seats, dirtyTicks: 0 })),
    menu: base.dishes.map((dishId) => ({ dishId, price: 0, active: true, sold7d: 0, margin7d: 0 })),
    staff: base.staff.map((p): Staff => ({ id: p.id, name: p.name, role: p.role, skill: 50, speed: 50, charm: 50, wage: 0, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: 50, rota: Array.from({ length: 7 }, (_, i) => (i === wd ? p.on : false)) })),
    customers: [],
    tickets: [],
  };
}
export function viewOf(skeleton: GameState, f: Floor): GameState {
  return {
    ...skeleton,
    tick: f.tick,
    tables: skeleton.tables.map((t, i) => ({ ...t, dirtyTicks: f.tables[i]?.dirty ?? 0, ...(f.tables[i] && f.tables[i]!.occ >= 0 ? { occupiedBy: f.customers[f.tables[i]!.occ]!.id } : {}) })),
    customers: f.customers,
    tickets: f.tickets,
    ...(f.simRole ? { handsOn: { role: f.simRole, since: 0 } } : {}),
  };
}

// ───────────────────────── the guest's input, as the host checks it ─────────────────────────

const METHODS: readonly CookMethod[] = ["stove", "oven", "fryer", "none", "pour"];
/**
 * One result from the guest, rebuilt field by field, or null. The guest's role decides what they may send: a server
 * serves, clears, takes payment and drops plates; a chef claims, plates and drops what they were cooking. Anything else
 * — another role's verb, RAIL_RESIZED, a command, a stray field — is dropped. The sim still checks each one.
 */
export function checkResult(raw: unknown, role: LiveRole): HandsOnResult | null {
  const r = obj(raw);
  const unit = (v: unknown) => num(v, 0, 1, 0);
  switch (r.type) {
    case "TABLE_SERVED": return role === "server" && isId(r.customerId) && isId(r.ticketId) ? { type: "TABLE_SERVED", customerId: r.customerId, ticketId: r.ticketId, speedBonus: unit(r.speedBonus) } : null;
    case "TABLE_CLEARED": return role === "server" && isId(r.tableId) ? { type: "TABLE_CLEARED", tableId: r.tableId } : null;
    case "PAYMENT_TAKEN": return role === "server" && isId(r.customerId) ? { type: "PAYMENT_TAKEN", customerId: r.customerId } : null;
    case "TICKET_CLAIMED": return role === "chef" && isId(r.ticketId) ? { type: "TICKET_CLAIMED", ticketId: r.ticketId } : null;
    case "PLATE_COOKED": {
      if (role !== "chef" || !isId(r.ticketId)) return null;
      const station = METHODS.find((m) => m === r.station) ?? "none";
      return { type: "PLATE_COOKED", ticketId: r.ticketId, quality: num(r.quality, 0, 100, 0), execution: unit(r.execution), station, speedBonus: unit(r.speedBonus) };
    }
    case "DROPPED": {
      const item = role === "server" ? (r.item === "plates" ? "plates" : null) : r.item === "raw" || r.item === "prepped" || r.item === "cooked" ? r.item : null;
      if (!item) return null;
      const ids = (Array.isArray(r.ticketIds) ? r.ticketIds.slice(0, role === "server" ? 3 : 1) : []).filter(isId);
      return { type: "DROPPED", item, cost: int(r.cost, 0, 5000), ...(ids.length ? { ticketIds: ids } : {}) };
    }
    default: return null;
  }
}

/** What a role may send at all (the guest filters its own session's results with it too). */
export const roleResults = (results: readonly HandsOnResult[], role: LiveRole): HandsOnResult[] =>
  results.map((r) => checkResult(r, role)).filter((r): r is HandsOnResult => r !== null);

// ───────────────────────── shared bits ─────────────────────────

/** Median of the newest samples. */
export class RttWindow {
  samples: number[] = [];
  constructor(private size = 8) {}
  add(ms: number) { this.samples.push(Math.max(0, Math.round(ms))); if (this.samples.length > this.size) this.samples.shift(); }
  get median(): number | null {
    if (!this.samples.length) return null;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
}

/** Token bucket. */
export class Rate {
  private tokens: number;
  private at = 0;
  constructor(private perSec: number, private burst = perSec * 2) { this.tokens = burst; }
  take(now: number): boolean {
    if (this.at) this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSec);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Where you are, for the partner's marker (room presence; display data only). */
export interface Spot { x: number; y: number; f: "up" | "down" | "left" | "right"; c: boolean; role: LiveRole }
export function spotOf(s: Pick<HandsOnSession, "player" | "carrying" | "role">): Spot {
  return { x: Math.round(s.player.x * 100) / 100, y: Math.round(s.player.y * 100) / 100, f: s.player.facing, c: !!s.carrying, role: s.role === "chef" ? "chef" : "server" };
}
export function checkSpot(v: unknown): Spot | null {
  const o = obj(obj(v).fp);
  if (typeof o.x !== "number" || typeof o.y !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  const f = (["up", "down", "left", "right"] as const).find((d) => d === o.f) ?? "down";
  return { x: num(o.x, 0, 64), y: num(o.y, 0, 64), f, c: o.c === true, role: o.r === "chef" ? "chef" : "server" };
}
export const presenceOf = (s: Spot): Record<string, unknown> => ({ fp: { x: s.x, y: s.y, f: s.f, c: s.c, r: s.role } });

/** A sender we have pinned: the platform's peer label, and its durable id when the platform vouched for one. */
interface Pin { peer: string; by: string | null; heard: number }

/** Common to both ends: tags, pinning, emotes. */
abstract class End {
  protected tags = new Map<string, string>();
  protected pin: Pin | null = null;
  me: string | null = null;
  emote: Emote | null = null;
  private emoteAt = 0;
  private emoteN = 0;
  /** Messages refused (bad tag, unpinned peer, malformed): the tests read it. */
  refused = 0;
  constructor(protected nonce: string, protected emit: (topic: string, data: unknown) => void, protected clock: () => number) {}
  protected tag(peer: string): string {
    let t = this.tags.get(peer);
    if (!t) { t = tagOf(this.nonce, peer); if (this.tags.size > 64) this.tags.clear(); this.tags.set(peer, t); }
    return t;
  }
  /** Our own peer label (from the room's peers(), sameTab). Nothing is sent before it is known. */
  setMe(peer: string) { this.me = peer; }
  /** Sends `body` with our tag; the bytes sent, or 0 (no peer label yet, or over room.d.ts's 4 KiB). */
  protected post(topic: string, body: Record<string, unknown>): number {
    if (!this.me) return 0;
    const data = { s: this.tag(this.me), ...body };
    const n = bytes(data);
    if (n > MSG_MAX) return 0;
    this.emit(topic, data);
    return n;
  }
  /** The message's tag matches its stamped sender. Echoes of our own and agents are not for us. */
  protected genuine(m: RoomMsg): Record<string, unknown> | null {
    if (m.isMe || m.kind !== "viewer") return null;
    const d = obj(m.data);
    if (typeof d.s !== "string" || d.s !== this.tag(m.peer)) { this.refused++; return null; }
    return d;
  }
  /** The pinned sender, or (re)pin this one when allowed: the same durable id, or the old one long quiet. */
  protected pinned(m: RoomMsg, quietMs: number, mayPin: boolean): boolean {
    const now = this.clock();
    if (this.pin && this.pin.peer === m.peer) { this.pin.heard = now; return true; }
    if (!mayPin) { this.refused++; return false; }
    const free = !this.pin || (this.pin.by !== null && this.pin.by === m.by) || (now - this.pin.heard > quietMs && (this.pin.by === null || this.pin.by === m.by));
    if (!free) { this.refused++; return false; }
    this.pin = { peer: m.peer, by: m.by, heard: now };
    return true;
  }
  get partnerPeer(): string | null { return this.pin?.peer ?? null; }
  sendEmote(id: EmoteId): void {
    this.emoteN = Math.max(this.clock(), this.emoteN + 1);
    this.post(TOPIC.emo, { id, n: this.emoteN });
  }
  hearEmote(m: RoomMsg): boolean {
    const d = this.genuine(m);
    if (!d || m.peer !== this.pin?.peer || !emoteOf(d.id)) return false;
    const now = this.clock();
    if (now - this.emoteAt < EMOTE_MIN_MS) return false;
    this.emoteAt = now;
    this.emote = { id: d.id as EmoteId, n: int(d.n, 0, 1e15) };
    return true;
  }
}

// ───────────────────────── the host ─────────────────────────

export interface HostIO {
  emit(topic: string, data: unknown): void;
  /** The guest's checked results → the game (App's `handsOnResults`), at the host's current tick. */
  apply(results: HandsOnResult[]): void;
  /** Tell the sim which role a human is playing (SET_HANDS_ON). */
  setSimRole(role: LiveRole): void;
  now(): number;
}
export interface HostStatus { guest: "waiting" | "here" | "away"; rtt: number | null; slow: boolean; applied: number; snaps: number; snapBytes: number; ended: EndWhy | null }

export class LiveHost extends End {
  private game: GameState | null = null;
  private base: Base | null = null;
  private baseMsg: Record<string, unknown> | null = null;
  private dirty = true;
  private lastSnap = -1e9;
  private lastBase = -1e9;
  private seq = 0;
  private ack = 0;
  private rtt = new RttWindow();
  private rate = new Rate(IN_RATE);
  private slowSince: number | null = null;
  private here = false;
  private endN = 0;
  status: HostStatus = { guest: "waiting", rtt: null, slow: false, applied: 0, snaps: 0, snapBytes: 0, ended: null };
  /** Bytes of every floor message sent (the report reads min/median/max). */
  sizes: number[] = [];
  constructor(private io: HostIO, private cfg: { nonce: string; hostRole: LiveRole }) {
    super(cfg.nonce, (t, d) => io.emit(t, d), () => io.now());
  }
  get guestRole(): LiveRole { return otherRole(this.cfg.hostRole); }

  setGame(game: GameState) {
    if (game === this.game) return;
    this.game = game;
    this.dirty = true;
    if (!this.base || this.base.day !== game.day || game.tables.length !== this.base.tables.length) this.rebase();
  }
  private rebase() {
    if (!this.game) return;
    this.baseMsg = encodeBase(this.game, this.cfg.hostRole);
    this.base = decodeBase(this.baseMsg);
    this.lastBase = -1e9;
  }

  hear(m: RoomMsg) {
    if (this.status.ended) return;
    if (m.topic === TOPIC.emo) { this.hearEmote(m); return; }
    if (m.topic !== TOPIC.in) return;
    const d = this.genuine(m);
    if (!d) return;
    const now = this.clock();
    if (!this.rate.take(now)) { this.refused++; return; }
    if (!this.pinned(m, QUIET_MS, d.k === "hi" || !this.pin)) return;
    switch (d.k) {
      case "hi":
        this.lastBase = -1e9; // send the room at once
        break;
      case "beat": {
        const e = int(d.e, 0, 1e15), h = int(d.h, 0, 60_000);
        if (e > 0 && e <= now) this.rtt.add(now - e - h);
        if (int(d.bb, 0, 2 ** 32, -1) !== this.base?.b && now - this.lastBase > 500) this.lastBase = -1e9;
        break;
      }
      case "act": this.applyActs(d.p); break;
      case "bye": this.pin!.heard = -1e9; break;
    }
  }

  private applyActs(p: unknown) {
    if (!Array.isArray(p) || this.game?.phase !== "service") return;
    const batches = p.slice(0, MAX_PENDING).flatMap((e) => (Array.isArray(e) ? [{ q: int(e[0], 0, 1e12, -1), r: e[1] }] : [])).sort((a, b) => a.q - b.q);
    for (const b of batches) {
      if (b.q !== this.ack + 1) continue; // already applied, or a gap the next message fills
      this.ack = b.q;
      const results = (Array.isArray(b.r) ? b.r.slice(0, MAX_BATCH) : []).map((x) => checkResult(x, this.guestRole)).filter((x): x is HandsOnResult => x !== null);
      if (results.length) { this.io.apply(results); this.status.applied += results.length; }
      this.dirty = true;
    }
  }

  /** Call every ~50 ms: snapshots, the room, the guest's comings and goings, the slow-link check. */
  pump() {
    const now = this.clock();
    if (this.status.ended) {
      if (this.endN > 0 && now - this.lastSnap >= 300) { this.endN--; this.lastSnap = now; this.post(TOPIC.st, { k: "end", why: this.status.ended }); }
      return;
    }
    const here = !!this.pin && now - this.pin.heard < QUIET_MS;
    if (here !== this.here) { this.here = here; this.dirty = true; }
    // the sim backs off the role a human is playing: the guest's while they're here, else the host's own
    const want: LiveRole = this.cfg.hostRole === "server" || here ? "server" : "chef";
    if (this.game?.phase === "service" && this.game.handsOn && this.game.handsOn.role !== want) this.io.setSimRole(want);
    const rtt = this.rtt.median;
    if (rtt !== null && rtt > SLOW_MS && here) this.slowSince ??= now; else this.slowSince = null;
    this.status = { ...this.status, guest: here ? "here" : this.pin ? "away" : "waiting", rtt, slow: this.slowSince !== null && now - this.slowSince >= SLOW_SUSTAIN_MS };
    if (!this.game || !this.base || !this.baseMsg) return;
    if (now - this.lastBase >= BASE_EVERY_MS) { this.lastBase = now; this.post(TOPIC.st, this.baseMsg); }
    // the floor only once the doors are open: before that the guest has the room (base) and waits
    if (this.game.phase !== "service") return;
    const gap = now - this.lastSnap;
    if ((this.dirty && gap >= SNAP_MIN_MS) || gap >= SNAP_IDLE_MS) {
      this.dirty = false;
      this.lastSnap = now;
      const msg = encodeFloor(this.game, this.base, { seq: ++this.seq, t: now, ack: this.ack, rtt, guestOn: here });
      const n = this.post(TOPIC.st, msg);
      if (n) { this.status.snaps++; this.status.snapBytes = n; this.sizes.push(n); if (this.sizes.length > 4000) this.sizes.shift(); }
    }
  }

  /** The shift is over (doors closed, the host ended it, the link was too slow). Said three times: messages drop. */
  end(why: EndWhy) {
    if (this.status.ended) return;
    this.status = { ...this.status, ended: why };
    this.endN = 3;
    this.lastSnap = -1e9;
    this.pump();
  }
}

// ───────────────────────── the guest ─────────────────────────

export interface GuestIO { emit(topic: string, data: unknown): void; now(): number }
export interface GuestStatus { host: "waiting" | "here" | "quiet"; rtt: number | null; on: boolean; ended: EndWhy | null; pending: number }

export class LiveGuest extends End {
  base: Base | null = null;
  floor: Floor | null = null;
  private skeleton: GameState | null = null;
  view: GameState | null = null;
  private pending: [number, HandsOnResult[]][] = [];
  private nextQ = 1;
  private lastAct = -1e9;
  private lastBeat = -1e9;
  private lastHi = -1e9;
  private heardSt = -1e9;
  private floorAt = 0;
  private hostT = 0;
  status: GuestStatus = { host: "waiting", rtt: null, on: false, ended: null, pending: 0 };
  /** Called when the view or the status changes. */
  onChange: (() => void) | null = null;
  constructor(io: GuestIO, private cfg: { nonce: string; role: LiveRole }) {
    super(cfg.nonce, (t, d) => io.emit(t, d), () => io.now());
  }
  get role(): LiveRole { return this.cfg.role; }

  hear(m: RoomMsg) {
    if (m.topic === TOPIC.emo) { if (this.hearEmote(m)) this.onChange?.(); return; }
    if (m.topic !== TOPIC.st || this.status.ended) return;
    const d = this.genuine(m);
    if (!d) return;
    if (!this.pinned(m, HOST_QUIET_MS, d.k === "base" || d.k === "st")) return;
    const now = this.clock();
    if (d.k === "end") {
      const why = END_WHYS.find((w) => w === d.why) ?? "done";
      this.status = { ...this.status, ended: why };
      this.onChange?.();
      return;
    }
    if (d.k === "base") {
      const b = decodeBase(d);
      if (b && b.b !== this.base?.b) { this.base = b; this.skeleton = skeletonOf(b); this.floor = null; this.onChange?.(); }
      return;
    }
    if (d.k !== "st" || !this.base || !this.skeleton) return;
    const f = decodeFloor(d, this.base);
    if (!f || (this.floor && f.seq <= this.floor.seq)) return; // stale (reordered): the newer one already landed
    this.floor = f;
    this.floorAt = now;
    this.hostT = f.t;
    this.heardSt = now;
    this.pending = this.pending.filter(([q]) => q > f.ack);
    this.view = viewOf(this.skeleton, f);
    this.status = { ...this.status, host: "here", rtt: f.rtt, on: f.guestOn, pending: this.pending.length };
    this.onChange?.();
  }

  /** The guest's own session produced results: keep them (filtered to the role) until the host acknowledges them. */
  send(results: readonly HandsOnResult[]) {
    if (this.status.ended) return;
    const mine = roleResults(results, this.cfg.role);
    if (!mine.length) return;
    for (let i = 0; i < mine.length; i += MAX_BATCH) this.pending.push([this.nextQ++, mine.slice(i, i + MAX_BATCH)]);
    if (this.pending.length > MAX_PENDING) this.pending = this.pending.slice(-MAX_PENDING);
    this.flush(true);
  }
  private flush(fresh: boolean) {
    const now = this.clock();
    if (!this.pending.length || now - this.lastAct < (fresh ? ACT_MIN_MS : ACT_RESEND_MS)) return;
    if (this.send2({ k: "act", p: this.pending })) this.lastAct = now;
  }
  private send2(body: Record<string, unknown>): number {
    let ok = this.post(TOPIC.in, body);
    // an over-size act (a burst of results): send the oldest half now, the rest on the next pump
    if (!ok && body.k === "act" && this.pending.length > 1) ok = this.post(TOPIC.in, { k: "act", p: this.pending.slice(0, Math.ceil(this.pending.length / 2)) });
    return ok;
  }

  /** Call every ~50 ms: hello until the room arrives, heartbeats (which carry the round-trip echo), re-sends. */
  pump() {
    const now = this.clock();
    if (this.status.ended) return;
    // hello until the host shows it has us (a floor saying the guest is on): the first hello may have been lost
    if ((!this.base || !this.floor || !this.floor.guestOn) && now - this.lastHi >= HELLO_MS) { this.lastHi = now; this.post(TOPIC.in, { k: "hi", role: this.cfg.role }); }
    if (now - this.lastBeat >= BEAT_MS) {
      this.lastBeat = now;
      this.post(TOPIC.in, { k: "beat", t: now, e: this.hostT, h: this.hostT ? Math.round(now - this.floorAt) : 0, bb: this.base?.b ?? -1 });
    }
    this.flush(false);
    const quiet = this.floor !== null && now - this.heardSt > HOST_QUIET_MS;
    if (quiet !== (this.status.host === "quiet")) { this.status = { ...this.status, host: quiet ? "quiet" : this.floor ? "here" : "waiting" }; this.onChange?.(); }
  }

  leave() { this.post(TOPIC.in, { k: "bye" }); this.status = { ...this.status, ended: "guest" }; }
}
