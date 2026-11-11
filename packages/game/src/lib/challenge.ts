/**
 * Round 12 (C): the daily challenge. One scenario per UTC calendar day — the date is the seed, so everyone playing on
 * the same day gets the same restaurant. A scenario is built by running the real sim from a fixed seed with one of
 * sim-core's scripted owners (`runStrategyDay`), then a few ordinary commands set the problem up (fire the team, put
 * the prices up, take the best dish off). Nothing here changes a sim rule: it only sends commands.
 *
 * The player then runs five days on Normal. The score is the goal + takings + reviews − losses; a six-character code
 * (date + score + checksum) can be read out or pasted and compared with someone else's. The run has its own save
 * (localStorage, packed like the slots) and never touches the six game slots.
 *
 * Lazy-only: imported by the Challenge screens' chunk, never from main-chunk code.
 */
import type { GameState } from "@full-plate/sim-core";
import { applyCommand, content, newGame, runStrategyDay, STRATEGIES } from "../sim";
import { CHALLENGE_DAYS, initialMeta, type ChallengeMeta, type PathMeta } from "../state/paths";
import { encodeSave } from "../state/save";
import { WEEKDAY_NAMES, weekdayIndex } from "./calendar";
import { formatPence } from "./format";
import { noteMarked } from "./onboardFlags";
import { prefsStorage } from "./storage";

// ── dates ──
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Days since 1970-01-01 (UTC) for a YYYY-MM-DD key. */
export function dayNumber(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / 86_400_000);
}
export const dateOfDayNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * Today's challenge date (UTC, so a family in one house shares it). Dev builds take `?challengeDate=YYYY-MM-DD` for
 * tests; the shipped game ignores it, so yesterday's and tomorrow's challenges can't be played.
 */
export function todayKey(now: Date = new Date(), search: string = typeof location !== "undefined" ? location.search : ""): string {
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(search).get("challengeDate");
    if (forced && DATE_RE.test(forced)) return forced;
  }
  return now.toISOString().slice(0, 10);
}

/** "Tue 10 Nov" for a date key. */
export function prettyDate(date: string): string {
  const d = new Date(dayNumber(date) * 86_400_000);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** FNV-1a, 32-bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ── templates ──
export type TemplateId = "rescue" | "rush" | "inspector" | "walkout" | "rival" | "festival";
export const TEMPLATE_ORDER: readonly TemplateId[] = ["rescue", "rush", "inspector", "walkout", "rival", "festival"];

const NAMES = ["The Copper Pan", "Salt & Crumb", "The Gravy Boat", "Little Larder", "Two Forks", "The Blue Kettle", "Hob & Nob", "The Corner Plate"];

export interface Scenario {
  date: string;
  template: TemplateId;
  title: string;
  /** One short line under the title. */
  kicker: string;
  seed: number;
  districtId: string;
  restaurantName: string;
  /** Sim day the five days start on. */
  startDay: number;
  /** Which of the five nights the inspector eats (inspector template only), 0–4. */
  inspectorNight: number;
}

/** Everything about a date's challenge that doesn't need the sim run. */
export function scenarioFor(date: string): Scenario {
  const dn = dayNumber(date);
  const h = hash32(`full-plate-challenge:${date}`);
  const template = TEMPLATE_ORDER[((dn % 6) + 6) % 6]!;
  const districts = content.districts;
  const seed = 100_000 + (h % 900_000);
  let startDay = 28 + ((h >>> 8) % 21);
  // Festival weekend: the five days run Thursday to Monday.
  if (template === "festival") while (weekdayIndex(startDay) !== 3) startDay++;
  const t = TEMPLATES[template];
  return {
    date, template, title: t.title, kicker: t.kicker, seed,
    districtId: districts[(h >>> 4) % districts.length]!.id,
    restaurantName: NAMES[(h >>> 12) % NAMES.length]!,
    startDay,
    inspectorNight: (h >>> 16) % CHALLENGE_DAYS,
  };
}

interface TemplateDef {
  title: string;
  kicker: string;
  /** The scripted owner who runs the place until the challenge starts. */
  strategy: "typical" | "cheap";
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  rescue: { title: "Rescue the café", kicker: "Prices too low, money leaking out", strategy: "cheap" },
  rush: { title: "Rush week", kicker: "Word got out. Everyone's coming", strategy: "typical" },
  inspector: { title: "Inspector due", kicker: "One night this week, a guide inspector eats here", strategy: "typical" },
  walkout: { title: "Staff walked out", kicker: "Half the team quit last night", strategy: "typical" },
  rival: { title: "New rival opened", kicker: "A shiny new place across the road", strategy: "typical" },
  festival: { title: "Festival weekend", kicker: "The town festival runs Friday to Sunday", strategy: "typical" },
};

// ── building ──
const recent = (g: GameState, days = 7) => g.history.filter((d) => !d.closed).slice(-days);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** The goal's target, fixed when the scenario is built (from the restaurant's last week). */
export function targetFor(s: Scenario, g: GameState): number {
  const wk = recent(g);
  const perDay = (f: (d: GameState["history"][number]) => number) => (wk.length ? sum(wk.map(f)) / wk.length : 0);
  switch (s.template) {
    case "rescue": return 10_000; // finish £100 up: the scripted owner loses money every week
    case "rush": return Math.max(150, Math.round((perDay((d) => d.covers) * CHALLENGE_DAYS * 1.2) / 10) * 10);
    case "inspector": return 4.4;
    case "walkout": return Math.max(100, Math.round((perDay((d) => d.covers) * CHALLENGE_DAYS * 0.95) / 10) * 10);
    case "rival": return Math.min(98, Math.round(g.reputation.popularity) + 3);
    case "festival": return Math.max(100_000, Math.round((perDay((d) => d.revenue) * CHALLENGE_DAYS * 1.25) / 5_000) * 5_000);
  }
}

/** Ordinary commands that set the problem up on the first morning. */
function setUp(s: Scenario, g0: GameState): GameState {
  let g = g0;
  const send = (cmd: Parameters<typeof applyCommand>[2]) => { g = applyCommand(content, g, cmd).state; };
  switch (s.template) {
    case "rescue": {
      // The best seller came off the menu last week (the supplier let them down) and nobody put it back.
      const best = [...g.menu].sort((a, b) => b.sold7d - a.sold7d)[0];
      if (best && g.menu.length > 3) send({ type: "REMOVE_MENU_ITEM", dishId: best.dishId });
      break;
    }
    case "walkout": {
      // Everyone but the first chef walked out.
      const keep = g.staff.find((x) => x.role === "chef");
      for (const st of [...g.staff]) if (st !== keep) send({ type: "FIRE", staffId: st.id });
      break;
    }
    case "rival":
      // Prices went up 20% the week the rival opened.
      for (const m of [...g.menu]) send({ type: "SET_MENU_ITEM", dishId: m.dishId, price: Math.round((m.price * 1.2) / 10) * 10 });
      break;
    case "festival":
      // Half the team booked the weekend off.
      g.staff.forEach((st, i) => { if (i % 2 === 1) send({ type: "SET_ROTA", staffId: st.id, rota: st.rota.map((on, d) => on && d < 5) }); });
      break;
    default: break;
  }
  return g;
}

export interface Built { game: GameState; meta: PathMeta; scenario: Scenario }

/**
 * Runs the scripted owner up to the start day (a few days per slice, so the page keeps painting), then sets the
 * problem up. Deterministic: the same date gives the same state on every device. A seed whose owner went bust first
 * (rare) moves on to the next one.
 */
export async function buildChallenge(date: string, onProgress?: (share: number) => void, yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))): Promise<Built> {
  const scenario = scenarioFor(date);
  const strat = STRATEGIES[TEMPLATES[scenario.template].strategy];
  for (let attempt = 0; attempt < 6; attempt++) {
    const seed = scenario.seed + attempt;
    let g = newGame(content, { type: "NEW_GAME", seed, districtId: scenario.districtId, restaurantName: scenario.restaurantName, difficulty: "normal" });
    while (g.day < scenario.startDay && g.phase !== "gameover") {
      for (let k = 0; k < 4 && g.day < scenario.startDay && g.phase !== "gameover"; k++) g = runStrategyDay(content, g, strat);
      onProgress?.(Math.min(1, g.day / scenario.startDay));
      await yieldFn();
    }
    if (g.phase !== "planning" || g.day !== scenario.startDay) continue;
    const target = targetFor(scenario, g);
    g = setUp(scenario, g);
    const challenge: ChallengeMeta = { date, startDay: g.day, startCash: g.cash, startPopularity: g.reputation.popularity, target };
    const meta: PathMeta = { ...initialMeta("owner"), lastPathDay: g.day - 1, challenge };
    return { game: g, meta, scenario: { ...scenario, seed } };
  }
  throw new Error("No challenge could be built for this date.");
}

// ── the goal ──
export interface GoalState {
  /** Short goal line ("£600 more in the bank by Monday"). */
  label: string;
  /** Where it stands now ("£214 so far"). */
  now: string;
  value: number;
  target: number;
  met: boolean;
  /** 0..1 towards the target. */
  share: number;
}

/** Days of the challenge played so far (closed days count, with no covers). */
export const playedDays = (g: GameState, c: ChallengeMeta) => g.history.filter((d) => d.day >= c.startDay && d.day < c.startDay + CHALLENGE_DAYS);

const lastDayName = (c: ChallengeMeta) => WEEKDAY_NAMES[weekdayIndex(c.startDay + CHALLENGE_DAYS - 1)]!;

/** The goal for this run, where it stands, and whether it's met. */
export function goalOf(g: GameState, c: ChallengeMeta): GoalState {
  const target = c.target;
  const sc = scenarioFor(c.date);
  const days = playedDays(g, c);
  const pounds = (p: number) => formatPence(p, { whole: true });
  switch (sc.template) {
    case "rescue": {
      const v = g.cash - c.startCash;
      // Partial credit from £1,500 down (where the scripted owner would be) up to the target.
      return { label: `Finish ${lastDayName(c)} at least ${pounds(target)} up on today`, now: `${v < 0 ? "Down" : "Up"} ${pounds(Math.abs(v))} so far`, value: v, target, met: v >= target, share: clamp01((v + 150_000) / (target + 150_000)) };
    }
    case "rush":
    case "walkout": {
      const v = sum(days.map((d) => d.covers));
      return { label: `Serve ${target} guests in five days`, now: `${v} so far`, value: v, target, met: v >= target, share: clamp01(v / target) };
    }
    case "inspector": {
      const night = days.find((d) => d.day === c.startDay + sc.inspectorNight);
      const v = night ? (night.covers ? night.averageRating : 0) : NaN;
      const nights = days.map((d) => (d.covers ? d.averageRating : 0));
      const worst = nights.length ? Math.min(...nights) : NaN;
      return {
        label: `Average ${target.toFixed(1)}★ or better on the inspector's night`,
        now: night ? `Inspector's night: ${v.toFixed(1)}★` : nights.length ? `Lowest night so far: ${worst.toFixed(1)}★` : "No nights yet",
        value: Number.isNaN(v) ? 0 : v, target, met: !Number.isNaN(v) && v >= target, share: Number.isNaN(v) ? 0 : clamp01(v / target),
      };
    }
    case "rival": {
      const v = Math.round(g.reputation.popularity);
      return { label: `Popularity ${target} or more by ${lastDayName(c)}`, now: `Popularity ${v} now`, value: v, target, met: v >= target, share: clamp01((v - (c.startPopularity - 10)) / (target - (c.startPopularity - 10))) };
    }
    case "festival": {
      const v = sum(days.map((d) => d.revenue));
      return { label: `${pounds(target)} takings, Thursday to Monday`, now: `${pounds(v)} so far`, value: v, target, met: v >= target, share: clamp01(v / target) };
    }
  }
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

// ── the score ──
export interface ScoreLine { label: string; points: number; note: string }
export interface Score { total: number; lines: ScoreLine[]; goal: GoalState; bust: boolean; days: number }

export const MAX_SCORE = 0x1ffff; // 131,071: what fits in the code

/**
 * Goal (1,000 if met, else up to 600 for how close) + takings (1 point per £5) + reviews (the guest-weighted average
 * rating × 100) − losses (1 point per £5 of food binned and incident costs, 10 per guest who walked out, 300 if the
 * bank closed it).
 */
export function scoreOf(g: GameState, c: ChallengeMeta): Score {
  const days = playedDays(g, c);
  const goal = goalOf(g, c);
  const bust = g.phase === "gameover";
  const revenue = sum(days.map((d) => d.revenue));
  const covers = sum(days.map((d) => d.covers));
  const rating = covers ? sum(days.map((d) => d.averageRating * d.covers)) / covers : 0;
  const binned = sum(days.map((d) => d.waste.prep + d.waste.plate + d.waste.spoil + (d.incidentCosts ?? 0)));
  const walkouts = sum(days.map((d) => d.walkouts));
  const goalPts = goal.met ? 1000 : Math.round(600 * goal.share);
  const lines: ScoreLine[] = [
    { label: "Goal", points: goalPts, note: goal.met ? "Done" : `${Math.round(goal.share * 100)}% of the way` },
    { label: "Takings", points: Math.round(revenue / 500), note: `${formatPence(revenue, { whole: true })} · 1 point per £5` },
    { label: "Reviews", points: Math.round(rating * 100), note: covers ? `${rating.toFixed(2)}★ across ${covers} guests` : "No guests" },
    { label: "Losses", points: -(Math.round(binned / 500) + walkouts * 10 + (bust ? 300 : 0)), note: `${formatPence(binned, { whole: true })} binned or fixing things · ${walkouts} walked out${bust ? " · the bank closed it" : ""}` },
  ];
  const total = Math.max(0, Math.min(MAX_SCORE, sum(lines.map((l) => l.points))));
  return { total, lines, goal, bust, days: days.length };
}

// ── the score code ──
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base 32: no I, L, O, U
const check7 = (d: number, score: number) => hash32(`${d}:${score}`) & 0x7f;

/** Six characters: the date (mod 64), the score (17 bits) and a 7-bit check. Shown as "ABC DEF". */
export function encodeScore(date: string, score: number): string {
  const d = dayNumber(date) & 63;
  const s = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
  let bits = d * 2 ** 24 + s * 2 ** 7 + check7(d, s);
  let out = "";
  for (let i = 0; i < 6; i++) { out = ALPHABET[bits % 32]! + out; bits = Math.floor(bits / 32); }
  return out;
}

export const prettyCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

export type Decoded = { ok: true; score: number; date: string } | { ok: false; why: string };

/**
 * Reads a code (any case, spaces and dashes ignored; I/L read as 1, O as 0). The date is the latest day on or before
 * `today` with the same residue, so a code from the last nine weeks names its day.
 */
export function decodeScore(raw: string, today: string): Decoded {
  const clean = raw.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length !== 6) return { ok: false, why: "A score code is six letters and numbers." };
  let bits = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return { ok: false, why: `“${ch}” isn't in a score code.` };
    bits = bits * 32 + v;
  }
  const d = Math.floor(bits / 2 ** 24) & 63;
  const score = Math.floor(bits / 2 ** 7) & MAX_SCORE;
  if ((bits & 0x7f) !== check7(d, score)) return { ok: false, why: "That code doesn't add up. Check each letter." };
  const t = dayNumber(today);
  const back = (((t & 63) - d) % 64 + 64) % 64;
  return { ok: true, score, date: dateOfDayNumber(t - back) };
}

// ── bests ──
export interface Best { date: string; score: number; template: TemplateId; met: boolean }
const BEST_KEY = "full-plate:challenge:v1:best";
const MIRROR = "full-plate:onboard:v1:challenge:";
const KEEP_DAYS = 120;

function readBests(): Record<string, Best> {
  try {
    const raw = JSON.parse(prefsStorage().getItem(BEST_KEY) ?? "{}") as Record<string, Best>;
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

/**
 * Every best this device knows: its own list, plus the ones mirrored through the account's prefs (onboarding-flag keys
 * `…:challenge:<date>:<score>`, which follow the account to other devices; prefsSync.ts).
 */
export function allBests(): Best[] {
  const out = readBests();
  try {
    const ls = prefsStorage();
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      const m = k?.startsWith(MIRROR) ? /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(k.slice(MIRROR.length)) : null;
      if (!m) continue;
      const date = m[1]!, score = Math.min(MAX_SCORE, +m[2]!);
      if (!out[date] || out[date]!.score < score) out[date] = { date, score, template: scenarioFor(date).template, met: out[date]?.met ?? false };
    }
  } catch { /* blocked */ }
  return Object.values(out).filter((b) => b && typeof b.score === "number" && DATE_RE.test(b.date));
}

export const bestFor = (date: string): Best | undefined => allBests().find((b) => b.date === date);
export const topBests = (n = 10): Best[] => [...allBests()].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, n);

/** Records a finished run. Returns true when it beat this date's best. A new top-five score is mirrored to the account. */
export function recordBest(b: Best): boolean {
  const prev = bestFor(b.date);
  if (prev && prev.score >= b.score) return false;
  const all = readBests();
  all[b.date] = b;
  const keep = Object.values(all).sort((x, y) => y.date.localeCompare(x.date)).slice(0, KEEP_DAYS);
  try { prefsStorage().setItem(BEST_KEY, JSON.stringify(Object.fromEntries(keep.map((x) => [x.date, x])))); } catch { /* blocked */ }
  if (topBests(5).some((x) => x.date === b.date && x.score === b.score)) {
    const k = `${MIRROR}${b.date}:${b.score}`;
    try { prefsStorage().setItem(k, "1"); } catch { /* blocked */ }
    noteMarked(k);
  }
  return true;
}

// ── the run's own save ──
export const RUN_KEY = "full-plate:challenge:v1:run";
export interface StoredRun { date: string; day: number; encoding: "gzip-b64" | "b64"; data: string }

export async function saveRun(game: GameState, meta: PathMeta): Promise<boolean> {
  if (!meta.challenge) return false;
  const { pack } = await import("../state/saveCodec");
  const packed = await pack(encodeSave(game, meta));
  const run: StoredRun = { date: meta.challenge.date, day: game.day - meta.challenge.startDay, ...packed };
  try { prefsStorage().setItem(RUN_KEY, JSON.stringify(run)); return true; } catch { return false; }
}

export function peekRun(): StoredRun | null {
  try {
    const r = JSON.parse(prefsStorage().getItem(RUN_KEY) ?? "null") as StoredRun | null;
    return r && typeof r.date === "string" && typeof r.data === "string" && (r.encoding === "gzip-b64" || r.encoding === "b64") ? r : null;
  } catch { return null; }
}

export function clearRun(): void { try { prefsStorage().removeItem(RUN_KEY); } catch { /* blocked */ } }

/** The stored run, unpacked and checked by the save schemas (state/saveCheck.ts). Null when it isn't usable. */
export async function loadRun(run: StoredRun): Promise<{ game: GameState; meta: PathMeta } | null> {
  try {
    const [{ unpack }, { checkedDecode }] = await Promise.all([import("../state/saveCodec"), import("../state/saveCheck")]);
    const l = checkedDecode(await unpack(run.encoding, run.data));
    return l.meta.challenge ? l : null;
  } catch { return null; }
}
