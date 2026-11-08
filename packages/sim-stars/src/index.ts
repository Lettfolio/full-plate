/**
 * @full-plate/sim-stars — Path B (The Stars): inspectors, prestige tracks, the test kitchen, sourcing, satellites,
 * ticketing, chef stress, stagiaires, the group cap, the Smyth arc and the endings. Pure functions over StarsState.
 * Mounting guide: docs/STARS-NOTES.md.
 */
export * from "./types";
export { newStarsState, serializeStars, deserializeStars, starsView, pickHeadChef } from "./state";
export type { StarsView } from "./state";
export { stepStarsDay, closedDay, isClosed, persistentMultiplier, starBump, stressTarget, scandalChance } from "./step";
export { applyStarsCommand, supplierCatalogue, satelliteCost, researchDays } from "./commands";
export type { CommandContext } from "./commands";
export { applyStarsEffects, prepareService } from "./effects";
export { withSignatures, isSignature } from "./signatures";
export {
  inspectorModel,
  cosyHint,
  decideGuide,
  guideScore,
  starsForScore,
  scheduleVisits,
  firstGuideDay,
  nextMonthStart,
  inSeason,
  yearConsistency,
} from "./inspector";
export { dayInputs, dayCriteria, windowConsistency, seriesConsistency, windowStats, consistencyModifier, criteriaTotal, produceShares } from "./proxies";
export type { DayInputs, DishLine } from "./proxies";
export { prestigeTarget, fiftyBestRank, gaultMillauPoints, goodFoodTier, criticRating } from "./tracks";
export * as STARS_CONSTANTS from "./constants";
