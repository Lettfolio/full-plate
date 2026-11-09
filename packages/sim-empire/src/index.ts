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
  newGameFromSite,
  siteBrandPull,
  updateSaturation,
  // derived helpers for the UI
  avgFranchiseeMood,
  moodTarget,
  medianFranchiseeMargin,
  buildCost,
  cityEntryCost,
  contractAttractiveness,
  contractTake,
  franchiseCashNeeded,
  marketRent,
  plotRentMult,
  openSites,
  propertyPrice,
  recognitionTarget,
  siteVisibility,
  remodelCost,
  spendable,
  developmentFacility,
  TECH_LABEL,
} from "./engine";
export type { NewEmpireOptions, ForkOptions, StepOptions, ForcedEvent, SiteGameOptions } from "./engine";
export {
  aggregateSiteDay,
  boxTables,
  brandMenu,
  brandPull,
  calibrate,
  crewLabourPerDay,
  offPremise,
  offPremiseLabour,
  openingFactor,
  siteDemandAndCapacity,
  defaultCalibration,
  demandFactor,
  menuBreaksRules,
  saturationPenalty,
  siteDayFromResult,
  standardisation,
} from "./model";
export type { CalibrateOptions, SiteDayContext } from "./model";
export { probeUnitEconomics, openProbeSite, formatUnitEconomics } from "./unitEconomics";
export type { UnitEconomics, UnitProbeOptions } from "./unitEconomics";
export { serialize, deserialize, MIGRATIONS } from "./save";
export { DEFAULT_REGIONS, DEFAULT_SUPPLIERS, defaultCities } from "./world";
export * as EMPIRE from "./constants";
export { BRAND_PULL_SOURCE } from "./constants";
export * from "./types";
