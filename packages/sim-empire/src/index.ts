/**
 * @full-plate/sim-empire — Path A, the Empire: multi-site, franchising, real estate and expansion.
 * Pure functions over (content, empire). See docs/EMPIRE-NOTES.md for how the game mounts it.
 */
export {
  newEmpire,
  forkFromGameState,
  stepEmpireDay,
  stepEmpireDays,
  applyEmpireCommand,
  associationBlocks,
  expectedSiteDay,
  forceEvent,
  recalibrateFromSite,
  updateSaturation,
  // derived helpers for the UI
  avgFranchiseeMood,
  buildCost,
  cityEntryCost,
  contractAttractiveness,
  contractTake,
  franchiseCashNeeded,
  marketRent,
  openSites,
  propertyPrice,
  recognitionTarget,
  remodelCost,
  spendable,
  TECH_LABEL,
} from "./engine";
export type { NewEmpireOptions, ForkOptions, StepOptions, ForcedEvent } from "./engine";
export {
  aggregateSiteDay,
  calibrate,
  defaultCalibration,
  demandFactor,
  menuBreaksRules,
  saturationPenalty,
  siteDayFromResult,
  standardisation,
} from "./model";
export type { CalibrateOptions, SiteDayContext } from "./model";
export { serialize, deserialize, MIGRATIONS } from "./save";
export { DEFAULT_REGIONS, DEFAULT_SUPPLIERS, defaultCities } from "./world";
export * as EMPIRE from "./constants";
export * from "./types";
