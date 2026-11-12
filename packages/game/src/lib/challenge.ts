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
import { applyCommand, careerContent, newGame, runStrategyDay, STRATEGIES } from "../sim";

/** Round 14 (G2): the pack a challenge is built on — the starter library (no path or invented dishes). */
const PACK = careerContent;
const FP_MASK = 0xff;
import { CHALLENGE_DAYS, initialMeta, type ChallengeMeta, type PathMeta } from "../state/paths";
import { encodeSave } from "../state/save";
import { WEEKDAY_NAMES, weekdayIndex } from "./calendar";
import { formatPence } from "./format";
import { noteMarked } from "./onboardFlags";
import { prefsStorage } from "./storage";
import {
  allBests, bestFor, BEST_KEY, CHALLENGE_VERSION, DATE_RE, dateOfDayNumber, dayNumber, MAX_SCORE, MIRROR, readBests, TEMPLATE_TITLES,
  templateForDate, topBests, type Best, type TemplateId,
} from "./challengeToday";
export { CHALLENGE_VERSION };

// ── dates ── (lib/challengeToday.ts)
export { dateOfDayNumber, dayNumber, todayKey } from "./challengeToday";
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
export { TEMPLATE_ORDER, type TemplateId } from "./challengeToday";

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
  /** Which of the five nights the inspector eats (inspector template only): 3 or 4 (night 4 or 5). */
  inspectorNight: number;
}

/**
 * Everything about a date's challenge that doesn't need the sim run. `template` overrides the day's own (the headless
 * fairness test plays every template on every date; the game never passes it).
 */
export function scenarioFor(date: string, template?: TemplateId): Scenario {
  const h = hash32(`full-plate-challenge:${date}`);
  const tid = template ?? templateForDate(date);
  const districts = PACK.districts;
  const seed = 100_000 + (h % 900_000);
  let startDay = 28 + ((h >>> 8) % 21);
  // Festival weekend: the five days run Thursday to Monday.
  if (tid === "festival") while (weekdayIndex(startDay) !== 3) startDay++;
  const t = TEMPLATES[tid];
  return {
    date, template: tid, title: t.title, kicker: t.kicker, seed,
    districtId: districts[(h >>> 4) % districts.length]!.id,
    restaurantName: NAMES[(h >>> 12) % NAMES.length]!,
    startDay,
    // Round 14 (U8): night 4 or 5, so a kitchen left to run out can't pass it.
    inspectorNight: CHALLENGE_DAYS - 2 + ((h >>> 16) % 2),
  };
}

/** The template a run is playing (stored since Round 14; earlier runs take the date's). */
export const templateOf = (c: ChallengeMeta): TemplateId => c.template ?? scenarioFor(c.date).template;

interface TemplateDef {
  title: string;
  kicker: string;
  /** The scripted owner who runs the place until the challenge starts. */
  strategy: "typical" | "cheap";
  /** Round 14 (G7): extra people in town for the five days (an ordinary footfall modifier, like an event's). */
  footfall?: number;
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  rescue: { title: TEMPLATE_TITLES.rescue, kicker: "Prices too low, money leaking out", strategy: "cheap" },
  rush: { title: TEMPLATE_TITLES.rush, kicker: "Word got out: half as many people again are heading your way", strategy: "typical", footfall: 1.5 },
  inspector: { title: TEMPLATE_TITLES.inspector, kicker: "One night this week, a guide inspector eats here", strategy: "typical" },
  walkout: { title: TEMPLATE_TITLES.walkout, kicker: "Half the team quit last night", strategy: "typical" },
  rival: { title: TEMPLATE_TITLES.rival, kicker: "A shiny new place across the road", strategy: "typical" },
  festival: { title: TEMPLATE_TITLES.festival, kicker: "The town festival fills the streets, Thursday to Monday", strategy: "typical", footfall: 1.3 },
};

// ── building ──
const recent = (g: GameState, days = 7) => g.history.filter((d) => !d.closed).slice(-days);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const perDayOf = (g: GameState, f: (d: GameState["history"][number]) => number) => {
  const wk = recent(g);
  return wk.length ? sum(wk.map(f)) / wk.length : 0;
};

/** The goal's numbers, fixed when the scenario is built (from the restaurant's last week). `guests` is the second part of a two-part goal. */
export function targetFor(s: Scenario, g: GameState): { target: number; guests?: number; prev?: number } {
  const perDay = (f: (d: GameState["history"][number]) => number) => perDayOf(g, f);
  const covers5 = perDay((d) => d.covers) * CHALLENGE_DAYS;
  const tens = (x: number) => Math.round(x / 10) * 10;
  switch (s.template) {
    case "rescue": {
      // The last five days' profit (the cheap owner's, before the best seller came off), plus a margin.
      const prev = sum(g.history.slice(-CHALLENGE_DAYS).map((d) => d.profit));
      return { target: Math.floor((prev + TUNE.rescue) / 1_000) * 1_000, prev };
    }
    case "rush": return { target: Math.max(150, tens(covers5 * TUNE.rush)) };
    case "inspector": {
      // The same night of the week, a week before (else the week's average night).
      const night = s.startDay + s.inspectorNight;
      const wk = g.history.find((d) => d.day === night - 7 && !d.closed && d.covers > 0);
      const rating = wk ? wk.averageRating : perDay((d) => d.averageRating);
      const covers = wk ? wk.covers : perDay((d) => d.covers);
      return { target: Math.min(TUNE.inspectorMax, Math.max(3, Math.round((rating - TUNE.inspectorSlack) * 10) / 10)), guests: Math.max(20, Math.round(covers * TUNE.inspectorGuests)) };
    }
    case "walkout": return { target: Math.max(100, tens(covers5 * TUNE.walkout)) };
    case "rival": return { target: Math.min(98, Math.round(g.reputation.popularity) + TUNE.rival), guests: Math.max(100, tens(covers5 * TUNE.rivalGuests)) };
    case "festival": return { target: Math.max(100_000, Math.round((perDay((d) => d.revenue) * CHALLENGE_DAYS * TUNE.festival) / 5_000) * 5_000) };
  }
}
export const TUNE = {
  rescue: 5_000, rush: 1.05, inspectorSlack: 0.3, inspectorMax: 4.6, inspectorGuests: 0.8, walkout: 0.9, rival: -4, rivalGuests: 0.85,
  festival: 1.1, rivalPrice: 1.3, rivalFootfall: 0.85,
};

/**
 * Round 14 (G6): the most a guest's bill counts for in the score: 1.5× what a guest spent here last week, so prices at
 * the stepper's cap can't buy points. Rounded to 50p.
 */
export function fairSpendOf(g: GameState): number {
  const spend = perDayOf(g, (d) => d.revenue) / Math.max(1, perDayOf(g, (d) => d.covers));
  return Math.max(1_000, Math.round((spend * 1.5) / 50) * 50);
}

/** Ordinary commands that set the problem up on the first morning. */
function setUp(s: Scenario, g0: GameState): GameState {
  let g = g0;
  const send = (cmd: Parameters<typeof applyCommand>[2]) => { g = applyCommand(PACK, g, cmd).state; };
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
      // Prices went up the week the rival opened.
      for (const m of [...g.menu]) send({ type: "SET_MENU_ITEM", dishId: m.dishId, price: Math.round((m.price * TUNE.rivalPrice) / 10) * 10 });
      break;
    case "festival":
      // Half the team booked the weekend off.
      g.staff.forEach((st, i) => { if (i % 2 === 1) send({ type: "SET_ROTA", staffId: st.id, rota: st.rota.map((on, d) => on && d < 5) }); });
      break;
    default: break;
  }
  // Round 14 (G6): the bank's once-only "first wage" loan is spent already, so firing everyone to borrow it isn't a move.
  g = { ...g, starterLoan: true };
  const boost = s.template === "rival" ? TUNE.rivalFootfall : TEMPLATES[s.template].footfall;
  // An ordinary footfall modifier (sim-core FootfallMod, as an event adds): it ticks down each morning and is gone after the fifth day.
  if (boost) g = { ...g, footfallMods: [...g.footfallMods.filter((m) => m.source !== "challenge"), { mult: boost, daysRemaining: CHALLENGE_DAYS, source: "challenge" }] };
  return g;
}

/**
 * Round 14 (S14-6): a short fingerprint of the built starting state — the numbers only (the RNG, money, people, stock,
 * menu, reputation), never text a setting can reword. Two players whose fingerprints differ were given different
 * restaurants (a different build, or an engine that rounds the sim's maths differently), so their scores aren't compared.
 */
export function fingerprintOf(g: GameState): number {
  const pick = {
    seed: g.seed, rng: g.rngState, day: g.day, cash: g.cash, loan: g.loan, rep: g.reputation, menu: g.menu, staff: g.staff, tables: g.tables,
    stock: g.stock, orders: g.orders, mods: g.footfallMods, stats: g.stats, distress: g.distressDays ?? 0,
  };
  return hash32(JSON.stringify(pick)) & FP_MASK;
}

export interface Built { game: GameState; meta: PathMeta; scenario: Scenario }

/**
 * Runs the scripted owner up to the start day (a few days per slice, so the page keeps painting), then sets the
 * problem up. Deterministic: the same date gives the same state on every device. A seed whose owner went bust first
 * (rare) moves on to the next one. Round 14 (G2): it runs on the starter-library pack, so no path-only dish (`fd_`,
 * `ff_`) or invented dish from another game can reach the menu.
 */
export async function buildChallenge(
  date: string, onProgress?: (share: number) => void, yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
  opts: { template?: TemplateId } = {},
): Promise<Built> {
  const scenario = scenarioFor(date, opts.template);
  const strat = STRATEGIES[TEMPLATES[scenario.template].strategy];
  for (let attempt = 0; attempt < 6; attempt++) {
    const seed = scenario.seed + attempt;
    let g = newGame(PACK, { type: "NEW_GAME", seed, districtId: scenario.districtId, restaurantName: scenario.restaurantName, difficulty: "normal" });
    while (g.day < scenario.startDay && g.phase !== "gameover") {
      for (let k = 0; k < 4 && g.day < scenario.startDay && g.phase !== "gameover"; k++) g = runStrategyDay(PACK, g, strat);
      onProgress?.(Math.min(1, g.day / scenario.startDay));
      await yieldFn();
    }
    if (g.phase !== "planning" || g.day !== scenario.startDay) continue;
    const { target, guests, prev } = targetFor(scenario, g);
    const fair = fairSpendOf(g);
    g = setUp(scenario, g);
    const challenge: ChallengeMeta = {
      date, startDay: g.day, startCash: g.cash, startPopularity: g.reputation.popularity, target,
      v: CHALLENGE_VERSION, template: scenario.template, fair, loan0: g.loan.principal, fp: fingerprintOf(g), ...(guests !== undefined ? { guests } : {}), ...(prev !== undefined ? { prev } : {}),
    };
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
  const template = templateOf(c);
  const sc = scenarioFor(c.date, template);
  const days = playedDays(g, c);
  const pounds = (p: number) => formatPence(p, { whole: true });
  switch (template) {
    case "rescue": {
      // Round 14 (G6): the five days' own profit (takings less every cost), so money borrowed from the bank isn't
      // "made"; each bill counts up to the score's cap, so prices at the stepper's top can't buy it either.
      const fair = c.fair ?? FAIR_FALLBACK;
      const v = sum(days.map((d) => d.profit - Math.max(0, d.revenue - d.covers * fair)));
      const label = target > 0
        ? `Make at least ${pounds(target)} profit by ${lastDayName(c)}`
        : target === 0 ? `Finish ${lastDayName(c)} without having lost money`
        : `Lose less than ${pounds(-target)} by ${lastDayName(c)}${c.prev !== undefined && c.prev < 0 ? ` (the last five days lost ${pounds(-c.prev)})` : ""}`;
      const span = Math.max(50_000, Math.abs(target) + 100_000);
      return { label, now: `${v < 0 ? "Down" : "Profit"} ${pounds(Math.abs(v))} so far`, value: v, target, met: days.length > 0 && v >= target, share: clamp01((v - (target - span)) / span) };
    }
    case "rush":
    case "walkout": {
      const v = sum(days.map((d) => d.covers));
      return { label: `Serve ${target} guests in five days`, now: `${v} so far`, value: v, target, met: v >= target, share: clamp01(v / target) };
    }
    case "inspector": {
      // Round 14 (U8): the inspector wants a good night in a busy room, so a kitchen that ran out (or priced everyone
      // away) doesn't pass on a handful of happy guests.
      const need = c.guests ?? 0;
      const night = days.find((d) => d.day === c.startDay + sc.inspectorNight);
      const v = night ? (night.covers ? night.averageRating : 0) : NaN;
      const fed = night?.covers ?? 0;
      const met = !!night && v >= target && fed >= need;
      const share = night ? Math.min(clamp01(v / target), clamp01(fed / Math.max(1, need))) : 0;
      return {
        label: `On the inspector's night: ${target.toFixed(1)}★ or better from at least ${need} guests`,
        now: night ? `Inspector's night: ${v.toFixed(1)}★ from ${fed} guests` : days.length ? `${days.length} of ${CHALLENGE_DAYS} nights done` : "No nights yet",
        value: Number.isNaN(v) ? 0 : v, target, met, share,
      };
    }
    case "rival": {
      const need = c.guests ?? 0;
      const v = Math.round(g.reputation.popularity);
      const fed = sum(days.map((d) => d.covers));
      const lo = c.startPopularity - 10;
      return {
        label: `Popularity ${target} or more by ${lastDayName(c)}, with at least ${need} guests served`,
        now: `Popularity ${v}, ${fed} guests`, value: v, target, met: v >= target && fed >= need && days.length > 0,
        share: Math.min(clamp01((v - lo) / (target - lo)), clamp01(fed / Math.max(1, need))),
      };
    }
    case "festival": {
      const v = sum(days.map((d) => d.revenue));
      return { label: `${pounds(target)} takings, Thursday to Monday`, now: `${pounds(v)} so far`, value: v, target, met: v >= target, share: clamp01(v / target) };
    }
  }
}

/**
 * Round 14 (U8): one plain line on why a missed goal was missed — the bank, days shut, prices that sent people away, a
 * kitchen that ran out of food, then the goal's own shortfall. Null when the goal was met.
 */
export function whyMissed(g: GameState, c: ChallengeMeta): string | null {
  const goal = goalOf(g, c);
  if (goal.met) return null;
  const days = playedDays(g, c);
  const pounds = (p: number) => formatPence(p, { whole: true });
  if (g.phase === "gameover") return "The bank closed it: the money ran out.";
  const shut = days.filter((d) => d.closed).length;
  if (shut >= 2) return `It was shut on ${shut} of the five days, and a shut day serves nobody.`;
  const priced = g.menu.map((m) => ({ m, d: PACK.dishes.find((x) => x.id === m.dishId) })).filter((x) => x.d);
  const priceRatio = priced.length ? sum(priced.map((x) => x.m.price / x.d!.suggestedPrice)) / priced.length : 1;
  if (priceRatio > 1.6) return "Prices were so far above the menu's suggested ones that most people walked past.";
  const pre = g.history.filter((d) => d.day < c.startDay && !d.closed).slice(-7);
  const usual = pre.length ? sum(pre.map((d) => d.covers)) / pre.length : 0;
  const empty = days.find((d) => !d.closed && d.covers < usual * 0.4);
  if (empty) {
    return `From day ${empty.day - c.startDay + 1} the room was nearly empty: the kitchen had run out of food. Tap Restock for tomorrow each evening so the morning delivery covers the next day.`;
  }
  const template = templateOf(c);
  const need = c.guests ?? 0;
  switch (template) {
    case "rescue": return `The five days ${goal.value < 0 ? `lost ${pounds(-goal.value)}` : `made ${pounds(goal.value)}`}: not enough. Compare prices with the suggested ones, and check who's on the rota each day.`;
    case "rush":
    case "walkout":
    case "festival": return `${goal.now.replace(/ so far$/, "")}, short of the goal. More hands on the rota, more tables or more stock would have let more people in.`;
    case "inspector": {
      const night = days.find((d) => d.day === c.startDay + scenarioFor(c.date, template).inspectorNight);
      if (night && night.covers < need) return `Only ${night.covers} guests on the inspector's night (they wanted at least ${need}).`;
      return `The inspector's night averaged ${(night?.averageRating ?? 0).toFixed(1)}★ (they wanted ${c.target.toFixed(1)}★): guests waited too long or the food wasn't up to it. More hands that night help.`;
    }
    case "rival": {
      const fed = sum(days.map((d) => d.covers));
      if (fed < need) return `Only ${fed} guests came (the goal was ${need}): prices still too high, or too few hands to serve them.`;
      return `Popularity slid to ${Math.round(g.reputation.popularity)}: rushed or let-down guests don't come back. Keep the stars up as well as the room full.`;
    }
  }
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

// ── the score ──
export interface ScoreLine { label: string; points: number; note: string }
export interface Score { total: number; lines: ScoreLine[]; goal: GoalState; bust: boolean; days: number }

export { MAX_SCORE }; // 131,071: what fits in the code
/** Points per guest served (Round 14, G6: guests count as well as money, so prices at the cap don't pay). */
export const GUEST_POINTS = 2;
/** A bill counts for at most this much when ChallengeMeta.fair is missing (runs built before Round 14). */
const FAIR_FALLBACK = 3_000;

/**
 * Goal (1,000 if met, else up to 600 for how close) + guests (2 each) + takings (1 point per £5, each guest's bill
 * counted up to `fair`) + reviews (the guest-weighted average rating × 100) − losses (1 point per £5 of food binned
 * and incident costs and of money borrowed during the run, 10 per guest who walked out, 300 if the bank closed it).
 */
export function scoreOf(g: GameState, c: ChallengeMeta): Score {
  const days = playedDays(g, c);
  const goal = goalOf(g, c);
  const bust = g.phase === "gameover";
  const fair = c.fair ?? FAIR_FALLBACK;
  const revenue = sum(days.map((d) => d.revenue));
  const counted = sum(days.map((d) => Math.min(d.revenue, d.covers * fair)));
  const covers = sum(days.map((d) => d.covers));
  const rating = covers ? sum(days.map((d) => d.averageRating * d.covers)) / covers : 0;
  const binned = sum(days.map((d) => d.waste.prep + d.waste.plate + d.waste.spoil + (d.incidentCosts ?? 0)));
  const walkouts = sum(days.map((d) => d.walkouts));
  // Round 14 (G6): money borrowed during the run (the bank's starter loan) is a loss, not a way to buy points.
  const borrowed = Math.max(0, g.loan.principal - (c.loan0 ?? g.loan.principal));
  const goalPts = goal.met ? 1000 : Math.round(600 * goal.share);
  const capped = counted < revenue;
  const lines: ScoreLine[] = [
    { label: "Goal", points: goalPts, note: goal.met ? "Done" : `${Math.round(goal.share * 100)}% of the way` },
    { label: "Guests", points: covers * GUEST_POINTS, note: `${covers} served · ${GUEST_POINTS} points each` },
    { label: "Takings", points: Math.round(counted / 500), note: `${formatPence(counted, { whole: true })} · 1 point per £5${capped ? `, bills counted up to ${formatPence(fair, { whole: true })} a guest` : ""}` },
    { label: "Reviews", points: Math.round(rating * 100), note: covers ? `${rating.toFixed(2)}★ across ${covers} guests` : "No guests" },
    {
      label: "Losses", points: -(Math.round((binned + borrowed) / 500) + walkouts * 10 + (bust ? 300 : 0)),
      note: `${formatPence(binned, { whole: true })} binned or fixing things${borrowed ? ` · ${formatPence(borrowed, { whole: true })} borrowed` : ""} · ${walkouts} walked out${bust ? " · the bank closed it" : ""}`,
    },
  ];
  const total = Math.max(0, Math.min(MAX_SCORE, sum(lines.map((l) => l.points))));
  return { total, lines, goal, bust, days: days.length };
}

// ── the score code ──
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base 32: no I, L, O, U
/** Round 14: the code's own format number (2 bits). Round 12–13 codes had six characters and no number. */
export const CODE_VERSION = 1;
export const CODE_LENGTH = 8;
const check7 = (v: number, d: number, score: number, fp: number) => hash32(`${v}:${d}:${score}:${fp}`) & 0x7f;

/**
 * Eight characters (40 bits): the code's version (2), the date (mod 64, 6), the score (17), the scenario's fingerprint
 * (8, `fingerprintOf`) and a 7-bit check. Shown as "ABCD EFGH". The check catches a mistyped letter; it is not a secret.
 */
export function encodeScore(date: string, score: number, fp = 0): string {
  const d = dayNumber(date) & 63;
  const s = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
  const f = fp & FP_MASK;
  let bits = ((CODE_VERSION * 64 + d) * 2 ** 17 + s) * 2 ** 15 + f * 2 ** 7 + check7(CODE_VERSION, d, s, f);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) { out = ALPHABET[bits % 32]! + out; bits = Math.floor(bits / 32); }
  return out;
}

export const prettyCode = (code: string): string => `${code.slice(0, 4)} ${code.slice(4)}`;

export type Decoded = { ok: true; score: number; date: string; fp: number } | { ok: false; why: string };

/**
 * Reads a code (any case, spaces and dashes ignored; I/L read as 1, O as 0). The date is the latest day on or before
 * `today` with the same residue, so a code from the last nine weeks names its day. `ceiling` (the most the code's own
 * day can score, `ceilingOf`) refuses a score nobody could have made.
 */
export function decodeScore(raw: string, today: string, ceiling?: { date: string; max: number }): Decoded {
  const clean = raw.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length === 6 && [...clean].every((ch) => ALPHABET.includes(ch))) {
    return { ok: false, why: "That's an old six-letter code, from before the daily challenge changed. Old codes can't be compared." };
  }
  if (clean.length !== CODE_LENGTH) return { ok: false, why: "A score code is eight letters and numbers." };
  let bits = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return { ok: false, why: `“${ch}” isn't in a score code.` };
    bits = bits * 32 + v;
  }
  const check = bits % 2 ** 7;
  const fp = Math.floor(bits / 2 ** 7) % 2 ** 8;
  const score = Math.floor(bits / 2 ** 15) % 2 ** 17;
  const d = Math.floor(bits / 2 ** 32) % 64;
  const v = Math.floor(bits / 2 ** 38);
  if (check !== check7(v, d, score, fp)) return { ok: false, why: "That code doesn't add up. Check each letter." };
  if (v !== CODE_VERSION) return { ok: false, why: "That code comes from a different version of the game, so it can't be compared." };
  const t = dayNumber(today);
  const back = (((t & 63) - d) % 64 + 64) % 64;
  const date = dateOfDayNumber(t - back);
  if (ceiling && ceiling.date === date && score > ceiling.max) {
    return { ok: false, why: `That score is more than today's challenge can give (${ceiling.max.toLocaleString("en-GB")} at the very most). Check the code.` };
  }
  return { ok: true, score, date, fp };
}

/** Busiest possible service: every table the room can hold, full, turned this many times. Far above anything played. */
const TURNS_BOUND = 12;

/**
 * Round 14 (S14-6): the most a run of this scenario could score — the goal, 5★ reviews, and every seat the room could
 * ever hold filled for five days with each bill counted at the cap. A code above it can't be real.
 */
export function ceilingOf(c: ChallengeMeta): number {
  const b = PACK.balance;
  const guests = b.maxTables * b.seatsPerTable * TURNS_BOUND * CHALLENGE_DAYS;
  const fair = c.fair ?? FAIR_FALLBACK;
  return Math.min(MAX_SCORE, 1000 + 500 + Math.ceil(guests * (GUEST_POINTS + fair / 500)));
}

// ── bests ── (reading them: lib/challengeToday.ts)
export { allBests, bestFor, topBests, type Best } from "./challengeToday";
const KEEP_DAYS = 120;

/** Records a finished run. Returns true when it beat this date's best. A new top-five score is mirrored to the account. */
export function recordBest(b0: Best): boolean {
  const b: Best = { ...b0, v: CHALLENGE_VERSION };
  const prev = bestFor(b.date);
  if (prev && prev.score >= b.score) return false;
  const all = readBests();
  all[b.date] = b;
  const keep = Object.values(all).sort((x, y) => y.date.localeCompare(x.date)).slice(0, KEEP_DAYS);
  try { prefsStorage().setItem(BEST_KEY, JSON.stringify(Object.fromEntries(keep.map((x) => [x.date, x])))); } catch { /* blocked */ }
  if (topBests(5).some((x) => x.date === b.date && x.score === b.score)) {
    const k = `${MIRROR}${b.date}:${b.score}:${CHALLENGE_VERSION}`;
    try { prefsStorage().setItem(k, "1"); } catch { /* blocked */ }
    noteMarked(k);
  }
  return true;
}

// ── the run's own save ──
export const RUN_KEY = "full-plate:challenge:v1:run";
export interface StoredRun { date: string; day: number; encoding: "gzip-b64" | "b64"; data: string }

/** Round 14: bumped by clearRun, so a save still packing when the run ended (the bar's last autosave) isn't written back. */
let runGen = 0;
export async function saveRun(game: GameState, meta: PathMeta): Promise<boolean> {
  if (!meta.challenge) return false;
  const gen = runGen;
  const { pack } = await import("../state/saveCodec");
  const packed = await pack(encodeSave(game, meta));
  if (gen !== runGen) return false;
  const run: StoredRun = { date: meta.challenge.date, day: game.day - meta.challenge.startDay, ...packed };
  try { prefsStorage().setItem(RUN_KEY, JSON.stringify(run)); return true; } catch { return false; }
}

export function peekRun(): StoredRun | null {
  try {
    const r = JSON.parse(prefsStorage().getItem(RUN_KEY) ?? "null") as StoredRun | null;
    return r && typeof r.date === "string" && typeof r.data === "string" && (r.encoding === "gzip-b64" || r.encoding === "b64") ? r : null;
  } catch { return null; }
}

export function clearRun(): void { runGen++; try { prefsStorage().removeItem(RUN_KEY); } catch { /* blocked */ } }

/** The stored run, unpacked and checked by the save schemas (state/saveCheck.ts). Null when it isn't usable. */
export async function loadRun(run: StoredRun): Promise<{ game: GameState; meta: PathMeta } | null> {
  try {
    const [{ unpack }, { checkedDecode }] = await Promise.all([import("../state/saveCodec"), import("../state/saveCheck")]);
    const l = checkedDecode(await unpack(run.encoding, run.data));
    return l.meta.challenge ? l : null;
  } catch { return null; }
}
