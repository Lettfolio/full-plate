/**
 * Round 12 (G): visiting a friend's restaurant and the co-op day — the data layer over the artifact runtime's `db`.
 * Round 14 (B, S14-2 / S14-11): every shared document now has exactly ONE writer, enforced by the artifact's `db`
 * rules (scripts/lib/dbRules.ts DB_RULES; docs/COOP-NOTES.md "Round 14 — B"), not by client checks. Each player writes
 * only under their own id, and the author of anything shared is read from its PATH (which the rules make trustworthy):
 *
 *   fps/<uid>                          "I share" marker (no fields that matter): lets a code find its owner
 *   fps/<uid>/s<hash(code)>/snap       one snapshot per shared game, written only by <uid>
 *   fpr/<uid>                          <uid>'s own reviews of other people's shares: one entry per share, keyed by a
 *                                      slow hash of its code (`k` lists the keys so the owner can query for theirs)
 *   fpc/<uid>, fpc/<uid>/c<hash>/host|guest   co-op (lib/coop/protocol.ts): each side writes only its own document
 *   data/users/<uid>/r12/g/social      private: which code each of my games is shared under, my co-op sessions
 *
 * A code is 10 characters: 8 random, then 2 check letters computed from the random part AND the owner's platform id.
 * A visitor lists the marker documents (one per player who shares), keeps the ids whose check letters fit, and reads
 * `fps/<id>/s<hash(code)>/snap` for each: only the real owner can have written there. Someone else with the code can
 * write their own snapshot under their own id, but the check letters fit their id only by a 1-in-961 fluke, and if
 * two ever fit the code opens nothing ("ask for a new code") rather than the wrong one. Enumeration: the marker list
 * gives ids but no codes; from an id, a snapshot path needs the code's 8 random letters (31^8 ≈ 8.5 × 10^11 online
 * guesses per player, each a db call). Review keys are 8,192 rounds of SHA-256 over the code, so cracking one offline
 * costs 31^8 × 8,192 × (players) hashes. Nothing links two of a player's shares beyond the id in their paths: the
 * snapshot carries no owner field (the R12 owner hash is gone).
 *
 * Everything read back is untrusted: snapshots are coerced field by field (`checkSnapshot`); review lines in a
 * snapshot are shown only if they are the game's own words (`known.line` re-builds them from the review templates);
 * reviews keep only a star count, compliment ids from the fixed list and a nickname of ≤16 letters, digits and spaces.
 * Nothing here feeds the sim; wall-clock dates are UI metadata only.
 */
import type { DecorSlot, Difficulty, GameState, StaffRole } from "@full-plate/sim-core";
import { cleanName } from "@full-plate/sim-core/schema";
import { DECOR_SLOTS } from "../sim";
import { fnv1a, runtime } from "./saveStore";
import { sha256Hex } from "../lib/coop/sha256";
import { prefsStorage } from "../lib/storage";

// ── the subset of db.d.ts used here (doc refs, ordered/limited queries, snapshots) ──
export interface SDocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
export interface SDocRef {
  get(): Promise<SDocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: SDocSnap) => void, error?: (e: { code: string }) => void): () => void;
}
export interface SQuery {
  where(field: string, op: "==" | "array-contains", value: unknown): SQuery;
  orderBy(field: string, dir?: "asc" | "desc"): SQuery;
  limit(n: number): SQuery;
  get(): Promise<{ docs: SDocSnap[] }>;
  onSnapshot(next: (s: { docs: SDocSnap[] }) => void, error?: (e: { code: string }) => void): () => void;
}
export interface SCol extends SQuery { doc(id: string): SDocRef }
export interface SDb { doc(path: string): SDocRef; collection(path: string): SCol }
export type Link = { db: SDb; uid: string } | { off: "none" | "signed-out" };

let override: (() => Promise<Link>) | null = null;
let cached: Promise<Link> | null = null;
/** Tests: swap how the db is reached (null = the real runtime). */
export function setLinkForTests(fn: (() => Promise<Link>) | null): void { override = fn; cached = null; }

/** The db and this viewer's id, or why not ("none": not inside claude.ai, e.g. GitHub Pages). Memoised. */
export function link(): Promise<Link> {
  if (override) return override();
  return (cached ??= (async (): Promise<Link> => {
    const c = runtime();
    if (!c) return { off: "none" };
    try {
      const [db, user] = (await Promise.all([c.use("db"), c.use("user")])) as [SDb | null, { id(): Promise<string | null> } | null];
      if (!db || !user) return { off: "none" };
      const uid = await user.id();
      return uid ? { db, uid } : { off: "signed-out" };
    } catch { return { off: "none" }; }
  })());
}

/** The one line the buttons show where there is no db. */
export const NO_DB_LINE = "Sharing needs the Claude link: it works when the game is opened from claude.ai.";
export const SIGNED_OUT_LINE = "Sign in to claude.ai to share and visit.";
export const offLine = (l: Link): string | null => ("off" in l ? (l.off === "signed-out" ? SIGNED_OUT_LINE : NO_DB_LINE) : null);

export const errCode = (e: unknown): string => (e && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "unavailable");

// ── codes ──
/** No 0/O, 1/I/L: a code read out loud or copied by hand survives. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 10;
/** The random part; the last two letters are the check letters (`codeCheck`). */
export const CODE_RAND = 8;
/** Two letters from the random part and the owner's platform id: only the owner's id fits (bar a 1-in-961 fluke). */
export function codeCheck(rand: string, uid: string): string {
  const h = sha256Hex(`fp-code|${rand}|${uid}`);
  return CODE_ALPHABET[parseInt(h.slice(0, 8), 16) % 31]! + CODE_ALPHABET[parseInt(h.slice(8, 16), 16) % 31]!;
}
/** Could this code be `uid`'s? */
export const codeFits = (code: string, uid: string): boolean => code.length === CODE_LEN && codeCheck(code.slice(0, CODE_RAND), uid) === code.slice(CODE_RAND);
/** A fresh code for `uid`: 8 letters by crypto.getRandomValues (rejection sampling, no bias) + the check letters. */
export function newCode(uid: string, rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = "";
  while (out.length < CODE_RAND) {
    for (const b of rand(CODE_RAND * 2)) {
      if (b >= 248) continue; // 248 = 8 × 31: no bias
      out += CODE_ALPHABET[b % 31];
      if (out.length === CODE_RAND) break;
    }
  }
  return out + codeCheck(out, uid);
}
/** What she typed → a code, or null. Spaces, dashes and case don't matter; O→0 and I/L→1 are not in the alphabet. */
export function parseCode(s: string): string | null {
  const t = s.toUpperCase().replace(/[\s-]/g, "");
  return t.length === CODE_LEN && [...t].every((ch) => CODE_ALPHABET.includes(ch)) ? t : null;
}
/** ABCDE-FGHJK: easier to read out. */
export const showCode = (c: string): string => `${c.slice(0, 5)}-${c.slice(5)}`;

// ── names ──
export const NICK_MAX = 16;
/** A nickname: letters, digits and single spaces only, at most 16 characters (whole code points). */
export function cleanNick(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = cleanName(v, 64).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(t).slice(0, NICK_MAX).join("").trim();
}
/** While typing: drop anything but letters, digits and spaces; the 16-character cap (trimmed on use). */
export const nickInput = (v: string): string => Array.from(v.replace(/[^\p{L}\p{N} ]/gu, "")).slice(0, NICK_MAX).join("");
/** A restaurant or staff name from someone else's snapshot: unsafe characters stripped, short. */
export const cleanLabel = (v: unknown, max = 40): string => (typeof v === "string" ? cleanName(v, max).trim() : "");

// ── compliments: the only words a visitor can leave ──
export const COMPLIMENTS = [
  { id: "food", text: "The food was spot on" },
  { id: "room", text: "Lovely room" },
  { id: "staff", text: "Friendly staff" },
  { id: "fast", text: "Quick service" },
  { id: "value", text: "Good value" },
  { id: "menu", text: "Great menu" },
  { id: "music", text: "Good music" },
  { id: "back", text: "I'd come back" },
] as const;
export type ComplimentId = (typeof COMPLIMENTS)[number]["id"];
export const MAX_PICKS = 3;
export const complimentText = (id: string): string | null => COMPLIMENTS.find((c) => c.id === id)?.text ?? null;

// ── the snapshot ──
const ROLES: readonly StaffRole[] = ["chef", "server", "bar", "porter", "manager"];
const SOURCES = ["walkin", "online", "critic", "wordofmouth"] as const;
export interface ShareSnapshot {
  v: 1;
  kind: "fp-share";
  name: string;
  districtId: string;
  difficulty: Difficulty;
  /** Sim day (0-based) the snapshot was taken. */
  day: number;
  /** Wall-clock date it was shared (YYYY-MM-DD): UI only. */
  date: string;
  tables: number[];
  decor: Partial<Record<DecorSlot, { itemId: string; since: number }>>;
  rep: { popularity: number; prestige: number };
  menu: { dishId: string; price: number; active: boolean }[];
  staff: { name: string; role: StaffRole; skill: number }[];
  reviews: { day: number; rating: number; source: (typeof SOURCES)[number]; text: string; dishId?: string }[];
  /** The last ≤7 nights, oldest first. Pence. */
  week: { day: number; covers: number; walkouts: number; revenue: number; profit: number; rating: number; closed?: boolean }[];
  /** Round 12 (B) brand kit, if the game has one: carried as plain data, not rendered as HTML. Optional. */
  brand?: Record<string, string | number>;
}
export const LIMITS = { tables: 24, menu: 40, staff: 40, reviews: 8, week: 7, text: 160 } as const;

const int = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const num = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
// Round 13 (E): Array.from fills holes (a sparse list would otherwise keep them through .map).
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? Array.from(v.slice(0, max)) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const today = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

/** What a friend sees: the save stripped to what the visit draws (no cash, loan, stock, prefs, accounts or RNG). */
export function buildSnapshot(game: GameState, now = Date.now(), brand?: Record<string, string | number>): ShareSnapshot {
  const decor: ShareSnapshot["decor"] = {};
  for (const [slot, v] of Object.entries(game.decor?.slots ?? {})) if (v) decor[slot as DecorSlot] = { itemId: v.itemId, since: v.since };
  return {
    v: 1, kind: "fp-share",
    name: cleanLabel(game.restaurantName) || "A restaurant",
    districtId: game.districtId, difficulty: game.difficulty, day: game.day, date: today(now),
    tables: game.tables.slice(0, LIMITS.tables).map((t) => t.seats),
    decor,
    rep: { popularity: Math.round(game.reputation.popularity), prestige: Math.round(game.reputation.prestige) },
    menu: game.menu.slice(0, LIMITS.menu).map((m) => ({ dishId: m.dishId, price: m.price, active: m.active })),
    staff: game.staff.slice(0, LIMITS.staff).map((s) => ({ name: cleanLabel(s.name, 24), role: s.role, skill: Math.round(s.skill) })),
    reviews: recentReviews(game),
    week: game.history.slice(-LIMITS.week).map((d) => ({
      day: d.day, covers: d.covers, walkouts: d.walkouts, revenue: d.revenue, profit: d.profit, rating: Math.round(d.averageRating * 10) / 10, ...(d.closed ? { closed: true } : {}),
    })),
    ...(brand ? { brand } : {}),
  };
}

/** The newest reviews the sim wrote, from the last three nights' results. */
function recentReviews(game: GameState): ShareSnapshot["reviews"] {
  const past = game.history.slice(-3).flatMap((d) => d.reviews ?? []);
  const all = past;
  return all.slice(-LIMITS.reviews).reverse().map((r) => ({
    day: r.day, rating: Math.max(1, Math.min(5, Math.round(r.rating))), source: r.source, text: cleanLabel(r.text, LIMITS.text), ...(r.dishId ? { dishId: r.dishId } : {}),
  }));
}

/**
 * Someone else's snapshot, coerced: every field to its type and range, lists capped, names cleaned. `known` filters
 * ids against this build's content (unknown dishes, decor items and districts are dropped, not shown as raw ids).
 */
export interface Known {
  dish(id: string): boolean; decor(id: string): boolean; district(id: string): boolean;
  /**
   * Round 14 (B): is `text` a line the game itself writes for a review with this rating and dish at a restaurant of
   * this name (lib/visit.ts rebuilds it from the review templates)? Absent: no review line is shown.
   */
  line?(text: string, rating: number, dishId: string | undefined, restaurant: string): boolean;
}
export function checkSnapshot(raw: unknown, known: Known): ShareSnapshot | null {
  const o = obj(raw);
  if (o.kind !== "fp-share" || o.v !== 1) return null;
  const decor: ShareSnapshot["decor"] = {};
  for (const [slot, v] of Object.entries(obj(o.decor)).slice(0, 12)) {
    const e = obj(v);
    // Round 13 (E): only the room's real slots (an own "__proto__" key from JSON.parse would otherwise set the object's prototype).
    if ((DECOR_SLOTS as readonly string[]).includes(slot) && typeof e.itemId === "string" && known.decor(e.itemId)) decor[slot as DecorSlot] = { itemId: e.itemId, since: int(e.since, 0, 1e6) };
  }
  const brand: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(obj(o.brand)).slice(0, 12)) {
    if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) brand[k] = v;
    else if (typeof v === "string") brand[k] = cleanLabel(v, 40);
  }
  const rep = obj(o.rep);
  const snap: ShareSnapshot = {
    v: 1, kind: "fp-share",
    name: cleanLabel(o.name) || "A restaurant",
    districtId: typeof o.districtId === "string" && known.district(o.districtId) ? o.districtId : "",
    difficulty: o.difficulty === "cosy" || o.difficulty === "hard" ? o.difficulty : "normal",
    day: int(o.day, 0, 1e6),
    date: typeof o.date === "string" && DATE.test(o.date) ? o.date : "",
    tables: arr(o.tables, LIMITS.tables).map((s) => int(s, 1, 12, 2)),
    decor,
    rep: { popularity: int(rep.popularity, 0, 100), prestige: int(rep.prestige, 0, 100) },
    menu: arr(o.menu, LIMITS.menu).map(obj).filter((m) => typeof m.dishId === "string" && known.dish(m.dishId))
      .map((m) => ({ dishId: m.dishId as string, price: int(m.price, 0, 100_000), active: m.active !== false })),
    staff: arr(o.staff, LIMITS.staff).map(obj).filter((s) => ROLES.includes(s.role as StaffRole))
      .map((s) => ({ name: cleanLabel(s.name, 24) || "Someone", role: s.role as StaffRole, skill: int(s.skill, 0, 100) })),
    reviews: arr(o.reviews, LIMITS.reviews).map(obj).map((r) => ({
      day: int(r.day, 0, 1e6), rating: int(r.rating, 1, 5, 3),
      source: SOURCES.includes(r.source as (typeof SOURCES)[number]) ? (r.source as (typeof SOURCES)[number]) : "walkin",
      text: cleanLabel(r.text, LIMITS.text),
      ...(typeof r.dishId === "string" && known.dish(r.dishId) ? { dishId: r.dishId } : {}),
    })).filter((r) => r.text && !!known.line?.(r.text, r.rating, r.dishId, cleanLabel(o.name) || "A restaurant")),
    week: arr(o.week, LIMITS.week).map(obj).map((d) => ({
      day: int(d.day, 0, 1e6), covers: int(d.covers, 0, 1e5), walkouts: int(d.walkouts, 0, 1e5),
      revenue: int(d.revenue, -1e9, 1e9), profit: int(d.profit, -1e9, 1e9), rating: num(d.rating, 0, 5), ...(d.closed === true ? { closed: true } : {}),
    })),
    ...(Object.keys(brand).length ? { brand } : {}),
  };
  return snap;
}

// ── paths ──
/** The collection segment a code's documents live under: `s…` for a share, `c…` for a co-op session (not listable). */
export const codeSeg = (kind: "s" | "c", code: string): string => kind + sha256Hex(`fp-at|${kind}|${code}`).slice(0, 32);
const STRETCH = 8192;
const slow = new Map<string, string>();
/** A key published where anyone can read it (review keys, co-op join keys): 8,192 rounds of SHA-256 over the code. */
export function slowKey(kind: "r" | "j", code: string): string {
  const k = `${kind}|${code}`;
  let h = slow.get(k);
  if (h) return h;
  h = sha256Hex(`fp-key|${k}`);
  for (let i = 0; i < STRETCH; i++) h = sha256Hex(h + code);
  h = kind + h.slice(0, 32);
  if (slow.size > 64) slow.clear();
  slow.set(k, h);
  return h;
}
/** The "I share" marker: the document a code's check letters are tested against. */
export const pubPath = (uid: string) => `fps/${uid}`;
export const snapPath = (ownerId: string, code: string) => `fps/${ownerId}/${codeSeg("s", code)}/snap`;
/** A player's own reviews of other people's shares. */
export const visitsPath = (uid: string) => `fpr/${uid}`;
export const mePath = (uid: string) => `data/users/${uid}/r12/g/social`;
/** The game a share belongs to: the same restaurant across saves and devices (seed, street and name). */
export const gameKey = (g: Pick<GameState, "seed" | "districtId" | "restaurantName">): string => fnv1a(`${g.seed}|${g.districtId}|${g.restaurantName}`);

/** The ids under `root` whose check letters fit `code`: who could have shared or be hosting it. */
export async function codeOwners(db: SDb, root: "fps" | "fpc", code: string): Promise<string[]> {
  const s = await db.collection(root).limit(1000).get();
  return s.docs.map((d) => d.id).filter((id) => codeFits(code, id));
}
/** Write my marker if it isn't there (one read, at most one write). */
export async function ensureDoc(db: SDb, path: string, body: Record<string, unknown>): Promise<void> {
  if (!(await db.doc(path).get()).exists) await db.doc(path).set(body);
}

// ── reviews ──
/** One review as the owner sees it. `id` is the visitor's platform id: from the PATH of the document it came from. */
export interface VisitReview { id: string; stars: number; picks: ComplimentId[]; nick: string; date: string }
/** One entry of a visitor's `fpr/<uid>` document, coerced. */
export function checkReview(id: string, raw: unknown): VisitReview | null {
  const o = obj(raw);
  const stars = int(o.stars, 0, 5, 0);
  if (!stars) return null;
  const picks = [...new Set(arr(o.picks, MAX_PICKS * 2).filter((p): p is ComplimentId => typeof p === "string" && !!complimentText(p)))].slice(0, MAX_PICKS);
  return { id, stars, picks, nick: cleanNick(o.nick), date: typeof o.date === "string" && DATE.test(o.date) ? o.date : "" };
}
/** The owner's list shows at most this many (newest first); each visitor has one entry per share, so nobody can push others out. */
export const MAX_REVIEWS = 50;
/** A visitor keeps at most this many reviews in their own document (the oldest go). */
export const MAX_MY_REVIEWS = 30;

// ── my private record ──
export interface CoopNote { role: "host" | "guest"; host: string; exp: number }
export interface Me { shares: Record<string, string>; coop: Record<string, CoopNote> }
const ME_LOCAL = "full-plate:social:v1";
const MAX_ME = 60;
/** Most a player shares at once (one per game). */
export const MAX_SHARES = 12;
/** This device's copy of the private record, per account (two people on one device keep their own). */
const meLocalKey = (uid: string) => `${ME_LOCAL}:${fnv1a(uid)}`;
function readLocalMe(uid: string): Me {
  try {
    const o = obj(JSON.parse(prefsStorage().getItem(meLocalKey(uid)) ?? "{}"));
    return { shares: strMap(o.shares), coop: coopMap(o.coop) };
  } catch { return { shares: {}, coop: {} }; }
}
function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(v)).slice(-MAX_ME)) if (typeof x === "string" && k.length <= 40) out[k] = x.slice(0, 40);
  return out;
}
const UIDISH = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function coopMap(v: unknown): Record<string, CoopNote> {
  const out: Record<string, CoopNote> = {};
  for (const [k, x] of Object.entries(obj(v)).slice(-20)) {
    const e = obj(x);
    if (parseCode(k) === k && (e.role === "host" || e.role === "guest") && typeof e.host === "string" && UIDISH.test(e.host)) out[k] = { role: e.role, host: e.host, exp: int(e.exp, 0, 1e14) };
  }
  return out;
}
const trimMap = <T>(m: Record<string, T>, n = MAX_ME) => Object.fromEntries(Object.entries(m).slice(-n));
export async function readMe(l: { db: SDb; uid: string }): Promise<Me> {
  const local = readLocalMe(l.uid);
  try {
    const s = await l.db.doc(mePath(l.uid)).get();
    if (!s.exists) return local;
    const d = obj(s.data());
    // the account copy wins (it follows the player across devices); this device's copy fills in when it has none
    return { shares: strMap(d.shares), coop: { ...local.coop, ...coopMap(d.coop) } };
  } catch { return local; }
}
export async function writeMe(l: { db: SDb; uid: string }, me: Me): Promise<void> {
  const body = { kind: "fp-social", v: 2, shares: trimMap(me.shares), coop: trimMap(me.coop, 20) };
  try { prefsStorage().setItem(meLocalKey(l.uid), JSON.stringify(body)); } catch { /* storage blocked */ }
  await l.db.doc(mePath(l.uid)).set(body);
}

// ── owner: share, re-share, stop ──
/** Share (or re-share, overwriting) this game's snapshot. Returns its code. */
export async function share(l: { db: SDb; uid: string }, game: GameState, opts: { now?: number; code?: () => string; brand?: Record<string, string | number> } = {}): Promise<string> {
  const me = await readMe(l);
  const key = gameKey(game);
  const had = me.shares[key];
  const fresh = !had || !codeFits(had, l.uid); // an R12 code (no check letters for this id) gets a new one
  if (fresh && Object.keys(me.shares).filter((k) => k !== key).length >= MAX_SHARES) throw { code: "quota_exceeded" };
  const code = fresh ? (opts.code ?? (() => newCode(l.uid)))() : had;
  if (!codeFits(code, l.uid)) throw { code: "invalid_argument" };
  await ensureDoc(l.db, pubPath(l.uid), { kind: "fp-pub", v: 2 });
  await l.db.doc(snapPath(l.uid, code)).set({ ...buildSnapshot(game, opts.now, opts.brand) });
  if (had !== code) await writeMe(l, { ...me, shares: { ...me.shares, [key]: code } });
  return code;
}
/** This game's share code, if it is shared (from my private record; the snapshot may have been removed since). */
export async function sharedCode(l: { db: SDb; uid: string }, game: GameState): Promise<string | null> {
  const code = (await readMe(l)).shares[gameKey(game)];
  if (!code || !codeFits(code, l.uid)) return null;
  try { return (await l.db.doc(snapPath(l.uid, code)).get()).exists ? code : null; } catch { return code; }
}
/**
 * Stop sharing the game with this key: its snapshot goes and the code is forgotten (a new share gets a new code); with
 * nothing left shared, the marker goes too. Visitors' reviews live in THEIR documents, which only they can write: they
 * point at a code that now opens nothing, and each visitor's list drops its oldest entries as they review elsewhere.
 */
export async function forgetShare(l: { db: SDb; uid: string }, key: string): Promise<boolean> {
  const me = await readMe(l);
  const code = me.shares[key];
  if (!code) return false;
  if (codeFits(code, l.uid)) await l.db.doc(snapPath(l.uid, code)).delete();
  const shares = { ...me.shares };
  delete shares[key];
  await writeMe(l, { ...me, shares });
  if (!Object.keys(shares).length) await l.db.doc(pubPath(l.uid)).delete();
  return true;
}
export async function stopSharing(l: { db: SDb; uid: string }, game: GameState): Promise<void> { await forgetShare(l, gameKey(game)); }

const HIDE_KEY = "full-plate:social-hide:v1";
/** Visitors the owner hid from this share's list (this device only: nobody else's data changes). */
export function hiddenVisitors(code: string): string[] {
  try { const v = obj(JSON.parse(prefsStorage().getItem(HIDE_KEY) ?? "{}"))[code]; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-200) : []; } catch { return []; }
}
export function hideVisitor(code: string, id: string): void {
  try {
    const all = obj(JSON.parse(prefsStorage().getItem(HIDE_KEY) ?? "{}"));
    const next = { ...Object.fromEntries(Object.entries(all).slice(-20)), [code]: [...new Set([...hiddenVisitors(code), id])].slice(-200) };
    prefsStorage().setItem(HIDE_KEY, JSON.stringify(next));
  } catch { /* storage blocked: hidden for this visit only (the card keeps its own list) */ }
}
/**
 * The reviews of my share `code`, from the visitors' own documents: one per visitor (the id from the document's
 * path), my own id and hidden ones left out, dates in the future read as today, newest first, at most 50. Pruned by
 * count on read; nobody's document is deleted.
 */
export function listReviews(docs: SDocSnap[], code: string, ownerId: string, hidden: readonly string[] = [], now = Date.now()): VisitReview[] {
  const key = slowKey("r", code);
  const day = today(now);
  const out: VisitReview[] = [];
  for (const d of docs) {
    if (d.id === ownerId || hidden.includes(d.id) || !UIDISH.test(d.id)) continue;
    const body = obj(d.data());
    if (body.kind !== "fp-visits") continue;
    const r = checkReview(d.id, obj(body.r)[key]);
    if (r) out.push({ ...r, date: r.date > day ? day : r.date });
  }
  return out.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1)).slice(0, MAX_REVIEWS);
}
/** My share's reviews, live (`fpr` documents whose `k` lists this code's review key). */
export function watchReviews(l: { db: SDb; uid: string }, code: string, next: (r: VisitReview[]) => void, error?: (code: string) => void, hidden: () => readonly string[] = () => hiddenVisitors(code)): () => void {
  return l.db.collection("fpr").where("k", "array-contains", slowKey("r", code)).limit(200).onSnapshot(
    (s) => next(listReviews(s.docs, code, l.uid, hidden())),
    (e) => error?.(e.code),
  );
}

// ── visitor ──
export type Opened = { snap: ShareSnapshot; mine: boolean; ownerId: string } | { missing: true; muddled?: boolean };
/** Open a share by code: the one snapshot whose owner's id fits the code's check letters. */
export async function openShare(l: { db: SDb; uid: string }, code: string, known: Known): Promise<Opened> {
  const found: { id: string; snap: ShareSnapshot }[] = [];
  for (const id of await codeOwners(l.db, "fps", code)) {
    const s = await l.db.doc(snapPath(id, code)).get();
    const snap = s.exists ? checkSnapshot(s.data(), known) : null;
    if (snap) found.push({ id, snap });
  }
  if (found.length !== 1) return found.length ? { missing: true, muddled: true } : { missing: true };
  const f = found[0]!;
  return { snap: f.snap, mine: f.id === l.uid, ownerId: f.id };
}
async function myVisits(l: { db: SDb; uid: string }): Promise<Record<string, unknown>> {
  const s = await l.db.doc(visitsPath(l.uid)).get();
  return s.exists ? obj(obj(s.data()).r) : {};
}
/** Has this viewer reviewed this share today (from their own reviews document)? */
export async function reviewedToday(l: { db: SDb; uid: string }, code: string, now = Date.now()): Promise<boolean> {
  return obj((await myVisits(l))[slowKey("r", code)]).date === today(now);
}
export type ReviewResult = "sent" | "already" | "own" | "bad";
/**
 * One review per visitor per share (a new one replaces mine, at most once a day), stars 1–5 and up to three
 * compliments from the list, written into MY document `fpr/<my id>` — nobody else can write or delete it.
 */
export async function leaveReview(l: { db: SDb; uid: string }, code: string, r: { stars: number; picks: string[]; nick: string; mine?: boolean }, now = Date.now()): Promise<ReviewResult> {
  if (r.mine) return "own";
  const stars = Math.round(r.stars);
  if (!(stars >= 1 && stars <= 5)) return "bad";
  const picks = [...new Set(r.picks.filter((p) => !!complimentText(p)))].slice(0, MAX_PICKS);
  const date = today(now);
  const key = slowKey("r", code);
  const mine = await myVisits(l);
  if (obj(mine[key]).date === date) return "already";
  const keep = Object.entries(mine).filter(([k, v]) => k !== key && /^r[0-9a-f]{32}$/.test(k) && checkReview("", v))
    .sort((a, b) => String(obj(b[1]).date).localeCompare(String(obj(a[1]).date))).slice(0, MAX_MY_REVIEWS - 1);
  const entries = Object.fromEntries([[key, { stars, picks, nick: cleanNick(r.nick), date }], ...keep]);
  await l.db.doc(visitsPath(l.uid)).set({ kind: "fp-visits", v: 2, k: Object.keys(entries), r: entries });
  return "sent";
}
