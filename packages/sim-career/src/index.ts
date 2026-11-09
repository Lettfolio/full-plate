/**
 * @full-plate/sim-career — the career ladder ("start as an employee").
 * Pure, deterministic functions over (content, CareerState, sim-core GameState). See docs/CAREER-NOTES.md.
 */
export * from "./types";
export {
  CAREER_SAVE_VERSION,
  CONTRACT_DAYS,
  LADDER,
  LIVING_COSTS_WEEK,
  MAX_SHIFTS_PER_WEEK,
  NLW,
  OPEN_RUNG,
  OWNERS,
  SHIFT_HOURS,
  WEEKEND_DAYS,
  type OwnerProfile,
} from "./constants";
export {
  advanceCareerDay,
  applyCareerCommand,
  applyGain,
  autoCommands,
  beginCareerDay,
  DEFAULT_POLICY,
  deserializeCareer,
  finishCareerDay,
  mentorSessionAvailable,
  newCareer,
  planFor,
  raiseAvailable,
  serializeCareer,
  shiftGrowth,
  stepCareerDay,
  type AutoPolicy,
  type BeginDayResult,
  type CommandResult,
  type NewCareerOptions,
  type StepCareerResult,
} from "./career";
export {
  canAskPromotion,
  departmentRoles,
  perHour,
  pounds,
  promotionChecklist,
  reviewAverage,
  rungDef,
  rungsOf,
  rungWage,
  topRung,
  trackStat,
  trackStatName,
} from "./ladder";
export { incomeTaxWeek, nationalInsuranceWeek, payslip, PLAYER_ID, troncShare } from "./money";
export { makeOffer, offerIsBetter, rollOffers } from "./offers";
export {
  closingCommand,
  newEmployer,
  ownerCloseDay,
  ownerEveningCommands,
  ownerIncidentResponses,
  ownerPlanning,
  planOwnerDay,
  runService,
  syncPlayer,
} from "./owner";
export { findMentor, findRival, headChefOf } from "./relationships";
export { generateReview, reviewBreakdown, reviewScore } from "./review";
export { applyWithPerks, canOpenOwn, handoverToOwner, loanFor, openingBudget, type HandoverOptions, type HandoverResult } from "./handover";

import type { CareerGame } from "./types";
import { deserializeCareer, serializeCareer } from "./career";
import { deserialize, serialize } from "@full-plate/sim-core";

/** Saves the whole employee game (career + employer state) as one JSON string. */
export function serializeCareerGame(game: CareerGame): string {
  return JSON.stringify({ career: JSON.parse(serializeCareer(game.career)), state: JSON.parse(serialize(game.state)) });
}

export function deserializeCareerGame(json: string): CareerGame {
  const raw = JSON.parse(json) as { career: unknown; state: unknown };
  return { career: deserializeCareer(JSON.stringify(raw.career)), state: deserialize(JSON.stringify(raw.state)) };
}
