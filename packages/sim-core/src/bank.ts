/**
 * Round 11 (B): "stop silent losing". Pure helpers the UI reads so losing is never a surprise:
 *   - `bankStatus`: the overdraft line, whether cash is under it and how many evenings the bank has left to give;
 *   - `runningCostPerDay` / `spendCheck`: what a day of trading costs, so a purchase that leaves under
 *     SPEND_SAFETY_DAYS of it can ask first;
 *   - `hireNeed`: the one HIRE cash rule (commands.ts uses it; so does the Staff tab);
 *   - `starterLoanOffer`: the once-only "the bank will lend you a first wage" loan for a staffless owner.
 * Derived only: nothing here is stored, nothing draws from the RNG.
 */
import {
  DIFFICULTY,
  HIRE_CASH_BUFFER_SHIFTS,
  INSOLVENCY_DAYS,
  RECRUITMENT_FEE,
  STOCK_OVERDRAFT_LIMIT,
} from "./constants";
import { dailyRent, insolvencyLine, monthlyWages, overheadsToday, shiftCost } from "./systems/finance";
import { DAYS_PER_MONTH } from "./constants";
import { candidates } from "./staff";
import type { ContentPack, GameState } from "./types";

/** A purchase that leaves less than this many days of running costs in the bank asks "are you sure?". */
export const SPEND_SAFETY_DAYS = 3;
/** Stock a day is guessed at this before there is any history (pence). */
export const STOCK_DAY_GUESS = 10_000;
/**
 * The once-only starter loan: what the cheapest chef in today's pool needs (agency fee + the bank's shifts), rounded up
 * to £100 — at least STARTER_LOAN, at most STARTER_LOAN_MAX (deeper than that and the bank says no).
 */
export const STARTER_LOAN = 100_000;
export const STARTER_LOAN_MAX = 500_000;
/** The bank's morning banner shows on the last this-many days. */
export const BANK_LAST_DAYS = 3;
/** The header chip turns red at this many days left. */
export const BANK_RED_DAYS = 5;

export interface BankStatus {
  /** False on Cosy: the bank tops cash up to £0 and nobody goes bust. */
  canGoBust: boolean;
  /** The overdraft limit (negative pence): cash below it counts as a day in trouble. */
  line: number;
  /** Cash is below the line right now. */
  below: boolean;
  /** Evenings in a row already spent below the line. */
  daysBelow: number;
  /**
   * Evenings the bank still allows below the line before it closes the restaurant (INSOLVENCY_DAYS − daysBelow), when
   * below; null when the restaurant is fine (or on Cosy).
   */
  daysLeft: number | null;
}

/** Where she stands with the bank. `daysLeft` counts down from INSOLVENCY_DAYS − 1 after the first evening below. */
export function bankStatus(content: ContentPack, state: GameState): BankStatus {
  const canGoBust = DIFFICULTY[state.difficulty]?.canGoBust ?? true;
  const line = insolvencyLine(content, state);
  const daysBelow = state.distressDays ?? 0;
  const below = canGoBust && state.cash < line;
  return { canGoBust, line, below, daysBelow, daysLeft: below || daysBelow > 0 ? Math.max(0, INSOLVENCY_DAYS - daysBelow) : null };
}

/** One ordinary day's outgoings: rent, the rota's wages, fixed bills, the loan instalment and a typical day's stock. */
export function runningCostPerDay(content: ContentPack, state: GameState): number {
  const recent = state.history.slice(-7);
  const stock = recent.length
    ? Math.round(recent.reduce((a, d) => a + d.foodCost + d.waste.prep + d.waste.spoil, 0) / recent.length)
    : STOCK_DAY_GUESS;
  const fixed = overheadsToday({ ...state, todays: { ...state.todays, revenue: 0 } });
  return dailyRent(content, state) + Math.round(monthlyWages(state) / DAYS_PER_MONTH) + fixed + (state.loan?.dailyPayment ?? 0) + stock;
}

export interface SpendCheck {
  /** Cash after the purchase. */
  after: number;
  /** SPEND_SAFETY_DAYS of running costs. */
  floor: number;
  /** The purchase would leave less than `floor`: ask first. */
  risky: boolean;
}

/**
 * With no chef yet, the floor is also what hiring the cheapest chef in today's pool needs, so a spree can't spend the
 * money her first hire needs (the red-team's day-1 decor spree left £1,130 against a £1,213 chef).
 */
export function spendCheck(content: ContentPack, state: GameState, cost: number): SpendCheck {
  const after = state.cash - Math.max(0, cost);
  const chefs = state.staff.some((x) => x.role === "chef") ? [] : candidates(content, state).filter((c) => c.role === "chef" && !c.hired);
  const firstChef = chefs.length ? Math.min(...chefs.map((c) => hireNeed(state, c.wage).needed)) : 0;
  const floor = Math.max(SPEND_SAFETY_DAYS * runningCostPerDay(content, state), firstChef);
  return { after, floor, risky: cost > 0 && after < floor };
}

export interface HireNeed {
  fee: number;
  /** One shift of this person's wages (with on-costs). */
  perShift: number;
  /** Cash needed in the bank before HIRE goes through. */
  needed: number;
  canAfford: boolean;
  /** Cosy: the hire may dip into the supplier's overdraft (no shifts' buffer). */
  overdraft: boolean;
}

/** Recruitment fee in effect: GameState.recruitmentFee (career perk) or RECRUITMENT_FEE. */
export const recruitmentFeeOf = (state: GameState): number =>
  Number.isInteger(state.recruitmentFee) && (state.recruitmentFee as number) >= 0 ? (state.recruitmentFee as number) : RECRUITMENT_FEE;

/**
 * The HIRE / HIRE_STAFF cash rule. Normal/Hard: fee + HIRE_CASH_BUFFER_SHIFTS shifts of wages in the bank. Cosy (round
 * 11, G2): the bank tops cash back up to £0 every night, so the buffer protects nothing and only trapped a staffless
 * player at £0 — the fee may go into the same overdraft stock orders use (down to −STOCK_OVERDRAFT_LIMIT).
 */
export function hireNeed(state: GameState, wage: number): HireNeed {
  const fee = recruitmentFeeOf(state);
  const perShift = shiftCost({ wage });
  const overdraft = !(DIFFICULTY[state.difficulty]?.canGoBust ?? true);
  const needed = overdraft ? fee - STOCK_OVERDRAFT_LIMIT : fee + HIRE_CASH_BUFFER_SHIFTS * perShift;
  return { fee, perShift, needed, canAfford: state.cash >= needed, overdraft };
}

/**
 * The starter loan the bank offers now, in pence, or null: nobody hired yet, not taken before, Normal/Hard, outside
 * service, and the gap to the cheapest chef no more than STARTER_LOAN_MAX.
 */
export function starterLoanOffer(content: ContentPack, state: GameState): number | null {
  if (state.starterLoan || state.staff.length > 0 || !(DIFFICULTY[state.difficulty]?.canGoBust ?? true) || state.phase === "service" || state.phase === "gameover") return null;
  const chefs = candidates(content, state).filter((c) => c.role === "chef" && !c.hired);
  const need = chefs.length ? Math.min(...chefs.map((c) => hireNeed(state, c.wage).needed)) : 0;
  const amount = Math.max(STARTER_LOAN, Math.ceil(Math.max(0, need - state.cash) / 10_000) * 10_000);
  return amount <= STARTER_LOAN_MAX ? amount : null;
}
