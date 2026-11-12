/**
 * Round 3: everything that sits beside the sim-core GameState. The career (employee start), the two paths chosen at
 * the fork (Empire / Stars), the fork story beat itself, and win/ending state. Pure helpers only; the reducer
 * (gameReducer.ts) owns the transitions.
 */
import type { CareerEvent, CareerState, HandoverSummary, OwnerPerks } from "@full-plate/sim-career";
import type { EmpireEvent, EmpireState, ParkedSite } from "@full-plate/sim-empire";
import type { GuideResult, InspectorVisit, StarsEvent, StarsState } from "@full-plate/sim-stars";
import type { ShiftSummary, HandsOnResult, HandsOnRole, StationPlan } from "@full-plate/handson";
import type { Command, DayResult, GameState } from "@full-plate/sim-core";
import { asCommand } from "../sim";
import type { PathKind } from "../lib/library";
import type { CustomDish } from "../lib/customDish";

export type GameMode = "owner" | "career";

// ── the fork ──
/** Year 2 starts here (the brief: "at the start of in-game year 2"). */
export const FORK_DAY = 365;
/**
 * Round 12 (C): a Quick-year game (new-game option) offers the fork from day 120 instead (PathMeta.forkDay). The fork
 * is game-side state, so nothing in the sims changes: unset, every rule below reads 365 exactly as before.
 */
export const QUICK_FORK_DAY = 120;
/** The first day the fork can be offered in this game. */
export const forkDayOf = (meta: { forkDay?: number | undefined }): number => meta.forkDay ?? FORK_DAY;
export const FORK_POPULARITY = 60;
export const FORK_PROFIT_DAYS = 90;
/** "Think about it" brings the card back a week later. */
export const FORK_SNOOZE_DAYS = 7;

export interface ForkMeta {
  /** The story card is showing tonight. */
  offered: boolean;
  /** First evening the card appeared. */
  firstOfferDay?: number;
  /** "Think about it": no card before this day. */
  snoozeUntil?: number;
  chosen?: PathKind;
  chosenDay?: number;
}

export const profitableDays = (history: readonly DayResult[]): number => history.filter((d) => d.profit > 0).length;

/** Days of recent trading that must add up to a profit before the consultant and the critic call. */
export const FORK_RECENT_DAYS = 28;

/**
 * The milestone that unlocks the fork: popular enough or a proven earner, **and** the last four weeks made money
 * (round 3 review: every surviving owner cleared the old bar by day 365, including one with £83 in the bank who was
 * then told "your numbers are good"). `missing` says what to work on, for the evening hint.
 */
export function forkMilestone(game: GameState, forkDay: number = FORK_DAY): { met: boolean; popularity: number; profitDays: number; recentProfit: number; missing?: string } {
  const popularity = game.reputation.popularity;
  const profitDays = profitableDays(game.history);
  const recentProfit = game.history.slice(-FORK_RECENT_DAYS).reduce((a, d) => a + d.profit, 0);
  // Round 12 (C): a quick year asks for the same share of profitable days (90 of 365 → 30 of 120).
  const needDays = Math.round((FORK_PROFIT_DAYS * forkDay) / FORK_DAY);
  const known = popularity >= FORK_POPULARITY || profitDays >= needDays;
  const met = known && recentProfit > 0;
  const missing = met ? undefined
    : !known ? `get popularity to ${FORK_POPULARITY} (now ${Math.round(popularity)}) or reach ${needDays} profitable days (now ${profitDays})`
    : "make a profit over the last four weeks";
  return { met, popularity, profitDays, recentProfit, ...(missing ? { missing } : {}) };
}

/** Should tonight's evening show the fork story card? (`game` is the evening state; game.day is the day just played.) */
export function forkDue(game: GameState, fork: ForkMeta, mode: GameMode, forkDay: number = FORK_DAY): boolean {
  if (mode !== "owner" || fork.chosen || game.phase === "gameover") return false;
  if (game.day < forkDay) return false;
  if (fork.snoozeUntil !== undefined && game.day < fork.snoozeUntil) return false;
  return forkMilestone(game, forkDay).met;
}

// ── endings ──
export type EndingKind = "empire_meals" | "empire_regions" | "dynasty" | "el_bulli" | "handed_back";
export interface WinMeta {
  kind: EndingKind;
  won: boolean;
  day: number;
  title: string;
  text: string[];
  /** The player chose "keep playing". */
  dismissed?: boolean;
}

// ── hands-on ──
export interface HandsOnMeta {
  role: HandsOnRole;
  /** Owner "Jump in" (open-ended) vs the employee's whole shift. */
  jumpIn: boolean;
  /** Round 4: a career chef's commis station (set by the reducer at handsOnStart; also sent to SET_HANDS_ON). */
  station?: StationPlan;
}

/** Hands-on results → the round-3 sim-core commands (HANDSON-NOTES "Proposed sim-core commands"). */
export function handsOnCommands(results: readonly HandsOnResult[]): Command[] {
  const out: Command[] = [];
  for (const r of results) {
    switch (r.type) {
      case "PLATE_COOKED": out.push(asCommand({ type: "PLAYER_COOKED", ticketId: r.ticketId, quality: Math.round(r.quality) })); break;
      case "TABLE_SERVED": out.push(asCommand({ type: "PLAYER_SERVED", customerId: r.customerId, ticketId: r.ticketId, speedBonus: r.speedBonus })); break;
      case "TABLE_CLEARED": out.push(asCommand({ type: "PLAYER_CLEARED", tableId: r.tableId })); break;
      case "TICKET_CLAIMED": out.push({ type: "PLAYER_CLAIMED", ticketId: r.ticketId }); break;
      case "PAYMENT_TAKEN": out.push(asCommand({ type: "PLAYER_TOOK_PAYMENT", customerId: r.customerId })); break;
      case "DROPPED": out.push(asCommand({ type: "PLAYER_DROPPED", ticketIds: [...(r.ticketIds ?? [])], cost: Math.round(r.cost) })); break;
    }
  }
  return out;
}

/** The hands-on role an employee plays, or undefined for roles with no floor verbs (managers watch). */
export function handsOnRoleFor(simRole: string): HandsOnRole | undefined {
  return simRole === "chef" || simRole === "server" || simRole === "bar" ? simRole : undefined;
}

// ── the whole side-car ──
export interface PathMeta {
  mode: GameMode;
  /** Career start: the employee's career (the employer's GameState is AppState.game). */
  career?: CareerState;
  /** Career events since the last morning (review, payslip, promotion, offers). */
  careerEvents: CareerEvent[];
  /** The AI owner's evening commands for the employer (stock + END_DAY / event answer), applied on "Next day". */
  ownerCommands: Command[];
  /** The owner's planning commands this morning (shown as "Pat changed the rota"). */
  ownerMorning: Command[];
  /** Handover perks for the player's own restaurant (hire rebates). */
  ownerPerks?: OwnerPerks;
  /** Set right after "Open my own place": the summary modal shows it once. */
  handover?: HandoverSummary;
  handoverSeen?: boolean;

  fork: ForkMeta;
  empire?: EmpireState;
  /** Recent empire events, newest last (≤ 80). */
  empireEvents: EmpireEvent[];
  /**
   * Other company sites run hands-on before, parked while another is focused. Round 11 (G7): sim-empire's ParkedSite
   * (room, menu, crew, reputation, loan, decor, the last 90 days without reviews) as an object; older saves hold a
   * whole serialised GameState string per site, read (and slimmed) on the next switch or evening.
   */
  parked?: Record<string, ParkedSite | string>;
  stars?: StarsState;
  /** Stars events from tonight. */
  starsEvents: StarsEvent[];
  /** Guide day arrived: the envelope is waiting to be opened. */
  pendingGuide?: { result: GuideResult; visits: InspectorVisit[] } | undefined;

  win?: WinMeta;
  /** A hands-on session is live this service. */
  handsOn?: HandsOnMeta | undefined;
  /**
   * Round 11 (D, U11): written by the save envelope instead of `handsOn` (the live session itself isn't saved): a
   * reload mid-shift goes back into hands-on play at the saved clock (the start of that sim-hour). Read once on load.
   */
  handsOnResume?: { role: HandsOnRole; jumpIn: boolean } | undefined;
  /** Score of the last hands-on shift (for the evening). */
  shiftSummary?: ShiftSummary | undefined;
  /** Last sim day the evening hooks (career / empire / stars) ran for; stops double steps. */
  lastPathDay: number;
  /** Sim day the morning hooks (career owner planning, Stars refit) last ran for. */
  morningDay?: number | undefined;
  /** Round 12 (B): her brand kit as a code (lib/brandCode.ts); absent = the default derived from the name. */
  brand?: string | undefined;
  /** Round 12 (C): Quick year — the fork comes from this day (QUICK_FORK_DAY). Unset = FORK_DAY (365). */
  forkDay?: number | undefined;
  /** Round 12 (C): the last chapter card (30-day month of year 1) the player dismissed. */
  chapterSeen?: number | undefined;
  /** Round 12 (C): this game is a daily challenge (its own save, lib/challenge.ts), not one of the six slots. */
  challenge?: ChallengeMeta | undefined;
  /** Round 12 (F): dishes the player invented (lib/customDish.ts; put into the pack by sim.ts syncCustomDishes). */
  customDishes?: CustomDish[];
  /** Round 12 (F): last history day folded into the custom dishes' lifetime sales. */
  cookbookDay?: number;
  /** Round 13 (D): the cookbook's display order (ids); new recipes follow at the end. */
  cookbookOrder?: string[] | undefined;
  /** Round 13 (D): bumped by every cookbook edit (the autosave key reads it). */
  cookbookRev?: number | undefined;
  /** Round 13 (D): the regulars' stories and the clipping as of `day`, so a game past day 400 keeps them. */
  voices?: VoicesMemo | undefined;
}

/**
 * Round 13 (D, R12.11 item 5): sim-core keeps 400 days of results, and the Regulars book, the gossip and the framed
 * clipping are worked out from them. This memo is the fold so far (lib/voicesMemo.ts writes it after each day ends):
 * every regular's joined day, finished beats (with the dish that sold that night) and open VIP order, and the clipping's
 * day once earned. A save without one is backfilled from its history on the first evening.
 */
export interface VoicesMemo {
  v: 1;
  seed: number;
  /** The last history day folded in. */
  day: number;
  /** The morning the clipping was earned (kept once set). */
  clip?: number | undefined;
  regs: VoicesMemoRegular[];
}
export interface VoicesMemoRegular {
  id: string;
  joined?: number | undefined;
  /** [beat, day, good (1/0), dish that sold that night]. */
  done: [number, number, number, string?][];
  open?: { beat: number; dishId: string; weekday: number; since: number; from: number; triedDay?: number | undefined } | undefined;
}

/** Round 12 (C): what the score screen needs to know about where a daily challenge started. */
export interface ChallengeMeta {
  /** UTC date of the challenge, YYYY-MM-DD (the template and the goal come from it). */
  date: string;
  /** First day of the five. The run ends after the evening of startDay + 4. */
  startDay: number;
  startCash: number;
  startPopularity: number;
  /** The goal's number, fixed from the restaurant's last week when the scenario was built (lib/challenge.ts). */
  target: number;
  /** Round 14: the scenario version it was built with (absent: Round 12–13). */
  v?: number | undefined;
  /** Round 14: the template played (absent: the date's own). */
  template?: "rescue" | "rush" | "inspector" | "walkout" | "rival" | "festival" | undefined;
  /** Round 14: the guests a two-part goal also asks for (inspector's night, rival's five days). */
  guests?: number | undefined;
  /** Round 14: the last five days' profit before the run (Rescue's goal is set from it), pence. */
  prev?: number | undefined;
  /** Round 14 (G6): the most one guest's bill counts for in the score, pence. */
  fair?: number | undefined;
  /** Round 14 (G6): the loan's principal when the run started (borrowing during it counts as a loss). */
  loan0?: number | undefined;
  /** Round 14 (S14-6): the built starting state's fingerprint (0–255), carried in the score code. */
  fp?: number | undefined;
}

/** Round 12 (C): days in a daily challenge. */
export const CHALLENGE_DAYS = 5;

/** Round 12 (C): year 1 is told as chapters of one 30-day month each (12, or 4 in a quick year). Presentation only. */
export const CHAPTER_DAYS = 30;
/** The chapter that ends tonight and hasn't been dismissed (an owner's first year, before the fork), else 0. */
export function chapterDue(game: GameState, meta: PathMeta): number {
  const n = (game.day + 1) / CHAPTER_DAYS;
  const on = meta.mode === "owner" && !meta.challenge && !meta.fork.chosen && (game.phase === "evening" || game.phase === "event");
  return on && Number.isInteger(n) && n <= Math.floor(forkDayOf(meta) / CHAPTER_DAYS) && n > (meta.chapterSeen ?? 0) ? n : 0;
}

export const initialMeta = (mode: GameMode = "owner"): PathMeta => ({
  mode,
  careerEvents: [],
  ownerCommands: [],
  ownerMorning: [],
  fork: { offered: false },
  empireEvents: [],
  starsEvents: [],
  lastPathDay: -1,
});

/** Which path badge(s) the header shows. */
export function pathBadges(meta: PathMeta): { id: string; label: string; tone: "career" | "empire" | "stars" }[] {
  const out: { id: string; label: string; tone: "career" | "empire" | "stars" }[] = [];
  if (meta.mode === "career") out.push({ id: "career", label: "Career", tone: "career" });
  if (meta.empire) out.push({ id: "empire", label: "Empire", tone: "empire" });
  if (meta.stars) out.push({ id: "stars", label: "Stars", tone: "stars" });
  return out;
}
