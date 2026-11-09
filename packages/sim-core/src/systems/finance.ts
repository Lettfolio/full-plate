/**
 * FinanceSystem (evening) — pays daily rent, wages for staff who worked today, overheads
 * (utilities, rates, card fees), VAT on takings and the loan instalment; then checks insolvency. Normal/hard: below −(3 months rent + wages) for 14
 * consecutive evenings ⇒ game over. Cosy: cash is clamped at 0 with a CASH_LOW warning.
 */
import {
  CARD_FEE_RATE,
  CASH_LOW_WARNING,
  CLOSED_DAY_WAGE_SHARE,
  DAYS_PER_MONTH,
  DIFFICULTY,
  EMPLOYER_ONCOST,
  INSOLVENCY_DAYS,
  INSOLVENCY_MONTHS,
  OVERHEADS_DAILY,
  SHIFT_HOURS,
  VAT_RATE,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, GameState, Loan, SimEvent, Staff } from "../types";
import { districtOf, logEvent, worksToday } from "../util";
import type { SystemResult } from "./system";

export const shiftCost = (s: Pick<Staff, "wage">): number => Math.round(s.wage * SHIFT_HOURS * (1 + EMPLOYER_ONCOST));

export function dailyRent(content: ContentPack, state: GameState): number {
  return Math.round((districtOf(content, state).monthlyRent * DIFFICULTY[state.difficulty].costMult) / DAYS_PER_MONTH);
}

/** Fixed overheads plus card fees on today's takings. */
export function overheadsToday(state: GameState): number {
  const fixed = OVERHEADS_DAILY * DIFFICULTY[state.difficulty].costMult;
  return Math.round(fixed + (state.todays.revenue ?? 0) * CARD_FEE_RATE);
}

/** VAT included in today's takings. */
export function vatToday(state: GameState): number {
  return Math.round(((state.todays.revenue ?? 0) * VAT_RATE) / (1 + VAT_RATE));
}

export function wagesToday(state: GameState): number {
  let total = 0;
  for (const s of state.staff) if (worksToday(s, state.day)) total += shiftCost(s);
  // Round 3: on a CLOSE_TODAY day rostered staff get CLOSED_DAY_WAGE_SHARE of a shift (they were told late).
  return state.todays.closed ? Math.round(total * CLOSED_DAY_WAGE_SHARE) : total;
}

/** Monthly wage bill implied by the current rota. */
export function monthlyWages(state: GameState): number {
  let total = 0;
  for (const s of state.staff) total += (shiftCost(s) * s.rota.filter(Boolean).length * DAYS_PER_MONTH) / 7;
  return Math.round(total);
}

export function insolvencyLine(content: ContentPack, state: GameState): number {
  return -INSOLVENCY_MONTHS * (dailyRent(content, state) * DAYS_PER_MONTH + monthlyWages(state));
}

/** Equal daily instalment for an amortising loan. */
export function dailyInstalment(principal: number, apr: number, days: number): number {
  if (days <= 0 || principal <= 0) return 0;
  const r = apr / 365;
  if (r === 0) return Math.ceil(principal / days);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -days)));
}

export function newLoan(principal: number, apr: number, days: number): Loan {
  return { principal, remaining: principal, dailyPayment: dailyInstalment(principal, apr, days), daysRemaining: principal > 0 ? days : 0 };
}

/** One day of the loan: interest accrues on the remaining principal; the instalment pays it down. */
export function payLoan(loan: Loan, apr: number): { loan: Loan; payment: number } {
  if (loan.daysRemaining <= 0 || loan.remaining <= 0) return { loan: { ...loan, daysRemaining: 0, remaining: 0 }, payment: 0 };
  const interest = Math.round((loan.remaining * apr) / 365);
  const last = loan.daysRemaining === 1;
  const payment = last ? loan.remaining + interest : Math.min(loan.dailyPayment, loan.remaining + interest);
  const remaining = Math.max(0, loan.remaining + interest - payment);
  return { loan: { ...loan, remaining, daysRemaining: remaining === 0 ? 0 : loan.daysRemaining - 1 }, payment };
}

/** Applies the insolvency rules to state after costs are paid. */
export function checkSolvency(content: ContentPack, state: GameState): SystemResult {
  const events: SimEvent[] = [];
  if (!DIFFICULTY[state.difficulty].canGoBust) {
    if (state.cash >= 0) return { state, events };
    events.push({ type: "CASH_LOW", cash: state.cash });
    events.push(logEvent(state, "Cash ran dry — the bank has quietly topped you up to £0.", "money"));
    return { state: { ...state, cash: 0 }, events };
  }
  if (state.cash < CASH_LOW_WARNING) events.push({ type: "CASH_LOW", cash: state.cash });
  const below = state.cash < insolvencyLine(content, state);
  const distressDays = below ? (state.distressDays ?? 0) + 1 : 0;
  let next: GameState = { ...state, distressDays };
  if (below) {
    events.push(logEvent(state, `The bank is worried: day ${distressDays} of ${INSOLVENCY_DAYS} below the overdraft limit.`, "bad"));
  }
  if (distressDays >= INSOLVENCY_DAYS) {
    const reason = `Cash stayed below the bank's limit for ${INSOLVENCY_DAYS} days.`;
    next = { ...next, phase: "gameover", gameOverReason: reason };
    events.push({ type: "GAME_OVER", reason });
  }
  return { state: next, events };
}

export function financeSystem(content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  const rent = dailyRent(content, state);
  const labourCost = wagesToday(state);
  const overheads = overheadsToday(state);
  const vat = vatToday(state);
  const { loan, payment } = payLoan(state.loan, content.balance.loanApr);
  const paid: GameState = {
    ...state,
    cash: state.cash - rent - labourCost - overheads - vat - payment,
    loan,
    todays: { ...state.todays, rent, labourCost, overheads, vat, loanPayment: payment },
  };
  const events: SimEvent[] = [];
  if (payment > 0 && loan.remaining === 0) events.push(logEvent(state, "Loan paid off in full!", "good"));
  return { state: paid, events };
}
