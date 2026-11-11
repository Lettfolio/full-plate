/**
 * Round 12 (G): the co-op day — what host and guest write, and how a guest's plan becomes sim commands.
 *
 * Shipped variant: the TURN-BASED co-op day (docs/COOP-NOTES.md says why the real-time shared shift wasn't): the guest
 * plans tonight's menu (dishes on/off, prices) and who's on the rota tonight; the host looks at the plan and taps "Use
 * it"; the host's game applies it as ordinary planning commands (SET_MENU_ITEM / SET_ROTA) at that moment — the sim
 * validates them like the host's own taps, and stays deterministic because they enter as commands. The host runs the
 * service; both see the evening's numbers. Six emotes, no text.
 *
 * Two documents per session, one writer each (db.d.ts: last writer wins, one write at a time per document):
 *   fp-coop/<CODE>/side/host   HostDoc — the host's nickname, the board (tonight's menu and staff), the stage, the
 *                              evening, the answer to the last plan, the host's emote, a ping
 *   fp-coop/<CODE>/side/guest  GuestDoc — the guest's nickname, the plan, the guest's emote, the pong
 * Sessions expire two hours after the host made the code; either side can end it.
 */
import type { Command, GameState, StaffRole } from "@full-plate/sim-core";
import { cleanLabel, cleanNick } from "../../state/share";

export const SESSION_MS = 2 * 60 * 60 * 1000;
export const hostPath = (code: string) => `fp-coop/${code}/side/host`;
export const guestPath = (code: string) => `fp-coop/${code}/side/guest`;

export const EMOTES = [
  { id: "wave", glyph: "👋", label: "Hi!" },
  { id: "clap", glyph: "👏", label: "Nice one" },
  { id: "fire", glyph: "🔥", label: "On fire" },
  { id: "yum", glyph: "😋", label: "Looks tasty" },
  { id: "eek", glyph: "😬", label: "Yikes" },
  { id: "think", glyph: "🤔", label: "Hmm" },
] as const;
export type EmoteId = (typeof EMOTES)[number]["id"];
export const emoteOf = (id: unknown) => EMOTES.find((e) => e.id === id) ?? null;
/** One emote every 1.5 s per side, at most: each is one write to the sender's document. */
export const EMOTE_GAP_MS = 1500;

export type Stage = "plan" | "service" | "evening" | "ended";
const MAX_ITEMS = 40;

export interface BoardDish { dishId: string; price: number; active: boolean }
export interface BoardStaff { id: string; name: string; role: StaffRole; on: boolean }
/** What the guest plans over: tonight's menu and staff (the weekday the host is planning). */
export interface Board { day: number; restaurant: string; menu: BoardDish[]; staff: BoardStaff[] }
export interface Evening { day: number; covers: number; walkouts: number; revenue: number; profit: number; rating: number; bestDish?: string }
export interface Emote { id: EmoteId; n: number }

export interface HostDoc {
  kind: "fp-coop-host"; v: 1;
  nick: string; createdAt: number; expiresAt: number;
  stage: Stage;
  board: Board | null;
  evening: Evening | null;
  /** The answer to plan number `n`. */
  answer: { n: number; used: boolean } | null;
  emote: Emote | null;
  ping: { n: number } | null;
  /** Round 13 (F): tonight's live shift, when the host set one up (realtime.ts). Absent on Round 12 documents. */
  live?: LiveDoc | null;
}
export interface Plan { n: number; day: number; menu: BoardDish[]; on: string[] }
export interface GuestDoc {
  kind: "fp-coop-guest"; v: 1;
  nick: string; joinedAt: number;
  plan: Plan | null;
  emote: Emote | null;
  pong: { n: number } | null;
  ended: boolean;
  /** Round 13 (F): the guest's page can reach the `room` capability (so a live shift is on offer). */
  rt?: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const ROLES: readonly StaffRole[] = ["chef", "server", "bar", "porter", "manager"];
const ID = /^[A-Za-z0-9_:.-]{1,40}$/;
const emote = (v: unknown): Emote | null => { const e = obj(v); return emoteOf(e.id) ? { id: e.id as EmoteId, n: int(e.n, 0, 1e15) } : null; };
const counter = (v: unknown): { n: number } | null => (v && typeof v === "object" ? { n: int(obj(v).n, 0, 1e9) } : null);
const dishes = (v: unknown, dish: (id: string) => boolean): BoardDish[] =>
  (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []).map(obj).filter((m) => typeof m.dishId === "string" && dish(m.dishId))
    .map((m) => ({ dishId: m.dishId as string, price: int(m.price, 0, 100_000), active: m.active !== false }));

// ── Round 13 (F): the live shift's lobby record (lib/coop/realtime.ts has the rest) ──
export type LiveRole = "chef" | "server";
export type EndWhy = "done" | "slow" | "host" | "office" | "lost" | "guest";
export const END_WHYS: readonly EndWhy[] = ["done", "slow", "host", "office", "lost", "guest"];
/** The lobby record for a live shift, in the host's db document (`HostDoc.live`): late joiners read it there. */
export interface LiveDoc {
  nonce: string;
  guestRole: LiveRole;
  state: "ready" | "on" | "ended";
  /** The game day it is for; a stale "ready" from yesterday is ignored. */
  day: number;
  at: number;
  why?: EndWhy;
}
const NONCE_RE = /^[a-z0-9]{24}$/;
/** 24 characters of [a-z0-9] (≈124 bits) by crypto.getRandomValues with rejection sampling. */
export function newNonce(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const A = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < 24) for (const b of rand(32)) { if (b < 252 && out.length < 24) out += A[b % 36]; }
  return out;
}
export function checkLive(v: unknown): LiveDoc | null {
  const o = obj(v);
  if (typeof o.nonce !== "string" || !NONCE_RE.test(o.nonce)) return null;
  const state = o.state === "on" || o.state === "ended" ? o.state : o.state === "ready" ? "ready" : null;
  if (!state) return null;
  const why = END_WHYS.find((w) => w === o.why);
  return { nonce: o.nonce, guestRole: o.guestRole === "chef" ? "chef" : "server", state, day: int(o.day, 0, 1e6), at: int(o.at, 0, 1e14), ...(why ? { why } : {}) };
}

/** The host's document as the guest reads it (untrusted: coerced). */
export function checkHost(raw: unknown, dish: (id: string) => boolean): HostDoc | null {
  const o = obj(raw);
  if (o.kind !== "fp-coop-host" || o.v !== 1) return null;
  const b = obj(o.board), e = obj(o.evening), a = obj(o.answer);
  const stage: Stage = o.stage === "service" || o.stage === "evening" || o.stage === "ended" ? o.stage : "plan";
  return {
    kind: "fp-coop-host", v: 1,
    nick: cleanNick(o.nick) || "Your friend",
    createdAt: int(o.createdAt, 0, 1e14), expiresAt: int(o.expiresAt, 0, 1e14),
    stage,
    board: o.board ? {
      day: int(b.day, 0, 1e6), restaurant: cleanLabel(b.restaurant) || "Their restaurant",
      menu: dishes(b.menu, dish),
      staff: (Array.isArray(b.staff) ? b.staff.slice(0, MAX_ITEMS) : []).map(obj).filter((s) => typeof s.id === "string" && ID.test(s.id) && ROLES.includes(s.role as StaffRole))
        .map((s) => ({ id: s.id as string, name: cleanLabel(s.name, 24) || "Someone", role: s.role as StaffRole, on: s.on === true })),
    } : null,
    evening: o.evening ? {
      day: int(e.day, 0, 1e6), covers: int(e.covers, 0, 1e5), walkouts: int(e.walkouts, 0, 1e5), revenue: int(e.revenue, -1e9, 1e9), profit: int(e.profit, -1e9, 1e9),
      rating: Math.max(0, Math.min(5, typeof e.rating === "number" && Number.isFinite(e.rating) ? e.rating : 0)),
      ...(typeof e.bestDish === "string" && dish(e.bestDish) ? { bestDish: e.bestDish } : {}),
    } : null,
    answer: o.answer ? { n: int(a.n, 0, 1e9), used: a.used === true } : null,
    emote: emote(o.emote),
    ping: counter(o.ping),
    ...(o.live !== undefined ? { live: checkLive(o.live) } : {}),
  };
}

/** The guest's document as the host reads it (untrusted: coerced; the plan is filtered again against the board). */
export function checkGuest(raw: unknown, dish: (id: string) => boolean): GuestDoc | null {
  const o = obj(raw);
  if (o.kind !== "fp-coop-guest" || o.v !== 1) return null;
  const p = obj(o.plan);
  return {
    kind: "fp-coop-guest", v: 1,
    nick: cleanNick(o.nick) || "Your friend",
    joinedAt: int(o.joinedAt, 0, 1e14),
    plan: o.plan ? {
      n: int(p.n, 0, 1e9), day: int(p.day, 0, 1e6), menu: dishes(p.menu, dish),
      on: (Array.isArray(p.on) ? p.on.slice(0, MAX_ITEMS) : []).filter((s): s is string => typeof s === "string" && ID.test(s)),
    } : null,
    emote: emote(o.emote),
    pong: counter(o.pong),
    ended: o.ended === true,
    ...(o.rt === true ? { rt: true } : {}),
  };
}

/** Tonight's board from the host's game (in planning: the weekday being planned). */
export function boardOf(game: GameState, weekday: number): Board {
  return {
    day: game.day,
    restaurant: cleanLabel(game.restaurantName),
    menu: game.menu.slice(0, MAX_ITEMS).map((m) => ({ dishId: m.dishId, price: m.price, active: m.active })),
    staff: game.staff.slice(0, MAX_ITEMS).filter((s) => ID.test(s.id)).map((s) => ({ id: s.id, name: cleanLabel(s.name, 24), role: s.role, on: !!s.rota[weekday] })),
  };
}

/** The evening the guest sees, from the host's last day result. */
export function eveningOf(game: GameState): Evening | null {
  const r = game.history.at(-1);
  if (!r || r.day !== game.day) return null;
  return { day: r.day, covers: r.covers, walkouts: r.walkouts, revenue: r.revenue, profit: r.profit, rating: Math.round(r.averageRating * 10) / 10, ...(r.bestDish ? { bestDish: r.bestDish } : {}) };
}

export interface PlanChange { kind: "dishOn" | "dishOff" | "price" | "staffOn" | "staffOff"; label: string; cmd: Command }
/**
 * A guest's plan → the commands that would make the host's game match it. Only dishes already on the host's menu and
 * staff already on the books count (anything else is ignored); prices are whole pence within the menu's own range;
 * a plan for another day is stale and changes nothing.
 */
export function planCommands(game: GameState, plan: Plan, weekday: number, name: (dishId: string) => string): PlanChange[] {
  if (game.phase !== "planning" || plan.day !== game.day) return [];
  const out: PlanChange[] = [];
  for (const want of plan.menu) {
    const m = game.menu.find((x) => x.dishId === want.dishId);
    if (!m) continue;
    const price = Math.max(25, Math.min(20_000, Math.round(want.price / 5) * 5));
    if (want.active !== m.active) { out.push({ kind: want.active ? "dishOn" : "dishOff", label: `${want.active ? "Put on" : "Take off"} ${name(m.dishId)}`, cmd: { type: "SET_MENU_ITEM", dishId: m.dishId, active: want.active } }); }
    if (price !== m.price) { out.push({ kind: "price", label: `${name(m.dishId)} at £${(price / 100).toFixed(2)}`, cmd: { type: "SET_MENU_ITEM", dishId: m.dishId, price } }); }
  }
  const on = new Set(plan.on);
  for (const s of game.staff) {
    if (!ID.test(s.id)) continue;
    const want = on.has(s.id);
    if (want === !!s.rota[weekday]) continue;
    const rota = s.rota.slice();
    rota[weekday] = want;
    out.push({ kind: want ? "staffOn" : "staffOff", label: `${cleanLabel(s.name, 24)} ${want ? "works tonight" : "has tonight off"}`, cmd: { type: "SET_ROTA", staffId: s.id, rota } });
  }
  return out;
}

export function hostDoc(p: Partial<HostDoc> & Pick<HostDoc, "nick" | "createdAt">): HostDoc {
  return { kind: "fp-coop-host", v: 1, expiresAt: p.createdAt + SESSION_MS, stage: "plan", board: null, evening: null, answer: null, emote: null, ping: null, ...p };
}
export function guestDoc(p: Partial<GuestDoc> & Pick<GuestDoc, "nick" | "joinedAt">): GuestDoc {
  return { kind: "fp-coop-guest", v: 1, plan: null, emote: null, pong: null, ended: false, ...p };
}
export const expired = (h: Pick<HostDoc, "expiresAt">, now = Date.now()): boolean => now >= h.expiresAt;
