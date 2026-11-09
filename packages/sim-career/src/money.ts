/**
 * The player's money: the tronc split of the day's tips and the weekly payslip (PAYE, NI, living costs).
 * UK rules: all tips go to workers and are shared fairly under a written policy (Employment (Allocation of Tips)
 * Act 2023). An independent tronc pays tips through payroll: income tax yes, National Insurance no.
 */
import type { DayResult, GameState, Staff } from "@full-plate/sim-core";
import { weekdayOf } from "@full-plate/sim-core";
import {
  BASIC_RATE,
  BASIC_RATE_LIMIT_WEEK,
  COWORKER_SENIORITY_POINTS,
  HIGHER_RATE,
  KITCHEN_TRONC_SHARE,
  LIVING_COSTS_WEEK,
  NI_MAIN,
  NI_PRIMARY_WEEK,
  NI_UPPER,
  NI_UPPER_WEEK,
  PERSONAL_ALLOWANCE_WEEK,
} from "./constants";
import { rungDef } from "./ladder";
import type { CareerState, Payslip } from "./types";

export const PLAYER_ID = "player";

const isKitchen = (s: Pick<Staff, "role">) => s.role === "chef" || s.role === "porter";

/** Tronc points for a co-worker: front of house 1, kitchen 0.7, plus a little for seniority (skill). */
export function coworkerPoints(s: Staff): number {
  return (isKitchen(s) ? KITCHEN_TRONC_SHARE : 1) + s.skill * COWORKER_SENIORITY_POINTS;
}

/** Who was on shift on sim day `day` (rostered and not on a course). The player's training day is passed in. */
export function workedOn(state: GameState, day: number, trainingSimDay?: number): Staff[] {
  const wd = weekdayOf(day);
  return state.staff.filter((s) => s.rota[wd] === true && s.trainingDay !== day && !(s.id === PLAYER_ID && trainingSimDay === day));
}

/**
 * The player's share of the day's tips: points-weighted across everyone on shift. Returns 0 when the player was
 * not on the floor. Integer pence (the remainder stays in the pot for the others).
 */
export function troncShare(career: CareerState, state: GameState, result: DayResult): number {
  if (result.tips <= 0) return 0;
  const working = workedOn(state, result.day, career.trainingSimDay);
  if (!working.some((s) => s.id === PLAYER_ID)) return 0;
  const mine = rungDef(career.track, career.rung).troncPoints * (isKitchen({ role: career.role }) ? KITCHEN_TRONC_SHARE : 1);
  let total = mine;
  for (const s of working) if (s.id !== PLAYER_ID) total += coworkerPoints(s);
  return Math.floor((result.tips * mine) / total);
}

/** Weekly PAYE (tax code 1257L, non-cumulative) on all pay including tronc tips. */
export function incomeTaxWeek(taxable: number): number {
  const basic = Math.max(0, Math.min(taxable, BASIC_RATE_LIMIT_WEEK) - PERSONAL_ALLOWANCE_WEEK);
  const higher = Math.max(0, taxable - BASIC_RATE_LIMIT_WEEK);
  return Math.round(basic * BASIC_RATE + higher * HIGHER_RATE);
}

/** Employee Class 1 NI on wages and bonus (tronc tips are exempt). */
export function nationalInsuranceWeek(niable: number): number {
  const main = Math.max(0, Math.min(niable, NI_UPPER_WEEK) - NI_PRIMARY_WEEK);
  const upper = Math.max(0, niable - NI_UPPER_WEEK);
  return Math.round(main * NI_MAIN + upper * NI_UPPER);
}

export function payslip(day: number, wages: number, tips: number, bonus: number, living = LIVING_COSTS_WEEK): Payslip {
  const tax = incomeTaxWeek(wages + tips + bonus);
  const ni = nationalInsuranceWeek(wages + bonus);
  return { day, wages, tips, bonus, tax, ni, living, saved: wages + tips + bonus - tax - ni - living };
}
