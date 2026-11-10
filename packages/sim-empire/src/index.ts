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
  franchiseOutlook,
  FAIR_NET_PCT,
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
  emptyBook,
  bookNet,
  refurbCost,
  bookValue,
} from "./engine";
export { buildBoardMeeting, boardRisk, boardHash, districtSales, refurbGain, debtOptions, hqSinkingPerDay, type DebtOption } from "./board";
export type { NewEmpireOptions, ForkOptions, StepOptions, ForcedEvent, SiteGameOptions, FranchiseOutlook } from "./engine";
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
  maturity,
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
export {
  asParked, backTill, branchLarder, closeAndMoveOn, empireOutcome, switchSite, larderCost, openTill, parkSite, pruneParked, restoreSite, settleTill, slimDay, sweepable, tillCover, tillFloat,
  PARKED_HISTORY_DAYS, TILL_BUFFER_DAYS, type EmpireOutcome, type Parked, type ParkedSite, type Switched, type TillPlan,
} from "./focus";
export { DEFAULT_REGIONS, DEFAULT_SUPPLIERS, defaultCities } from "./world";
export * as EMPIRE from "./constants";
export { BRAND_PULL_SOURCE } from "./constants";
export * from "./types";
