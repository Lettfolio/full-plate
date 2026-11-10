/**
 * Round 3: everything that sits beside the sim-core GameState. The career (employee start), the two paths chosen at
 * the fork (Empire / Stars), the fork story beat itself, and win/ending state. Pure helpers only; the reducer
 * (gameReducer.ts) owns the transitions.
 */
import type { CareerEvent, CareerState, HandoverSummary, OwnerPerks } from "@full-plate/sim-career";
import type { EmpireEvent, EmpireState } from "@full-plate/sim-empire";
import type { GuideResult, InspectorVisit, StarsEvent, StarsState } from "@full-plate/sim-stars";
import type { ShiftSummary, HandsOnResult, HandsOnRole, StationPlan } from "@full-plate/handson";
import type { Command, DayResult, GameState } from "@full-plate/sim-core";
import { asCommand } from "../sim";
import type { PathKind } from "../lib/library";

export type GameMode = "owner" | "career";

// ── the fork ──
/** Year 2 starts here (the brief: "at the start of in-game year 2"). */
export const FORK_DAY = 365;
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
export function forkMilestone(game: GameState): { met: boolean; popularity: number; profitDays: number; recentProfit: number; missing?: string } {
  const popularity = game.reputation.popularity;
  const profitDays = profitableDays(game.history);
  const recentProfit = game.history.slice(-FORK_RECENT_DAYS).reduce((a, d) => a + d.profit, 0);
  const known = popularity >= FORK_POPULARITY || profitDays >= FORK_PROFIT_DAYS;
  const met = known && recentProfit > 0;
  const missing = met ? undefined
    : !known ? `get popularity to ${FORK_POPULARITY} (now ${Math.round(popularity)}) or reach ${FORK_PROFIT_DAYS} profitable days (now ${profitDays})`
    : "make a profit over the last four weeks";
  return { met, popularity, profitDays, recentProfit, ...(missing ? { missing } : {}) };
}

/** Should tonight's evening show the fork story card? (`game` is the evening state; game.day is the day just played.) */
export function forkDue(game: GameState, fork: ForkMeta, mode: GameMode): boolean {
  if (mode !== "owner" || fork.chosen || game.phase === "gameover") return false;
  if (game.day < FORK_DAY) return false;
  if (fork.snoozeUntil !== undefined && game.day < fork.snoozeUntil) return false;
  return forkMilestone(game).met;
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
  /** Other sites' GameStates parked while another site is focused (serialised). */
  parked?: Record<string, string>;
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
