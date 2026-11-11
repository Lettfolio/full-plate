/**
 * Round 12 (G): visiting a friend's restaurant and the co-op day — the data layer over the artifact runtime's `db`.
 *
 * There is no game server. Everything goes through the `db` capability (db.d.ts) that the saves already use, in
 * collections the saves never touch:
 *
 *   fp-share/<CODE>/v/snap              the owner's read-only snapshot (ShareSnapshot + owner hash)
 *   fp-share/<CODE>/reviews/<rid>       one visitor's review: 1–5 stars + picks from COMPLIMENTS (no free text)
 *   fp-coop/<CODE>/side/host            co-op: written only by the host (lib/coop/protocol.ts)
 *   fp-coop/<CODE>/side/guest           co-op: written only by the guest
 *   data/users/<uid>/r12/g/social       private: which code each of my games is shared under, which shares I reviewed
 *
 * The parent documents `fp-share/<CODE>` and `fp-coop/<CODE>` are never written, so a query on `fp-share` lists
 * nothing: a code is the only way in (Firestore-style nesting, as db.d.ts describes: deleting or omitting a parent
 * document leaves nested ones alone). Codes are 10 characters from a 31-letter alphabet (31^10 ≈ 8.2 × 10^14, above
 * the brief's 36^8 ≈ 2.8 × 10^12), drawn with crypto.getRandomValues.
 *
 * Everything read back is untrusted: snapshots are coerced field by field (`checkSnapshot`), reviews keep only a star
 * count, compliment ids from the fixed list and a nickname of ≤16 letters, digits and spaces. Nothing here feeds the
 * sim; wall-clock dates are UI metadata only.
 */
import type { DecorSlot, Difficulty, GameState, StaffRole } from "@full-plate/sim-core";
import { cleanName } from "@full-plate/sim-core/schema";
import { DECOR_SLOTS } from "../sim";
import { fnv1a, runtime } from "./saveStore";
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
export function newCode(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = "";
  while (out.length < CODE_LEN) {
    for (const b of rand(CODE_LEN * 2)) {
      if (b >= 248) continue; // 248 = 8 × 31: no bias
      out += CODE_ALPHABET[b % 31];
      if (out.length === CODE_LEN) break;
    }
  }
  return out;
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
export function checkSnapshot(raw: unknown, known: { dish(id: string): boolean; decor(id: string): boolean; district(id: string): boolean }): ShareSnapshot | null {
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
    })).filter((r) => r.text),
    week: arr(o.week, LIMITS.week).map(obj).map((d) => ({
      day: int(d.day, 0, 1e6), covers: int(d.covers, 0, 1e5), walkouts: int(d.walkouts, 0, 1e5),
      revenue: int(d.revenue, -1e9, 1e9), profit: int(d.profit, -1e9, 1e9), rating: num(d.rating, 0, 5), ...(d.closed === true ? { closed: true } : {}),
    })),
    ...(Object.keys(brand).length ? { brand } : {}),
  };
  return snap;
}

// ── reviews ──
export interface VisitReview { id: string; stars: number; picks: ComplimentId[]; nick: string; date: string; at: number }
export function checkReview(id: string, raw: unknown): VisitReview | null {
  const o = obj(raw);
  if (o.kind !== "fp-review") return null;
  const picks = [...new Set(arr(o.picks, MAX_PICKS * 2).filter((p): p is ComplimentId => typeof p === "string" && !!complimentText(p)))].slice(0, MAX_PICKS);
  return { id, stars: int(o.stars, 1, 5, 3), picks, nick: cleanNick(o.nick), date: typeof o.date === "string" && DATE.test(o.date) ? o.date : "", at: num(o.at, 0, 1e14) };
}
export const MAX_REVIEWS = 50;

// ── paths ──
export const snapPath = (code: string) => `fp-share/${code}/v/snap`;
export const reviewsPath = (code: string) => `fp-share/${code}/reviews`;
export const mePath = (uid: string) => `data/users/${uid}/r12/g/social`;
/** A stable, non-reversible id for this viewer on this share (the review's document id prefix). */
export const visitorKey = (uid: string, code: string): string => fnv1a(`visit:${uid}:${code}`);
export const ownerKey = (uid: string): string => fnv1a(`owner:${uid}`);
/** The game a share belongs to: the same restaurant across saves and devices (seed, street and name). */
export const gameKey = (g: Pick<GameState, "seed" | "districtId" | "restaurantName">): string => fnv1a(`${g.seed}|${g.districtId}|${g.restaurantName}`);

// ── my private record ──
export interface Me { shares: Record<string, string>; reviewed: Record<string, string> }
const ME_LOCAL = "full-plate:social:v1";
const MAX_ME = 60;
function readLocalMe(): Me {
  try {
    const o = obj(JSON.parse(prefsStorage().getItem(ME_LOCAL) ?? "{}"));
    return { shares: strMap(o.shares), reviewed: strMap(o.reviewed) };
  } catch { return { shares: {}, reviewed: {} }; }
}
function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(v)).slice(-MAX_ME)) if (typeof x === "string" && k.length <= 40) out[k] = x.slice(0, 40);
  return out;
}
const trimMap = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).slice(-MAX_ME));
export async function readMe(l: { db: SDb; uid: string }): Promise<Me> {
  const local = readLocalMe();
  try {
    const s = await l.db.doc(mePath(l.uid)).get();
    const d = obj(s.exists ? s.data() : {});
    return { shares: { ...local.shares, ...strMap(d.shares) }, reviewed: { ...local.reviewed, ...strMap(d.reviewed) } };
  } catch { return local; }
}
export async function writeMe(l: { db: SDb; uid: string }, me: Me): Promise<void> {
  const body = { kind: "fp-social", shares: trimMap(me.shares), reviewed: trimMap(me.reviewed) };
  try { prefsStorage().setItem(ME_LOCAL, JSON.stringify(body)); } catch { /* storage blocked */ }
  await l.db.doc(mePath(l.uid)).set(body);
}

// ── owner: share, re-share, stop ──
/** Share (or re-share, overwriting) this game's snapshot. Returns its code. */
export async function share(l: { db: SDb; uid: string }, game: GameState, opts: { now?: number; code?: () => string; brand?: Record<string, string | number> } = {}): Promise<string> {
  const me = await readMe(l);
  const key = gameKey(game);
  const code = me.shares[key] ?? (opts.code ?? newCode)();
  await l.db.doc(snapPath(code)).set({ ...buildSnapshot(game, opts.now, opts.brand), owner: ownerKey(l.uid) });
  if (me.shares[key] !== code) await writeMe(l, { ...me, shares: { ...me.shares, [key]: code } });
  return code;
}
/** This game's share code, if it is shared (from my private record; the snapshot may have been removed since). */
export async function sharedCode(l: { db: SDb; uid: string }, game: GameState): Promise<string | null> {
  const code = (await readMe(l)).shares[gameKey(game)];
  if (!code) return null;
  try { return (await l.db.doc(snapPath(code)).get()).exists ? code : null; } catch { return code; }
}
/** Stop sharing: the snapshot and its reviews go; the code is forgotten (a new share gets a new code). */
export async function stopSharing(l: { db: SDb; uid: string }, game: GameState): Promise<void> {
  const me = await readMe(l);
  const key = gameKey(game);
  const code = me.shares[key];
  if (!code) return;
  await l.db.doc(snapPath(code)).delete();
  try {
    const all = await l.db.collection(reviewsPath(code)).limit(200).get();
    for (const d of all.docs) await l.db.collection(reviewsPath(code)).doc(d.id).delete();
  } catch { /* reviews stay unreachable without the snapshot */ }
  const shares = { ...me.shares };
  delete shares[key];
  await writeMe(l, { ...me, shares });
}

/** The newest reviews (≤ 50), live. Pruning the older ones is the owner's job (`pruneReviews`). */
export function watchReviews(l: { db: SDb }, code: string, next: (r: VisitReview[]) => void, error?: (code: string) => void): () => void {
  return l.db.collection(reviewsPath(code)).orderBy("at", "desc").limit(MAX_REVIEWS).onSnapshot(
    (s) => next(s.docs.map((d) => checkReview(d.id, d.data())).filter((r): r is VisitReview => !!r)),
    (e) => error?.(e.code),
  );
}
/** Keep the newest 50 reviews: older ones are deleted (one at a time, as db.d.ts asks). */
export async function pruneReviews(l: { db: SDb }, code: string): Promise<number> {
  const all = await l.db.collection(reviewsPath(code)).orderBy("at", "desc").limit(200).get();
  const old = all.docs.slice(MAX_REVIEWS);
  for (const d of old) await l.db.collection(reviewsPath(code)).doc(d.id).delete();
  return old.length;
}

// ── visitor ──
export type Opened = { snap: ShareSnapshot; mine: boolean } | { missing: true };
export async function openShare(l: { db: SDb; uid: string }, code: string, known: Parameters<typeof checkSnapshot>[1]): Promise<Opened> {
  const s = await l.db.doc(snapPath(code)).get();
  const raw = s.exists ? s.data() : undefined;
  const snap = raw ? checkSnapshot(raw, known) : null;
  return snap ? { snap, mine: obj(raw).owner === ownerKey(l.uid) } : { missing: true };
}
/** Has this viewer reviewed this share today (from the private record and this device)? */
export async function reviewedToday(l: { db: SDb; uid: string }, code: string, now = Date.now()): Promise<boolean> {
  return (await readMe(l)).reviewed[code] === today(now);
}
export type ReviewResult = "sent" | "already" | "own" | "bad";
/** One review per visitor per share per day (client-side), stars 1–5 and up to three compliments from the list. */
export async function leaveReview(l: { db: SDb; uid: string }, code: string, r: { stars: number; picks: string[]; nick: string; mine?: boolean }, now = Date.now()): Promise<ReviewResult> {
  if (r.mine) return "own";
  const stars = Math.round(r.stars);
  if (!(stars >= 1 && stars <= 5)) return "bad";
  const picks = [...new Set(r.picks.filter((p) => !!complimentText(p)))].slice(0, MAX_PICKS);
  const me = await readMe(l);
  const date = today(now);
  if (me.reviewed[code] === date) return "already";
  const id = `${visitorKey(l.uid, code)}-${date.replace(/-/g, "")}`;
  await l.db.collection(reviewsPath(code)).doc(id).set({ kind: "fp-review", stars, picks, nick: cleanNick(r.nick), date, at: now });
  await writeMe(l, { ...me, reviewed: { ...me.reviewed, [code]: date } });
  return "sent";
}
