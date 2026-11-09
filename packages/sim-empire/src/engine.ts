/**
 * The Empire layer: newEmpire, stepEmpireDay and applyEmpireCommand. Pure over (content, empire):
 * every function copies the state it changes ("draft") and never touches its input.
 *
 * Daily order (stepEmpireDay):
 *   effects & context → research → sites (model or focused DayResult) → money flows (royalties, ad fund, rent,
 *   loans) → recognition → franchisee mood/cash/bankruptcy → site drift, failing, remodels, inspections →
 *   random events (scandal, supplier outage, forced exit, ideas, applicants) → association → HQ overheads,
 *   mortgages, inflation, solvency → meals, win check, monthly snapshot.
 */
import { applyCommand, forecastNeeds, newGame, setFootfallMod, type ContentPack, type GameState, type Staff, type Stock } from "@full-plate/sim-core";
import * as K from "./constants";
import {
  aggregateSiteDay,
  calibrate,
  clamp,
  defaultCalibration,
  brandMenu,
  brandPull,
  crewWage,
  districtDef,
  offPremise,
  offPremiseLabour,
  menuBreaksRules,
  saturationPenalty,
  siteDayFromResult,
  sitePopularity,
  sitePrestige,
  siteTables,
  standardisation,
  type SiteDayContext,
} from "./model";
import { Rng } from "./rng";
import type {
  Applicant,
  CalibrationParams,
  City,
  DayResult,
  DistrictId,
  EmpireCommand,
  EmpireEffect,
  EmpireEvent,
  EmpireState,
  EmpireStepResult,
  Franchisee,
  FranchiseContract,
  LandMode,
  Ownership,
  PropertyHolding,
  RegionId,
  SiteContract,
  SiteDayResult,
  SiteSummary,
  SiteTrace,
  Tech,
} from "./types";
import { DEFAULT_REGIONS, DEFAULT_SUPPLIERS, DISTRICT_SHORT, FIRST_NAMES, LAST_NAMES, defaultCities } from "./world";

// ───────────────────────── creation ─────────────────────────
export interface NewEmpireOptions {
  seed: number;
  brandName: string;
  /** Flagship restaurant: becomes site 1, company-owned, in the home city. */
  flagship: { name: string; districtId: DistrictId };
  /** Day index the empire starts on (continue sim-core's day so seasons and weekdays line up). Default 0. */
  day?: number;
  /** HQ starting cash (the player's restaurant cash plus any investment at the fork). */
  hqCash: number;
  menuDishIds: string[];
  calibration?: CalibrationParams;
  homeCityId?: string;
  /** Override the world (tests, mods). */
  cities?: City[];
}

const BUILD_DAYS = 90;
const COLLAPSE_GRACE_DAYS = 270;
const COLLAPSE_MIN_AGE = 180;
const APPLICANT_EXPIRY_DAYS = 180;
const HOME_VISIBILITY = 0.55;

export function newEmpire(content: ContentPack, opts: NewEmpireOptions): EmpireState {
  const day = opts.day ?? 0;
  const districtIds = content.districts.map((d) => d.id);
  const homeCityId = opts.homeCityId ?? "harbourton";
  const cities = (opts.cities ?? defaultCities(districtIds, homeCityId)).map((c) => ({ ...c, entered: c.entered || c.id === homeCityId }));
  const home = cities.find((c) => c.id === homeCityId);
  if (!home) throw new Error(`Unknown home city ${homeCityId}`);
  const regions = DEFAULT_REGIONS.filter((r) => cities.some((c) => c.regionId === r.id)).map((r) => ({ ...r }));
  const calibration = opts.calibration ?? defaultCalibration(content);
  const recognition: Record<string, number> = {};
  const adSpend30d: Record<string, number> = {};
  for (const r of regions) {
    recognition[r.id] = r.id === home.regionId ? K.HOME_START_RECOGNITION : 0;
    adSpend30d[r.id] = 0;
  }
  const formula = { menuDishIds: opts.menuDishIds.slice(), locked: false, standardisation: 0, driveThru: false, academy: false, appOrdering: false, fresh: false, priceIndex: 1 };
  formula.standardisation = standardisation(formula);
  const flagshipDistrict = districtIds.includes(opts.flagship.districtId) ? opts.flagship.districtId : home.districts[0]!;
  const flagship: SiteSummary = {
    id: "s1",
    name: opts.flagship.name,
    cityId: home.id,
    districtId: flagshipDistrict,
    opened: day,
    status: "open",
    ownership: "company",
    land: "hqLease",
    brandConsistency: K.REF_CONSISTENCY,
    staffQuality: K.REF_STAFF_QUALITY,
    covers7d: calibration.coversMean * 7,
    revenue7d: calibration.source.revenue * 7,
    margin7d: 0,
    revenueYear: calibration.source.revenue * K.DAYS_PER_YEAR,
    rent: marketRent(content, home, flagshipDistrict, 1, 1), // the first restaurant's own unit
    rentReviewedDay: day,
    driveThru: false,
    lastRemodel: day,
    footfallMods: [],
    saturationPenalty: 0,
    unreported: 0,
    failingDays: 0,
    mealsServed: 0,
    // A two-year-old founder-run room (forkFromGameState replaces these with the real restaurant's).
    popularity: calibration.popularity ?? K.DEFAULT_POPULARITY,
    prestige: K.FLAGSHIP_PRESTIGE,
  };
  return {
    version: 1,
    seed: opts.seed,
    rngState: Rng.fromSeed(opts.seed ^ 0x5eed_e3e1).getState(),
    brand: { name: opts.brandName, formula, recognition, adSpend30d, permanentDemand: 1 },
    contract: {
      fee: K.DEFAULT_FRANCHISE_FEE,
      royaltyPct: K.DEFAULT_ROYALTY_PCT,
      adFundPct: K.DEFAULT_AD_FUND_PCT,
      rentPctOfSales: K.DEFAULT_RENT_PCT,
      termDays: K.DEFAULT_TERM_DAYS,
      remodelEveryDays: K.DEFAULT_REMODEL_EVERY_DAYS,
    },
    sites: [flagship],
    franchisees: [],
    applicants: [],
    cities,
    regions,
    property: [],
    suppliers: DEFAULT_SUPPLIERS.map((s) => ({ ...s })),
    hq: { cash: Math.round(opts.hqCash), day, priceLevel: 1, lastDayNet: 0, income30d: 0, homeCityId },
    calibration,
    mealsServedTotal: 0,
    association: { active: false },
    inspectionEveryDays: K.DEFAULT_INSPECTION_EVERY_DAYS,
    effects: [],
    events: [],
    history: [],
    win: { mealsTarget: K.WIN_MEALS, regionsWon: [], solvent: true, moodOk: true, achieved: false },
    status: "running",
    nextId: 2,
  };
}

export interface ForkOptions {
  brandName: string;
  /** Extra cash at the fork (the franchise consultant's investors). Default £500k. */
  investment?: number;
  /** Cash moved from the restaurant's till into HQ (the game deducts it from GameState.cash). Default 0. */
  transfer?: number;
  /** Days of history to calibrate on. Default 90. */
  calibrationDays?: number;
  homeCityId?: string;
}

/**
 * The fork: builds an EmpireState whose flagship (s1) *is* the player's restaurant. The aggregate model is
 * calibrated on the restaurant's recent DayResults so the flagship keeps its numbers if it is ever demoted.
 * The flagship starts focused; the game keeps stepping its GameState and passes each DayResult in.
 */
export function forkFromGameState(content: ContentPack, state: GameState, opts: ForkOptions): EmpireState {
  const calibration = calibrate(content, state.history, { districtId: state.districtId, lastDays: opts.calibrationDays ?? 90, state });
  const e = newEmpire(content, {
    seed: state.seed,
    brandName: opts.brandName,
    flagship: { name: state.restaurantName, districtId: state.districtId },
    day: state.day,
    hqCash: (opts.investment ?? 50_000_000) + (opts.transfer ?? 0),
    menuDishIds: state.menu.filter((m) => m.active).map((m) => m.dishId),
    calibration,
    ...(opts.homeCityId ? { homeCityId: opts.homeCityId } : {}),
  });
  // The flagship keeps its own dining room (it may have bought tables); other sites get the brand's box.
  return { ...e, sites: e.sites.map((s) => ({ ...s, focused: true, ...ownRoom(content, state) })), focusedSiteId: "s1" };
}

/** What a hands-on GameState tells the model about its own site: tables, crew skill (shift-weighted) and popularity. */
function ownRoom(content: ContentPack, state: GameState): Partial<SiteSummary> {
  let shifts = 0;
  let skill = 0;
  for (const x of state.staff) {
    if (x.role !== "chef" && x.role !== "server") continue;
    const n = x.rota.filter(Boolean).length;
    shifts += n;
    skill += x.skill * n;
  }
  return {
    ...(state.tables.length !== content.balance.startingTables ? { tables: state.tables.length } : {}),
    ...(shifts > 0 ? { staffQuality: Math.round(skill / shifts) } : {}),
    popularity: Math.round(state.reputation.popularity * 10) / 10,
    prestige: Math.round(state.reputation.prestige * 10) / 10,
  };
}

// ───────────────────────── helpers ─────────────────────────
/** Rent multiplier on the district rent for a plot: the founder's unit size without a lane, the bigger corner plot with one. */
export const plotRentMult = (driveThru: boolean): number => (driveThru ? K.QSR_RENT_MULT : K.UNIT_RENT_MULT);

export function marketRent(content: ContentPack, city: City, districtId: DistrictId, priceLevel: number, mult = K.QSR_RENT_MULT): number {
  return Math.round(districtDef(content, districtId).monthlyRent * mult * city.costIndex * priceLevel);
}

export function buildCost(city: City, driveThru: boolean, priceLevel: number): number {
  return Math.round((K.SITE_BUILD_COST + (driveThru ? K.DRIVE_THRU_BUILD_EXTRA : 0)) * city.costIndex * priceLevel);
}

export function propertyPrice(site: SiteSummary): number {
  return Math.round((site.rent * 12) / K.PROPERTY_YIELD);
}

export function remodelCost(site: SiteSummary, city: City, priceLevel: number): number {
  const t = clamp(site.revenueYear / K.REMODEL_COST_REVENUE_REF, 0, 1);
  return Math.round((K.REMODEL_COST_MIN + (K.REMODEL_COST_MAX - K.REMODEL_COST_MIN) * t) * city.costIndex * priceLevel);
}

/** Equal daily payments that clear `principal` at `apr` over `days`. */
export function annuityDaily(principal: number, apr: number, days: number): number {
  const r = apr / K.DAYS_PER_YEAR;
  return Math.round(r === 0 ? principal / days : (principal * r) / (1 - (1 + r) ** -days));
}

/** What a franchisee needs in cash to take a new site: fee + equity share of the build. */
export function franchiseCashNeeded(e: EmpireState, city: City): number {
  return e.contract.fee + Math.round(buildCost(city, e.brand.formula.driveThru, e.hq.priceLevel) * K.FRANCHISEE_EQUITY_SHARE);
}

/** Cash HQ can spend now: its balance plus the share of the credit line banks lend for development. */
export function spendable(e: EmpireState): number {
  return e.hq.cash + developmentFacility(e);
}

/** What the bank will lend HQ for capital spending today: FACILITY_PER_OPEN_SITE per trading site, capped. */
export function developmentFacility(e: EmpireState): number {
  const trading = e.sites.filter((s) => s.status === "open").length;
  return Math.round(Math.min(K.HQ_CREDIT_LINE * K.DEVELOPMENT_FACILITY_SHARE, K.FACILITY_PER_OPEN_SITE * Math.max(1, trading)) * e.hq.priceLevel);
}

/** Cost of ENTER_CITY: a local office and permits, plus a country premium the first time (supply chain, legal). */
export function cityEntryCost(e: EmpireState, city: City): number {
  const newCountry = !e.cities.some((c) => c.entered && c.country === city.country);
  return Math.round((K.CITY_ENTRY_COST + (newCountry ? K.COUNTRY_ENTRY_COST : 0)) * Math.max(0.6, city.costIndex) * e.hq.priceLevel);
}

/** Royalty + ad fund + rent share: the brand's take per pound of net sales. */
export const contractTake = (c: Pick<FranchiseContract, "royaltyPct" | "adFundPct" | "rentPctOfSales">) => c.royaltyPct + c.adFundPct + c.rentPctOfSales;

/** Applicant attractiveness of the current contract: 1 at the benchmark, lower as the take and fee rise. */
export function contractAttractiveness(c: FranchiseContract): number {
  return clamp(1 - (contractTake(c) - K.BENCHMARK_TAKE) * 8 - ((c.fee - K.DEFAULT_FRANCHISE_FEE) / K.DEFAULT_FRANCHISE_FEE) * 0.3, 0.05, 2);
}

export function openSites(e: EmpireState): SiteSummary[] {
  return e.sites.filter((s) => s.status === "open");
}

export function avgFranchiseeMood(e: EmpireState): number {
  let w = 0;
  let m = 0;
  for (const f of e.franchisees) {
    const n = f.sites.length;
    if (!n) continue;
    w += n;
    m += f.mood * n;
  }
  return w ? m / w : 100;
}

export function regionPopulation(e: EmpireState, regionId: RegionId): number {
  return e.cities.filter((c) => c.regionId === regionId).reduce((a, c) => a + c.population, 0);
}

/** Recognition the region is heading for given its sites and advertising. */
export function recognitionTarget(e: EmpireState, regionId: RegionId, siteCount: number): number {
  const popM = Math.max(0.5, regionPopulation(e, regionId) / 1_000_000);
  let vis = siteCount / popM + (e.brand.adSpend30d[regionId] ?? 0) / K.AD_PENCE_PER_VIS;
  if (e.cities.find((c) => c.id === e.hq.homeCityId)?.regionId === regionId) vis += HOME_VISIBILITY;
  return 100 * (1 - Math.exp(-vis / K.REC_K));
}

function siteContract(c: FranchiseContract, day: number, ownership: Ownership): SiteContract {
  if (ownership === "licence") return { royaltyPct: K.LICENCE_ROYALTY_PCT, adFundPct: 0, rentPctOfSales: 0, signedDay: day, termDays: c.termDays, remodelEveryDays: c.remodelEveryDays };
  return { royaltyPct: c.royaltyPct, adFundPct: c.adFundPct, rentPctOfSales: c.rentPctOfSales, signedDay: day, termDays: c.termDays, remodelEveryDays: c.remodelEveryDays };
}

/** A shallow-copied state whose collections and records may be mutated freely. */
function draft(e: EmpireState): EmpireState {
  return {
    ...e,
    rngState: e.rngState.slice(),
    brand: {
      ...e.brand,
      formula: { ...e.brand.formula, menuDishIds: e.brand.formula.menuDishIds.slice() },
      recognition: { ...e.brand.recognition },
      adSpend30d: { ...e.brand.adSpend30d },
      ...(e.brand.research ? { research: { ...e.brand.research } } : {}),
    },
    contract: { ...e.contract },
    sites: e.sites.map((s) => ({ ...s, footfallMods: s.footfallMods.length ? s.footfallMods.map((m) => ({ ...m })) : [] })),
    franchisees: e.franchisees.map((f) => ({ ...f, sites: f.sites.slice() })),
    applicants: e.applicants.slice(),
    cities: e.cities.map((c) => ({ ...c })),
    regions: e.regions.map((r) => ({ ...r })),
    property: e.property.map((p) => ({ ...p })),
    suppliers: e.suppliers.map((s) => ({ ...s })),
    hq: { ...e.hq },
    association: { ...e.association },
    effects: e.effects.slice(),
    events: e.events.slice(),
    history: e.history.slice(),
    win: { ...e.win, regionsWon: e.win.regionsWon.slice() },
  };
}

interface Ctx {
  content: ContentPack;
  e: EmpireState;
  rng: Rng;
  events: EmpireEvent[];
  city: Map<string, City>;
  site: Map<string, SiteSummary>;
  fr: Map<string, Franchisee>;
  prop: Map<string, PropertyHolding>;
}

function makeCtx(content: ContentPack, e: EmpireState): Ctx {
  return {
    content,
    e,
    rng: new Rng(e.rngState),
    events: [],
    city: new Map(e.cities.map((c) => [c.id, c])),
    site: new Map(e.sites.map((s) => [s.id, s])),
    fr: new Map(e.franchisees.map((f) => [f.id, f])),
    prop: new Map(e.property.map((p) => [p.siteId, p])),
  };
}

function emit(x: Ctx, kind: EmpireEvent["kind"], text: string, tone: EmpireEvent["tone"], extra: Partial<EmpireEvent> = {}): void {
  x.events.push({ day: x.e.hq.day, kind, text, tone, ...extra });
}

function finish(x: Ctx): EmpireStepResult {
  const e = x.e;
  e.rngState = x.rng.getState();
  if (x.events.length) {
    e.events = e.events.concat(x.events);
    if (e.events.length > K.EVENT_LOG_MAX) e.events = e.events.slice(-K.EVENT_LOG_MAX);
  }
  return { empire: e, events: x.events };
}

const pounds = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;

function newId(e: EmpireState, prefix: string): string {
  return `${prefix}${e.nextId++}`;
}

function siteName(x: Ctx, city: City, districtId: DistrictId): string {
  const base = `${city.name} ${DISTRICT_SHORT[districtId] ?? districtDef(x.content, districtId).name}`;
  const n = x.e.sites.filter((s) => s.name === base || s.name.startsWith(base + " ")).length;
  return n ? `${base} ${n + 1}` : base;
}

function randomName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

// ───────────────────────── daily step ─────────────────────────
/** Demand and spend multipliers from active effects, per region (index by RegionId). */
function effectMultipliers(e: EmpireState, day: number): { demand: Record<string, number>; spend: Record<string, number> } {
  const demand: Record<string, number> = {};
  const spend: Record<string, number> = {};
  for (const r of e.regions) {
    demand[r.id] = 1;
    spend[r.id] = 1;
  }
  for (const fx of e.effects) {
    if (day < fx.startDay || day >= fx.endDay) continue;
    for (const r of e.regions) {
      let d = fx.demand;
      if (fx.kind === "scandal") {
        const left = 1 - (day - fx.startDay) / Math.max(1, fx.endDay - fx.startDay);
        d = fx.demand * left * (fx.regionId && fx.regionId !== r.id ? K.SCANDAL_SPILLOVER : 1);
      } else if (fx.regionId && fx.regionId !== r.id) continue;
      demand[r.id] = demand[r.id]! * (1 + d);
      if (fx.spend) spend[r.id] = spend[r.id]! * (1 + fx.spend);
    }
  }
  return { demand, spend };
}

function supplierFoodMult(e: EmpireState): number {
  let m = 1;
  for (const s of e.suppliers) if (s.signed) m *= 1 - s.discountPct * (s.exclusive ? 1 : K.NON_EXCLUSIVE_SHARE);
  return Math.max(1 - K.SUPPLIER_DISCOUNT_CAP, m);
}

/** Recomputes every open site's saturationPenalty from the brand's own sites in its city. */
export function updateSaturation(e: EmpireState): void {
  const perCity = new Map<string, number>();
  const perDistrict = new Map<string, number>();
  for (const s of e.sites) {
    if (s.status === "closed") continue;
    perCity.set(s.cityId, (perCity.get(s.cityId) ?? 0) + 1);
    const k = s.cityId + "|" + s.districtId;
    perDistrict.set(k, (perDistrict.get(k) ?? 0) + 1);
  }
  const pop = new Map(e.cities.map((c) => [c.id, c.population]));
  const cache = new Map<string, number>();
  for (const s of e.sites) {
    if (s.status === "closed") continue;
    const k = s.cityId + "|" + s.districtId;
    let v = cache.get(k);
    if (v === undefined) {
      const nEff = perCity.get(s.cityId)! + K.SAME_DISTRICT_EXTRA * (perDistrict.get(k)! - 1);
      v = saturationPenalty(nEff, pop.get(s.cityId) ?? K.FOOTFALL_POP_REF);
      cache.set(k, v);
    }
    s.saturationPenalty = v;
  }
}

function standardTargets(e: EmpireState, s: SiteSummary, fr: Franchisee | undefined, city: City): { consistency: number; staff: number } {
  const f = e.brand.formula;
  const std = f.standardisation;
  let consistency: number;
  let staff: number;
  if (s.ownership === "company") {
    consistency = std + 20;
    staff = K.COMPANY_STAFF_QUALITY;
  } else if (s.ownership === "licence") {
    consistency = std + 20 - K.LICENCE_CONSISTENCY_PENALTY;
    staff = 40;
  } else {
    const comp = fr?.competence ?? 50;
    consistency = std + 10 + (comp - 50) * K.FRANCHISE_CONSISTENCY_PER_COMPETENCE;
    staff = K.FRANCHISE_STAFF_BASE + K.FRANCHISE_STAFF_PER_COMPETENCE * comp;
  }
  if (f.academy) staff += K.ACADEMY_STAFF_BONUS;
  if (f.fresh) staff += K.FRESH_STAFF_BONUS;
  if (city.localised) consistency -= K.LOCALISE_CONSISTENCY_PENALTY;
  return { consistency: clamp(consistency, 0, 100), staff: clamp(staff, 0, 100) };
}

interface SiteFlows {
  /** Net cash to HQ today from this site. */
  hq: number;
  /** Operator net today (franchise/licence). */
  operator: number;
  netSales: number;
  ad: number;
  /** The parts (pence, today): royalty and ad fund on reported sales, the operator's occupancy, the build-loan instalment. */
  royalty: number;
  rent: number;
  loan: number;
}

/**
 * Money flows for one site-day. HQ receives company-site profit, or royalty + ad fund + rent from operators;
 * HQ pays the head lease on hqLease plots. The focused company site's cash lives in its GameState, so HQ
 * sees nothing from it until TRANSFER_FROM_FOCUSED.
 */
function siteFlows(x: Ctx, s: SiteSummary, r: SiteDayResult): SiteFlows {
  const e = x.e;
  const net = r.revenue - r.vat;
  const marketDaily = s.rent / 30;
  if (s.ownership === "company") {
    const ad = net * K.DEFAULT_AD_FUND_PCT;
    const occupancy = s.land === "hqOwned" ? 0 : marketDaily;
    s.margin7d = s.margin7d * (6 / 7) + (r.contribution - occupancy);
    if (s.focused) return { hq: 0, operator: 0, netSales: net, ad: 0, royalty: 0, rent: occupancy, loan: 0 };
    return { hq: r.contribution - occupancy - ad, operator: 0, netSales: net, ad, royalty: 0, rent: occupancy, loan: 0 };
  }
  const c = s.contract!;
  const fr = s.franchisee ? x.fr.get(s.franchisee) : undefined;
  // A dishonest operator under-reports sales; fees are charged on what is reported.
  const skim = fr ? Math.max(0, (K.SKIM_HONESTY_THRESHOLD - fr.honesty) / 100) * K.SKIM_RATE : 0;
  const reported = net * (1 - skim);
  s.unreported += Math.round(net - reported);
  const royalty = reported * c.royaltyPct;
  const ad = reported * c.adFundPct;
  let opRent = marketDaily;
  let hqRent = 0;
  let hqLeaseCost = 0;
  if (s.land !== "thirdParty") {
    // Sonneborn: rent is the higher of a share of sales and cost plus a markup.
    opRent = Math.max(reported * c.rentPctOfSales, marketDaily * (1 + K.RENT_COST_MARKUP));
    hqRent = opRent;
    if (s.land === "hqLease") hqLeaseCost = marketDaily;
  }
  let loan = 0;
  if (s.operatorLoan && s.operatorLoan.remaining > 0) {
    loan = Math.min(s.operatorLoan.daily, s.operatorLoan.remaining);
    s.operatorLoan = { ...s.operatorLoan, remaining: s.operatorLoan.remaining - loan };
  }
  const operator = r.contribution - royalty - ad - opRent - loan;
  s.margin7d = s.margin7d * (6 / 7) + (r.contribution - opRent);
  if (hqRent > 0) {
    const p = x.prop.get(s.id);
    if (p) p.rentIncome = p.rentIncome * (29 / 30) + hqRent;
  }
  return { hq: royalty + hqRent - hqLeaseCost, operator, netSales: net, ad, royalty, rent: opRent, loan };
}

export interface StepOptions {
  /** Skip random events (tests that isolate one mechanic). */
  noEvents?: boolean;
  /** Sites whose day (model result and money flows) to return in `trace` (the unit-economics probe). */
  trace?: readonly string[];
}

/**
 * Advances the empire one day. `focusedResult` is the focused restaurant's DayResult for this same day
 * (from sim-core runDay); without it the focused site falls back to the aggregate model.
 */
export function stepEmpireDay(content: ContentPack, empire: EmpireState, focusedResult?: DayResult, opts: StepOptions = {}): EmpireStepResult {
  if (empire.status === "bankrupt") return { empire, events: [] };
  const e = draft(empire);
  const x = makeCtx(content, e);
  const day = e.hq.day;
  const brand = e.brand;
  const f = brand.formula;

  // ── context ──
  e.effects = e.effects.filter((fx) => fx.endDay > day);
  const fx = effectMultipliers(e, day);
  const foodMult = supplierFoodMult(e);
  const breaks = new Map<string, boolean>();
  for (const c of e.cities) breaks.set(c.id, !c.localised && menuBreaksRules(content, f.menuDishIds, c.dietaryRules));
  updateSaturation(e);

  // ── research ──
  if (brand.research) {
    brand.research.daysLeft -= 1;
    if (brand.research.daysLeft <= 0) {
      const tech = brand.research.tech;
      f[tech] = true;
      f.standardisation = standardisation(f);
      delete brand.research;
      emit(x, "research", `${TECH_LABEL[tech]} is ready: standardisation now ${f.standardisation}.`, "good");
    }
  }

  // ── sites ──
  let hqNet = 0;
  let meals = 0;
  const adByRegion: Record<string, number> = {};
  const sitesByRegion: Record<string, number> = {};
  const profitableByRegion: Record<string, boolean> = {};
  const opNet = new Map<string, { net: number; sales: number }>();
  const trace: SiteTrace[] = [];
  const ctxBase: SiteDayContext = { day, calibration: e.calibration, priceLevel: e.hq.priceLevel, foodMult };
  for (const s of e.sites) {
    if (s.status === "building") {
      if (day >= s.opened) {
        s.status = "open";
        s.footfallMods.push({ mult: 1.15, daysRemaining: 30, reason: "grand opening" });
        emit(x, "site_opened", `${s.name} opens its doors.`, "good", { siteId: s.id, cityId: s.cityId });
      } else continue;
    }
    if (s.status !== "open") continue;
    const city = x.city.get(s.cityId)!;
    const rid = city.regionId;
    let r: SiteDayResult;
    if (s.focused && focusedResult) {
      // The hands-on dining room comes from sim-core; drive-thru and app orders (which sim-core has no physics for)
      // ride on top of it at the same spend and food cost per cover, as they do on modelled sites.
      r = withOffPremise(siteDayFromResult(s.id, focusedResult), offPremise(s, brand), offPremiseLabour(s, brand));
    } else {
      ctxBase.demandMult = fx.demand[rid];
      ctxBase.spendMult = fx.spend[rid];
      ctxBase.breaksRules = breaks.get(city.id);
      r = aggregateSiteDay(content, s, brand, city, x.rng, ctxBase);
    }
    const flow = siteFlows(x, s, r);
    if (opts.trace?.includes(s.id)) trace.push({ day, siteId: s.id, result: r, netSales: flow.netSales, royalty: flow.royalty, adFund: flow.ad, rent: flow.rent, loan: flow.loan, operator: flow.operator, hq: flow.hq });
    hqNet += flow.hq;
    adByRegion[rid] = (adByRegion[rid] ?? 0) + flow.ad;
    sitesByRegion[rid] = (sitesByRegion[rid] ?? 0) + 1;
    if (s.margin7d > 0) profitableByRegion[rid] = true;
    if (s.franchisee) {
      const o = opNet.get(s.franchisee) ?? { net: 0, sales: 0 };
      o.net += flow.operator;
      o.sales += flow.netSales;
      opNet.set(s.franchisee, o);
    }
    // rolling stats
    s.covers7d = s.covers7d * (6 / 7) + r.covers;
    s.revenue7d = s.revenue7d * (6 / 7) + r.revenue;
    s.revenueYear = s.revenueYear + (r.revenue * K.DAYS_PER_YEAR - s.revenueYear) / K.ANNUAL_EMA_DAYS;
    s.mealsServed += r.covers;
    meals += r.covers;
    if (s.footfallMods.length) {
      for (const m of s.footfallMods) m.daysRemaining -= 1;
      s.footfallMods = s.footfallMods.filter((m) => m.daysRemaining > 0);
    }
  }

  // ── advertising and recognition ──
  for (const reg of e.regions) {
    const campaign = e.effects
      .filter((c) => (c.kind === "campaign" || c.kind === "product") && day >= c.startDay && day < c.endDay && (!c.regionId || c.regionId === reg.id) && c.spend === undefined)
      .reduce((a, c) => a + (c.budgetPerDay ?? 0) / (c.regionId ? 1 : e.regions.length), 0);
    brand.adSpend30d[reg.id] = (brand.adSpend30d[reg.id] ?? 0) * (29 / 30) + (adByRegion[reg.id] ?? 0) + campaign;
    const target = recognitionTarget(e, reg.id, sitesByRegion[reg.id] ?? 0);
    const rec = brand.recognition[reg.id] ?? 0;
    brand.recognition[reg.id] = clamp(rec + (target - rec) * K.REC_DRIFT_PER_DAY, 0, 100);
  }

  // ── franchisees ──
  for (const fr of e.franchisees) {
    if (!fr.sites.length) continue;
    const o = opNet.get(fr.id) ?? { net: 0, sales: 0 };
    fr.cash = Math.round(fr.cash + o.net);
    if (o.sales > 0) fr.margin30d += (o.net / o.sales - fr.margin30d) / 30;
    const c = fr.sites.map((id) => x.site.get(id)?.contract).find(Boolean) ?? siteContract(e.contract, day, "franchise");
    const target = clamp(
      K.MOOD_BASE +
        (fr.margin30d - K.MOOD_MARGIN_REF) * K.MOOD_MARGIN_WEIGHT -
        Math.max(0, c.royaltyPct - K.DEFAULT_ROYALTY_PCT) * K.MOOD_ROYALTY_WEIGHT -
        Math.max(0, c.adFundPct - K.DEFAULT_AD_FUND_PCT) * K.MOOD_AD_WEIGHT -
        Math.max(0, c.rentPctOfSales - K.DEFAULT_RENT_PCT) * K.MOOD_RENT_WEIGHT,
      0,
      100,
    );
    fr.mood = clamp(fr.mood + (target - fr.mood) * K.MOOD_DRIFT_PER_DAY, 0, 100);
  }
  for (const fr of e.franchisees.slice()) {
    if (fr.sites.length && fr.cash < K.FRANCHISEE_BANKRUPT_CASH) franchiseeBankrupt(x, fr);
  }

  // ── site drift, collapse line, remodels, inspections, rent reviews ──
  for (const s of e.sites) {
    if (s.status !== "open") continue;
    const city = x.city.get(s.cityId)!;
    const fr = s.franchisee ? x.fr.get(s.franchisee) : undefined;
    const t = standardTargets(e, s, fr, city);
    s.brandConsistency += (t.consistency - s.brandConsistency) * K.DRIFT_PER_DAY;
    s.staffQuality += (t.staff - s.staffQuality) * K.DRIFT_PER_DAY;
    // Subway's warning: below the line, operators can't cover their costs.
    const line = K.COLLAPSE_REVENUE_YEAR * e.hq.priceLevel;
    if (day - s.opened > COLLAPSE_MIN_AGE && s.revenueYear < line) {
      s.failingDays += 1;
      if (s.failingDays === 30) emit(x, "site_failing", `${s.name} is trading below ${pounds(line)} a year: operators fail down here.`, "bad", { siteId: s.id });
      if (s.failingDays > COLLAPSE_GRACE_DAYS && s.ownership !== "company" && fr) handBackKeys(x, s, fr, "trade below the collapse line");
    } else s.failingDays = 0;
    if (s.status !== "open") continue;
    if (s.contract && day - s.lastRemodel >= s.contract.remodelEveryDays) doRemodel(x, s, false);
    if (s.ownership !== "company" && day - (s.lastInspected ?? s.opened) >= e.inspectionEveryDays) inspect(x, s);
    if (day - s.rentReviewedDay >= K.RENT_REVIEW_DAYS) {
      const nr = Math.max(s.rent, marketRent(content, city, s.districtId, e.hq.priceLevel, plotRentMult(s.driveThru)));
      if (nr > s.rent) emit(x, "rent_review", `Rent review at ${s.name}: ${pounds(s.rent)} → ${pounds(nr)} a month.`, "info", { siteId: s.id });
      s.rent = nr;
      s.rentReviewedDay = day;
    }
  }

  // ── random events ──
  if (!opts.noEvents) randomEvents(x);

  // ── association ──
  const active = e.franchisees.filter((fr) => fr.sites.length > 0);
  const moodNow = avgFranchiseeMood(e);
  if (!e.association.active && active.length >= K.ASSOCIATION_MIN_FRANCHISEES && moodNow < K.ASSOCIATION_MOOD) {
    e.association = { active: true, formedDay: day };
    emit(x, "association", `Franchisees form an association (mood ${moodNow.toFixed(0)}). Royalty rises, forced remodels and discount campaigns are blocked until mood recovers above ${K.ASSOCIATION_DISSOLVE_MOOD}.`, "bad");
  } else if (e.association.active && (moodNow >= K.ASSOCIATION_DISSOLVE_MOOD || active.length < K.ASSOCIATION_MIN_FRANCHISEES)) {
    e.association = { active: false };
    emit(x, "association", "The franchisee association stands down: owners are happy enough again.", "good");
  }

  // ── HQ costs, property, inflation, solvency ──
  const nOpen = Object.values(sitesByRegion).reduce((a, b) => a + b, 0);
  hqNet -= (K.HQ_OVERHEAD_DAILY + K.HQ_OVERHEAD_PER_SITE_DAILY * nOpen) * e.hq.priceLevel;
  for (const p of e.property) {
    if (p.mortgageRemaining <= 0) continue;
    const pay = Math.min(p.mortgageDaily, p.mortgageRemaining);
    p.mortgageRemaining -= pay;
    hqNet -= pay;
  }
  if (e.hq.cash < 0) hqNet += (e.hq.cash * K.OVERDRAFT_APR) / K.DAYS_PER_YEAR;
  const net = Math.round(hqNet);
  e.hq.cash += net;
  e.hq.lastDayNet = net;
  e.hq.income30d = Math.round(e.hq.income30d * (29 / 30) + net);
  e.hq.priceLevel *= (1 + K.INFLATION) ** (1 / K.DAYS_PER_YEAR);
  if (e.hq.cash < -K.HQ_CREDIT_LINE * e.hq.priceLevel) {
    e.status = "bankrupt";
    emit(x, "bankrupt", `HQ is out of credit (${pounds(e.hq.cash)}). The banks call in the loans.`, "bad");
  }

  // ── meals, win, history ──
  const before = e.mealsServedTotal;
  e.mealsServedTotal += meals;
  for (const m of [1e6, 1e7, 1e8, 1e9]) {
    if (before < m && e.mealsServedTotal >= m) emit(x, "milestone", `${m.toLocaleString("en-GB")} meals served!`, "good");
  }
  updateWin(x, profitableByRegion, sitesByRegion);
  e.hq.day = day + 1;
  if ((day + 1) % 30 === 0) snapshot(e, day);
  const out = finish(x);
  return opts.trace ? { ...out, trace } : out;
}

/** Steps `days` days with no focused results (convenience for tests, headless and the demo). */
export function stepEmpireDays(content: ContentPack, empire: EmpireState, days: number, opts: StepOptions = {}): EmpireStepResult {
  let e = empire;
  const events: EmpireEvent[] = [];
  for (let i = 0; i < days && e.status === "running"; i++) {
    const r = stepEmpireDay(content, e, undefined, opts);
    e = r.empire;
    for (const ev of r.events) events.push(ev);
  }
  return { empire: e, events };
}

function snapshot(e: EmpireState, day: number): void {
  const open = openSites(e);
  const regs = e.regions.map((r) => e.brand.recognition[r.id] ?? 0);
  e.history.push({
    day,
    sites: open.length,
    company: open.filter((s) => s.ownership === "company").length,
    franchise: open.filter((s) => s.ownership === "franchise").length,
    licence: open.filter((s) => s.ownership === "licence").length,
    mealsServed: e.mealsServedTotal,
    hqCash: e.hq.cash,
    hqIncome: e.hq.income30d,
    systemSales: Math.round(open.reduce((a, s) => a + s.revenueYear, 0)),
    avgMood: Math.round(avgFranchiseeMood(e) * 10) / 10,
    avgRecognition: Math.round((regs.reduce((a, b) => a + b, 0) / Math.max(1, regs.length)) * 10) / 10,
  });
  if (e.history.length > K.MONTHLY_HISTORY_MAX) e.history = e.history.slice(-K.MONTHLY_HISTORY_MAX);
}

function updateWin(x: Ctx, profitable: Record<string, boolean>, present: Record<string, number>): void {
  const e = x.e;
  const won = e.regions.filter((r) => (e.brand.recognition[r.id] ?? 0) >= K.WIN_RECOGNITION && (present[r.id] ?? 0) > 0 && profitable[r.id]).map((r) => r.id);
  const solvent = e.hq.cash > -K.HQ_CREDIT_LINE * e.hq.priceLevel * 0.5 && e.status === "running";
  const moodOk = !e.association.active;
  const meals = e.mealsServedTotal >= K.WIN_MEALS;
  const regions = won.length === e.regions.length;
  const newlyWon = won.filter((r) => !e.win.regionsWon.includes(r));
  for (const r of newlyWon) emit(x, "milestone", `${e.regions.find((g) => g.id === r)!.name}: the brand is a household name (recognition ≥ ${K.WIN_RECOGNITION}).`, "good", { regionId: r });
  const achieved = e.win.achieved || (solvent && moodOk && (meals || regions));
  if (achieved && !e.win.achieved) emit(x, "win", meals ? "A billion meals served. The Empire is won." : "Present and profitable in every region. The Empire is won.", "good");
  e.win = {
    mealsTarget: K.WIN_MEALS,
    regionsWon: won,
    solvent,
    moodOk,
    achieved,
    ...(achieved ? { achievedDay: e.win.achievedDay ?? e.hq.day, reason: e.win.reason ?? (meals ? "meals" : "regions") } : {}),
  };
}

// ───────────────────────── site lifecycle ─────────────────────────
function detachFromFranchisee(x: Ctx, s: SiteSummary): void {
  if (!s.franchisee) return;
  const fr = x.fr.get(s.franchisee);
  if (fr) fr.sites = fr.sites.filter((id) => id !== s.id);
  delete s.franchisee;
}

/** Closes a site: HQ pays lease exit on HQ-held leases and sells owned plots at value. */
function closeSite(x: Ctx, s: SiteSummary, why: string): void {
  const e = x.e;
  if (s.status === "closed") return;
  if (s.land === "hqLease") e.hq.cash -= s.rent * 6;
  const pi = e.property.findIndex((p) => p.siteId === s.id);
  if (pi >= 0) {
    const p = e.property[pi]!;
    e.hq.cash += Math.round(p.purchasePrice * (e.hq.priceLevel / p.priceLevelAtPurchase)) - p.mortgageRemaining;
    e.property.splice(pi, 1);
    x.prop.delete(s.id);
  }
  detachFromFranchisee(x, s);
  s.status = "closed";
  s.focused = false;
  if (e.focusedSiteId === s.id) delete e.focusedSiteId;
  emit(x, "site_closed", `${s.name} closes (${why}).`, "bad", { siteId: s.id, cityId: s.cityId });
}

/** HQ takes a site over as company-owned, or closes it if HQ can't afford to run it. */
function handBackKeys(x: Ctx, s: SiteSummary, fr: Franchisee, why: string): void {
  const e = x.e;
  detachFromFranchisee(x, s);
  delete s.operatorLoan;
  delete s.contract;
  s.failingDays = 0;
  if (e.hq.cash > K.TAKEOVER_CASH_PER_SITE && s.revenueYear >= K.COLLAPSE_REVENUE_YEAR * e.hq.priceLevel * 0.8) {
    s.ownership = "company";
    if (s.land === "thirdParty") s.land = "hqLease";
    emit(x, "bought_back", `${fr.name} hands back the keys to ${s.name} (${why}); HQ runs it now.`, "bad", { siteId: s.id });
  } else {
    if (s.land === "thirdParty") s.land = "hqLease"; // the guarantee falls on HQ
    closeSite(x, s, `${fr.name} handed back the keys: ${why}`);
  }
}

function franchiseeBankrupt(x: Ctx, fr: Franchisee): void {
  emit(x, "franchisee_bankrupt", `${fr.name} goes bust with ${fr.sites.length} site${fr.sites.length === 1 ? "" : "s"}.`, "bad");
  for (const id of fr.sites.slice()) {
    const s = x.site.get(id);
    if (s && s.status === "open") handBackKeys(x, s, fr, "bankruptcy");
  }
  fr.cash = 0;
  for (const o of x.e.franchisees) if (o !== fr && o.sites.length) o.mood = clamp(o.mood - 3, 0, 100);
}

function doRemodel(x: Ctx, s: SiteSummary, forced: boolean): void {
  const e = x.e;
  const city = x.city.get(s.cityId)!;
  const cost = remodelCost(s, city, e.hq.priceLevel);
  const fr = s.franchisee ? x.fr.get(s.franchisee) : undefined;
  if (fr) {
    fr.cash -= cost;
    fr.mood = clamp(fr.mood - (forced ? K.MOOD_FORCED_REMODEL : K.MOOD_SCHEDULED_REMODEL), 0, 100);
  } else e.hq.cash -= cost;
  s.lastRemodel = e.hq.day;
  s.brandConsistency = clamp(s.brandConsistency + K.REMODEL_CONSISTENCY_BONUS, 0, 100);
  const addDrive = e.brand.formula.driveThru && !s.driveThru;
  if (addDrive) {
    s.driveThru = true;
    // The lane needs the bigger corner plot: the rent moves to the drive-thru plot's (round 5).
    s.rent = Math.max(s.rent, marketRent(x.content, city, s.districtId, e.hq.priceLevel, plotRentMult(true)));
  }
  emit(x, "remodel", `${s.name} remodelled for ${pounds(cost)}${fr ? ` (paid by ${fr.name}${forced ? ", forced" : ""})` : ""}${addDrive ? ", now with a drive-thru" : ""}.`, forced ? "bad" : "money", { siteId: s.id });
}

function inspect(x: Ctx, s: SiteSummary): void {
  const e = x.e;
  e.hq.cash -= K.INSPECTION_COST;
  s.lastInspected = e.hq.day;
  s.brandConsistency = clamp(s.brandConsistency + K.INSPECTION_CONSISTENCY_BONUS, 0, 100);
  if (s.unreported > 0 && s.franchisee) {
    const fr = x.fr.get(s.franchisee);
    if (fr && x.rng.chance(K.SKIM_CATCH_CHANCE)) {
      const owed = Math.round(s.unreported * (s.contract ? contractTake(s.contract) : 0.1) * K.SKIM_PENALTY_MULT);
      fr.cash -= owed;
      e.hq.cash += owed;
      fr.mood = clamp(fr.mood - K.MOOD_CAUGHT_SKIMMING, 0, 100);
      fr.honesty = clamp(fr.honesty + 15, 0, 100);
      emit(x, "skimming", `Inspection at ${s.name} finds ${pounds(s.unreported)} of unreported sales; ${fr.name} pays ${pounds(owed)} back.`, "money", { siteId: s.id });
    }
    s.unreported = 0;
  }
}

// ───────────────────────── random events ─────────────────────────
function randomEvents(x: Ctx): void {
  const e = x.e;
  const rng = x.rng;
  const day = e.hq.day;
  const open = openSites(e);
  if (!open.length) return;
  // Food-safety scandal: rarer with high consistency.
  const avgC = open.reduce((a, s) => a + s.brandConsistency, 0) / open.length;
  const scandalP = (K.SCANDAL_RATE_PER_YEAR / K.DAYS_PER_YEAR) * clamp(1.5 - avgC / 100, 0.3, 1.5) * Math.min(1, 0.3 + open.length / 20);
  if (rng.chance(scandalP)) startScandal(x, rng.pick(open), "a food-safety outbreak");
  // Supplier outages: single points of failure.
  for (const sup of e.suppliers) if (sup.signed && rng.chance(sup.failureRisk / K.DAYS_PER_YEAR)) supplierFailure(x, sup.id);
  // Geopolitics: forced exit from a foreign country.
  const home = x.city.get(e.hq.homeCityId)!;
  const countries = [...new Set(open.map((s) => x.city.get(s.cityId)!.country))].filter((c) => c !== home.country);
  for (const country of countries) if (rng.chance(K.FORCED_EXIT_CHANCE_PER_YEAR / K.DAYS_PER_YEAR)) forcedExit(x, country);
  // A franchisee's product idea (Filet-O-Fish).
  if (!e.pendingIdea) {
    const active = e.franchisees.filter((fr) => fr.sites.length);
    if (active.length && rng.chance((1 - Math.exp(-K.IDEA_CHANCE_PER_FRANCHISEE_YEAR * active.length)) / K.DAYS_PER_YEAR)) {
      const fr = rng.pick(active);
      const name = rng.pick(["Fish Friday Bun", "Breakfast Muffin", "Spicy Wrap", "Apple Turnover", "Veggie Stack"]);
      e.pendingIdea = { franchiseeId: fr.id, name, day };
      emit(x, "idea", `${fr.name} has been selling a "${name}" at their own counter and it's flying. Launch it brand-wide?`, "info");
    }
  }
  if (e.pendingIdea && day - e.pendingIdea.day > 120) delete e.pendingIdea;
  // Franchise applicants arrive by recognition and contract terms.
  e.applicants = e.applicants.filter((a) => day - a.arrivedDay < APPLICANT_EXPIRY_DAYS);
  const recs = e.regions.map((r) => e.brand.recognition[r.id] ?? 0);
  const rec = Math.max(...recs);
  const attract = contractAttractiveness(e.contract) * (e.association.active ? 0.5 : 1) * (0.4 + rec / 50);
  const rate = (K.APPLICANTS_BASE_PER_MONTH / 30) * attract;
  if (e.applicants.length < K.APPLICANT_POOL_MAX && rng.chance(rate)) {
    const a: Applicant = {
      id: newId(e, "a"),
      name: randomName(rng),
      competence: Math.round(clamp(rng.gaussian(55, 15), 10, 95)),
      honesty: Math.round(clamp(rng.gaussian(72, 18), 10, 100)),
      cash: Math.round(rng.int(10_000_000, 45_000_000) * e.hq.priceLevel),
      arrivedDay: day,
    };
    e.applicants.push(a);
    if (e.applicants.length <= 3) emit(x, "applicant", `${a.name} applies for a franchise (${pounds(a.cash)} to invest).`, "info");
  }
}

function startScandal(x: Ctx, s: SiteSummary, why: string): void {
  const e = x.e;
  const rng = x.rng;
  const city = x.city.get(s.cityId)!;
  const depth = K.SCANDAL_DEPTH[0] + (K.SCANDAL_DEPTH[1] - K.SCANDAL_DEPTH[0]) * rng.float();
  // Lower consistency → slower recovery (4 quarters at 100, 12 quarters at 0).
  const t = 1 - clamp(s.brandConsistency / 100, 0, 1);
  const recover = Math.round(K.SCANDAL_RECOVERY_DAYS[0] + (K.SCANDAL_RECOVERY_DAYS[1] - K.SCANDAL_RECOVERY_DAYS[0]) * (0.5 * t + 0.5 * rng.float()));
  e.effects.push({ id: newId(e, "fx"), kind: "scandal", label: `Scandal at ${s.name}`, startDay: e.hq.day, endDay: e.hq.day + recover, demand: -depth, regionId: city.regionId, siteId: s.id });
  e.hq.cash -= Math.round(K.SCANDAL_LEGAL_COST * e.hq.priceLevel);
  e.brand.recognition[city.regionId] = clamp((e.brand.recognition[city.regionId] ?? 0) - K.SCANDAL_RECOGNITION_HIT, 0, 100);
  for (const fr of e.franchisees) if (fr.sites.length) fr.mood = clamp(fr.mood - K.MOOD_SCANDAL, 0, 100);
  emit(
    x,
    "scandal",
    `Scandal: ${why} traced to ${s.name}. Same-store sales −${Math.round(depth * 100)}% in ${e.regions.find((r) => r.id === city.regionId)?.name ?? "the region"}, recovering over ${Math.round(recover / K.DAYS_PER_QUARTER)} quarters.`,
    "bad",
    { siteId: s.id, regionId: city.regionId },
  );
}

function supplierFailure(x: Ctx, supId: string, forceScandal = false): void {
  const e = x.e;
  const sup = e.suppliers.find((s) => s.id === supId);
  const open = openSites(e);
  if (!sup || !sup.signed || !open.length) return;
  const days = x.rng.int(...K.SUPPLIER_OUTAGE_DAYS);
  const hit = (1 - K.SUPPLIER_OUTAGE_DEMAND) * (sup.exclusive ? 1 : K.NON_EXCLUSIVE_IMPACT);
  e.effects.push({ id: newId(e, "fx"), kind: "supplierOutage", label: `${sup.name} outage`, startDay: e.hq.day, endDay: e.hq.day + days, demand: -hit, supplierId: sup.id });
  emit(x, "supplier_outage", `${sup.name} fails${sup.exclusive ? " — and you're exclusive with them" : ""}: items pulled from menus for ${days} days (−${Math.round(hit * 100)}% demand).`, "bad");
  if (forceScandal || x.rng.chance(K.SUPPLIER_SCANDAL_CHANCE * (sup.exclusive ? 1 : 0.5))) startScandal(x, x.rng.pick(open), `contaminated stock from ${sup.name}`);
}

function forcedExit(x: Ctx, country: string): void {
  const e = x.e;
  let n = 0;
  for (const s of e.sites) {
    if (s.status !== "open" || x.city.get(s.cityId)!.country !== country) continue;
    if (s.land === "hqLease") s.land = "thirdParty"; // the local buyer takes the leases over
    const pi = e.property.findIndex((p) => p.siteId === s.id);
    if (pi >= 0) {
      const p = e.property[pi]!;
      e.hq.cash += Math.round(p.purchasePrice * (e.hq.priceLevel / p.priceLevelAtPurchase) * K.FORCED_SALE_RECOVERY) - p.mortgageRemaining;
      e.property.splice(pi, 1);
      x.prop.delete(s.id);
    }
    if (s.ownership === "company") e.hq.cash += Math.round(buildCost(x.city.get(s.cityId)!, s.driveThru, e.hq.priceLevel) * K.FORCED_SALE_RECOVERY);
    detachFromFranchisee(x, s);
    s.status = "closed";
    s.focused = false;
    if (e.focusedSiteId === s.id) delete e.focusedSiteId;
    n++;
  }
  for (const c of e.cities) if (c.country === country) Object.assign(c, { entered: false, exited: true });
  emit(x, "forced_exit", `Sanctions force the brand out of ${country}: ${n} site${n === 1 ? "" : "s"} sold to a local buyer at a steep discount.`, "bad");
}

export type ForcedEvent =
  | { kind: "scandal"; siteId: string; why?: string }
  | { kind: "supplier_failure"; supplierId: string; withScandal?: boolean }
  | { kind: "forced_exit"; country: string };

/**
 * Fires a risk event now (story beats, tutorials, tests). The same code paths the random deck uses.
 */
export function forceEvent(content: ContentPack, empire: EmpireState, ev: ForcedEvent): EmpireStepResult {
  const e = draft(empire);
  const x = makeCtx(content, e);
  if (ev.kind === "scandal") {
    const s = x.site.get(ev.siteId);
    if (!s || s.status !== "open") return reject(empire, "No such open site.");
    startScandal(x, s, ev.why ?? "a food-safety outbreak");
  } else if (ev.kind === "supplier_failure") supplierFailure(x, ev.supplierId, ev.withScandal);
  else forcedExit(x, ev.country);
  return finish(x);
}

// ───────────────────────── commands ─────────────────────────
export const TECH_LABEL: Record<Tech, string> = { academy: "The training academy", driveThru: "Drive-thru", appOrdering: "App ordering" };

function reject(empire: EmpireState, why: string): EmpireStepResult {
  const ev: EmpireEvent = { day: empire.hq.day, kind: "rejected", text: why, tone: "bad" };
  return { empire, events: [ev] };
}

/** Why the franchisee association blocks a command (undefined = allowed). */
export function associationBlocks(e: EmpireState, cmd: EmpireCommand): string | undefined {
  if (!e.association.active) return undefined;
  if (cmd.type === "SET_CONTRACT" && cmd.applyTo === "all") {
    const next = { ...e.contract, ...cmd.contract };
    if (next.royaltyPct > e.contract.royaltyPct || next.adFundPct > e.contract.adFundPct || next.rentPctOfSales > e.contract.rentPctOfSales)
      return "The franchisee association blocks raising fees on existing agreements.";
  }
  if (cmd.type === "REMODEL") {
    const s = e.sites.find((x) => x.id === cmd.siteId);
    if (s && s.ownership !== "company") return "The franchisee association blocks forced remodels.";
  }
  if (cmd.type === "LAUNCH_CAMPAIGN" && cmd.kind === "discount") return "The franchisee association blocks discount campaigns: it's their margin.";
  if (cmd.type === "OPEN_SITE") {
    const crowd = e.sites.some((s) => s.status !== "closed" && s.ownership === "franchise" && s.cityId === cmd.cityId && s.districtId === cmd.districtId);
    if (crowd) return "The franchisee association blocks opening on top of an existing franchisee (encroachment).";
  }
  return undefined;
}

export function applyEmpireCommand(content: ContentPack, empire: EmpireState, cmd: EmpireCommand): EmpireStepResult {
  if (empire.status === "bankrupt") return reject(empire, "HQ is bankrupt.");
  const blocked = associationBlocks(empire, cmd);
  if (blocked) return reject(empire, blocked);
  const e = draft(empire);
  const x = makeCtx(content, e);
  const why = HANDLERS[cmd.type](x, cmd as never);
  if (why) return reject(empire, why);
  updateSaturation(e);
  return finish(x);
}

type Handler<T extends EmpireCommand["type"]> = (x: Ctx, cmd: Extract<EmpireCommand, { type: T }>) => string | undefined;

function takeFranchisee(x: Ctx, applicantId?: string, franchiseeId?: string): Franchisee | string {
  const e = x.e;
  if (franchiseeId) {
    const fr = x.fr.get(franchiseeId);
    if (!fr) return "No such franchisee.";
    if (fr.mood < K.MULTI_UNIT_MOOD) return `${fr.name} isn't happy enough to take another site (mood ${fr.mood.toFixed(0)}).`;
    if (fr.lastExpansionDay !== undefined && e.hq.day - fr.lastExpansionDay < K.MULTI_UNIT_COOLDOWN_DAYS) return `${fr.name} is still bedding in their last site.`;
    fr.lastExpansionDay = e.hq.day;
    return fr;
  }
  const a = e.applicants.find((p) => p.id === applicantId);
  if (!a) return "Pick an applicant or an existing franchisee.";
  e.applicants = e.applicants.filter((p) => p.id !== a.id);
  const fr: Franchisee = { id: newId(e, "f"), name: a.name, competence: a.competence, honesty: a.honesty, mood: 65, cash: a.cash, sites: [], joinedDay: e.hq.day, margin30d: K.MOOD_MARGIN_REF, lastExpansionDay: e.hq.day };
  e.franchisees.push(fr);
  x.fr.set(fr.id, fr);
  return fr;
}

function buyPlot(x: Ctx, s: SiteSummary): string | undefined {
  const e = x.e;
  if (e.property.some((p) => p.siteId === s.id)) return `${s.name}'s plot is already yours.`;
  const price = propertyPrice(s);
  const deposit = Math.round(price * K.PROPERTY_DEPOSIT_SHARE);
  if (spendable(e) < deposit) return `A ${pounds(deposit)} deposit is needed to buy ${s.name}'s plot (price ${pounds(price)}).`;
  e.hq.cash -= deposit;
  const loan = price - deposit;
  const days = K.MORTGAGE_YEARS * K.DAYS_PER_YEAR;
  const daily = annuityDaily(loan, K.MORTGAGE_APR, days);
  const holding: PropertyHolding = { siteId: s.id, purchasePrice: price, priceLevelAtPurchase: e.hq.priceLevel, mortgageRemaining: daily * days, mortgageDaily: daily, rentIncome: 0 };
  e.property.push(holding);
  x.prop.set(s.id, holding);
  s.land = "hqOwned";
  emit(x, "property", `Bought the plot under ${s.name} for ${pounds(price)} (${pounds(deposit)} down, mortgage ${pounds(daily * 30)}/month).`, "money", { siteId: s.id });
  return undefined;
}

const HANDLERS: { [T in EmpireCommand["type"]]: Handler<T> } = {
  OPEN_SITE: (x, cmd) => {
    const e = x.e;
    const city = x.city.get(cmd.cityId);
    if (!city) return "No such city.";
    if (!city.entered) return `Enter ${city.name} first.`;
    if (!city.districts.includes(cmd.districtId)) return `${city.name} has no ${cmd.districtId.replace("_", " ")} district.`;
    const region = e.regions.find((r) => r.id === city.regionId)!;
    if (e.brand.formula.fresh && !region.commissary) return `Fresh, never frozen: build a commissary in ${region.name} before opening there.`;
    const land: LandMode = cmd.ownership === "licence" ? "thirdParty" : cmd.ownership === "company" && cmd.land === "thirdParty" ? "hqLease" : cmd.land;
    const driveThru = e.brand.formula.driveThru && cmd.ownership !== "licence";
    const build = buildCost(city, driveThru, e.hq.priceLevel);
    const id = newId(e, "s");
    const s: SiteSummary = {
      id,
      name: cmd.name ?? siteName(x, city, cmd.districtId),
      cityId: city.id,
      districtId: cmd.districtId,
      opened: e.hq.day + BUILD_DAYS,
      status: "building",
      ownership: cmd.ownership,
      land,
      brandConsistency: e.brand.formula.standardisation + 10,
      staffQuality: 40,
      covers7d: 0,
      revenue7d: 0,
      margin7d: 0,
      revenueYear: e.calibration.source.revenue * K.DAYS_PER_YEAR,
      rent: marketRent(x.content, city, cmd.districtId, e.hq.priceLevel, plotRentMult(driveThru)),
      rentReviewedDay: e.hq.day,
      driveThru,
      lastRemodel: e.hq.day,
      footfallMods: [],
      saturationPenalty: 0,
      unreported: 0,
      failingDays: 0,
      mealsServed: 0,
    };
    if (cmd.ownership === "company") {
      if (spendable(e) < build) return `Building a site in ${city.name} costs ${pounds(build)}; HQ can spend ${pounds(spendable(e))}.`;
      e.hq.cash -= build;
    } else {
      if (cmd.ownership === "licence") {
        const setup = Math.round(K.LICENCE_SETUP_COST * city.costIndex * e.hq.priceLevel);
        if (spendable(e) < setup) return `A licence costs HQ ${pounds(setup)} to set up.`;
        e.hq.cash -= setup;
      }
      const fr = takeFranchisee(x, cmd.applicantId, cmd.franchiseeId);
      if (typeof fr === "string") return fr;
      const equity = Math.round(build * K.FRANCHISEE_EQUITY_SHARE);
      const fee = cmd.ownership === "licence" ? 0 : e.contract.fee;
      if (fr.cash < fee + equity) return `${fr.name} needs ${pounds(fee + equity)} (fee + equity) and has ${pounds(fr.cash)}.`;
      fr.cash -= fee + equity;
      e.hq.cash += fee;
      const days = K.OPERATOR_LOAN_YEARS * K.DAYS_PER_YEAR;
      const daily = annuityDaily(build - equity, K.OPERATOR_LOAN_APR, days);
      s.operatorLoan = { remaining: daily * days, daily };
      s.franchisee = fr.id;
      s.contract = siteContract(e.contract, e.hq.day, cmd.ownership);
      fr.sites.push(id);
      emit(x, "franchise_sold", `${fr.name} signs for ${s.name}: ${pounds(fee)} fee to HQ.`, "money", { siteId: id });
    }
    e.sites.push(s);
    x.site.set(id, s);
    if (land === "hqOwned") {
      const err = buyPlot(x, s);
      if (err) return err;
    }
    emit(x, "site_opened", `Building ${s.name} (${cmd.ownership}${driveThru ? ", drive-thru" : ""}); opens in ${BUILD_DAYS} days.`, "info", { siteId: id, cityId: city.id });
    return undefined;
  },

  SELL_FRANCHISE: (x, cmd) => {
    const e = x.e;
    const s = x.site.get(cmd.siteId);
    if (!s || s.status === "closed") return "No such site.";
    if (s.ownership !== "company") return `${s.name} is already ${s.ownership === "franchise" ? "franchised" : "licensed"}.`;
    if (s.focused) return "Unfocus the site before selling it.";
    const fr = takeFranchisee(x, cmd.applicantId, cmd.franchiseeId);
    if (typeof fr === "string") return fr;
    const city = x.city.get(s.cityId)!;
    const book = Math.round(buildCost(city, s.driveThru, e.hq.priceLevel) * clamp(1 - (e.hq.day - s.lastRemodel) / (10 * K.DAYS_PER_YEAR), 0.2, 1));
    const equity = Math.round(book * K.FRANCHISEE_EQUITY_SHARE);
    if (fr.cash < e.contract.fee + equity) return `${fr.name} needs ${pounds(e.contract.fee + equity)} and has ${pounds(fr.cash)}.`;
    fr.cash -= e.contract.fee + equity;
    e.hq.cash += e.contract.fee + book;
    const days = K.OPERATOR_LOAN_YEARS * K.DAYS_PER_YEAR;
    const daily = annuityDaily(book - equity, K.OPERATOR_LOAN_APR, days);
    s.operatorLoan = { remaining: daily * days, daily };
    s.ownership = "franchise";
    s.franchisee = fr.id;
    s.contract = siteContract(e.contract, e.hq.day, "franchise");
    fr.sites.push(s.id);
    emit(x, "franchise_sold", `Refranchised ${s.name} to ${fr.name} for ${pounds(e.contract.fee + book)}.`, "money", { siteId: s.id });
    return undefined;
  },

  BUY_BACK: (x, cmd) => {
    const e = x.e;
    const s = x.site.get(cmd.siteId);
    if (!s || s.status !== "open" || s.ownership === "company") return "Only an open franchised or licensed site can be bought back.";
    const fr = s.franchisee ? x.fr.get(s.franchisee) : undefined;
    const annualOp = Math.max(0, (s.margin7d / 7) * K.DAYS_PER_YEAR * 0.5);
    const price = Math.round(2.5 * annualOp + (s.operatorLoan?.remaining ?? 0));
    if (spendable(e) < price) return `Buying back ${s.name} costs ${pounds(price)}.`;
    e.hq.cash -= price;
    if (fr) fr.cash += price - (s.operatorLoan?.remaining ?? 0);
    detachFromFranchisee(x, s);
    delete s.operatorLoan;
    delete s.contract;
    s.ownership = "company";
    if (s.land === "thirdParty") s.land = "hqLease";
    emit(x, "bought_back", `Bought ${s.name} back for ${pounds(price)}.`, "money", { siteId: s.id });
    return undefined;
  },

  SET_CONTRACT: (x, cmd) => {
    const e = x.e;
    const c = cmd.contract;
    const next: FranchiseContract = {
      fee: Math.round(clamp(c.fee ?? e.contract.fee, ...K.FEE_RANGE)),
      royaltyPct: clamp(c.royaltyPct ?? e.contract.royaltyPct, ...K.ROYALTY_RANGE),
      adFundPct: clamp(c.adFundPct ?? e.contract.adFundPct, ...K.AD_FUND_RANGE),
      rentPctOfSales: clamp(c.rentPctOfSales ?? e.contract.rentPctOfSales, ...K.RENT_PCT_RANGE),
      termDays: Math.round(clamp(c.termDays ?? e.contract.termDays, 5 * K.DAYS_PER_YEAR, 30 * K.DAYS_PER_YEAR)),
      remodelEveryDays: Math.round(clamp(c.remodelEveryDays ?? e.contract.remodelEveryDays, 3 * K.DAYS_PER_YEAR, 30 * K.DAYS_PER_YEAR)),
    };
    const royaltyRisePp = Math.max(0, (next.royaltyPct - e.contract.royaltyPct) * 100);
    e.contract = next;
    if (cmd.applyTo === "all") {
      for (const s of e.sites) {
        if (s.ownership !== "franchise" || s.status === "closed" || !s.contract) continue;
        s.contract = { ...s.contract, royaltyPct: next.royaltyPct, adFundPct: next.adFundPct, rentPctOfSales: next.rentPctOfSales, remodelEveryDays: next.remodelEveryDays };
      }
      for (const fr of e.franchisees) if (fr.sites.length) fr.mood = clamp(fr.mood - royaltyRisePp * K.MOOD_ROYALTY_RISE_SHOCK, 0, 100);
    }
    emit(x, "contract", `New terms${cmd.applyTo === "all" ? " for every franchisee" : " for new agreements"}: fee ${pounds(next.fee)}, royalty ${(next.royaltyPct * 100).toFixed(1)}%, ad fund ${(next.adFundPct * 100).toFixed(1)}%, rent ${(next.rentPctOfSales * 100).toFixed(0)}% of sales.`, "info");
    return undefined;
  },

  BUY_PROPERTY: (x, cmd) => {
    const s = x.site.get(cmd.siteId);
    if (!s || s.status === "closed") return "No such site.";
    if (s.ownership === "licence") return "Licensed sites sit on the host's land (airports, campuses).";
    return buyPlot(x, s);
  },

  SET_FORMULA: (x, cmd) => {
    const e = x.e;
    const f = e.brand.formula;
    if (cmd.menuDishIds) {
      const known = new Set(x.content.dishes.map((d) => d.id));
      const bad = cmd.menuDishIds.filter((d) => !known.has(d));
      if (bad.length) return `Unknown dishes: ${bad.join(", ")}.`;
      if (!cmd.menuDishIds.length) return "The formula needs at least one dish.";
      const changed = cmd.menuDishIds.join() !== f.menuDishIds.join();
      f.menuDishIds = cmd.menuDishIds.slice();
      // Every deviation costs consistency while the sites retrain.
      if (changed && f.locked) for (const s of e.sites) s.brandConsistency = clamp(s.brandConsistency - 8, 0, 100);
    }
    if (cmd.locked !== undefined) {
      if (!cmd.locked && (f.academy || f.driveThru || f.appOrdering)) return "The academy, drive-thru and app are built on a locked formula.";
      f.locked = cmd.locked;
    }
    if (cmd.fresh !== undefined) f.fresh = cmd.fresh;
    if (cmd.priceIndex !== undefined) f.priceIndex = clamp(cmd.priceIndex, ...K.PRICE_INDEX_RANGE);
    f.standardisation = standardisation(f);
    emit(x, "formula", `Formula updated: ${f.menuDishIds.length} dishes, standardisation ${f.standardisation}${f.fresh ? ", fresh never frozen" : ""}, prices ×${f.priceIndex.toFixed(2)}.`, "info");
    return undefined;
  },

  RESEARCH: (x, cmd) => {
    const e = x.e;
    const f = e.brand.formula;
    const t = K.TECH[cmd.tech];
    if (!t) return "Unknown research.";
    if (f[cmd.tech]) return `${TECH_LABEL[cmd.tech]} is already done.`;
    if (e.brand.research) return `Already researching ${TECH_LABEL[e.brand.research.tech]}.`;
    if (!f.locked) return "Lock the formula first: standardisation starts with one menu, one kitchen, one script.";
    if (t.requires && !f[t.requires]) return `${TECH_LABEL[cmd.tech]} needs ${TECH_LABEL[t.requires]} first.`;
    const cost = Math.round(t.cost * e.hq.priceLevel);
    if (spendable(e) < cost) return `${TECH_LABEL[cmd.tech]} costs ${pounds(cost)}.`;
    e.hq.cash -= cost;
    e.brand.research = { tech: cmd.tech, daysLeft: t.days };
    emit(x, "research", `Started ${TECH_LABEL[cmd.tech]} (${pounds(cost)}, ${t.days} days).`, "money");
    return undefined;
  },

  SIGN_SUPPLIER: (x, cmd) => {
    const s = x.e.suppliers.find((p) => p.id === cmd.supplierId);
    if (!s) return "No such supplier.";
    s.signed = true;
    s.exclusive = cmd.exclusive;
    s.signedDay = x.e.hq.day;
    emit(x, "supplier", `Signed ${s.name}${cmd.exclusive ? " exclusively" : ""}: food costs −${((s.discountPct * (cmd.exclusive ? 1 : K.NON_EXCLUSIVE_SHARE)) * 100).toFixed(1)}%.`, "info");
    return undefined;
  },

  LAUNCH_CAMPAIGN: (x, cmd) => {
    const e = x.e;
    if (!(cmd.budget > 0)) return "A campaign needs a budget.";
    if (spendable(e) < cmd.budget) return `HQ can't fund a ${pounds(cmd.budget)} campaign.`;
    if (cmd.regionId && !e.regions.some((r) => r.id === cmd.regionId)) return "No such region.";
    e.hq.cash -= Math.round(cmd.budget);
    const day = e.hq.day;
    const base = { id: newId(e, "fx"), startDay: day, endDay: day + K.CAMPAIGN_DAYS, ...(cmd.regionId ? { regionId: cmd.regionId } : {}) };
    if (cmd.kind === "discount") {
      e.effects.push({ ...base, kind: "discount", label: "Discount campaign", demand: K.DISCOUNT_DEMAND - 1, spend: K.DISCOUNT_SPEND - 1 });
      for (const fr of e.franchisees) if (fr.sites.length) fr.mood = clamp(fr.mood - K.MOOD_DISCOUNT_CAMPAIGN, 0, 100);
    } else {
      const fx = { ...base, kind: "campaign" as const, label: "Brand campaign", demand: 0.03, budgetPerDay: cmd.budget / K.CAMPAIGN_DAYS };
      e.effects.push(fx);
    }
    emit(x, "campaign", `${cmd.kind === "discount" ? "Discount" : "Brand"} campaign launched (${pounds(cmd.budget)}).${cmd.kind === "discount" ? " Franchisees grumble about margins." : ""}`, "money");
    return undefined;
  },

  ENTER_CITY: (x, cmd) => {
    const e = x.e;
    const city = x.city.get(cmd.cityId);
    if (!city) return "No such city.";
    if (city.exited) return `${city.country} has closed its doors to the brand.`;
    if (city.entered) return `Already in ${city.name}.`;
    const newCountry = !e.cities.some((c) => c.entered && c.country === city.country);
    const cost = cityEntryCost(e, city);
    if (spendable(e) < cost) return `Entering ${city.name} costs ${pounds(cost)}${newCountry ? " (new country: permits, a local office, supply chain)" : ""}.`;
    e.hq.cash -= cost;
    city.entered = true;
    const notes: string[] = [];
    if (city.dietaryRules.length) notes.push(`dietary rules: ${city.dietaryRules.join(", ")}${menuBreaksRules(x.content, e.brand.formula.menuDishIds, city.dietaryRules) ? " — your menu breaks them; localise or lose appeal" : ""}`);
    if (city.localChampion) notes.push(`local champion: ${city.localChampion}`);
    emit(x, "city_entered", `Entered ${city.name}, ${city.country} (${pounds(cost)}).${notes.length ? " " + notes.join("; ") + "." : ""}`, "money", { cityId: city.id });
    return undefined;
  },

  LOCALISE_MENU: (x, cmd) => {
    const e = x.e;
    const city = x.city.get(cmd.cityId);
    if (!city || !city.entered) return "Enter the city first.";
    if (city.localised) return `${city.name} already has a local menu.`;
    const cost = Math.round(K.LOCALISE_COST * Math.max(0.6, city.costIndex) * e.hq.priceLevel);
    if (spendable(e) < cost) return `Localising costs ${pounds(cost)}.`;
    e.hq.cash -= cost;
    city.localised = true;
    emit(x, "localised", `${city.name} gets a local menu (${pounds(cost)}); consistency there dips a little.`, "money", { cityId: city.id });
    if (x.rng.chance(K.TRADITION_CHANCE)) {
      city.tradition = true;
      e.brand.recognition[city.regionId] = clamp((e.brand.recognition[city.regionId] ?? 0) + K.TRADITION_RECOGNITION, 0, 100);
      emit(x, "tradition", `A new tradition: in ${city.name} your local special becomes what families eat on holidays.`, "good", { cityId: city.id });
    }
    return undefined;
  },

  LAUNCH_PRODUCT: (x, cmd) => {
    const e = x.e;
    if (!(cmd.budget > 0)) return "A launch needs a budget.";
    if (spendable(e) < cmd.budget) return `HQ can't fund a ${pounds(cmd.budget)} launch.`;
    if (cmd.fit === "franchiseeIdea" && !e.pendingIdea) return "No franchisee idea is waiting.";
    e.hq.cash -= Math.round(cmd.budget);
    const p = clamp(K.PRODUCT_SUCCESS[cmd.fit] + Math.min(0.15, (cmd.budget / K.PRODUCT_BUDGET_REF) * 0.1), 0.05, 0.9);
    const day = e.hq.day;
    const name = cmd.fit === "franchiseeIdea" ? e.pendingIdea!.name : cmd.name;
    if (cmd.fit === "franchiseeIdea") {
      const fr = x.fr.get(e.pendingIdea!.franchiseeId);
      if (fr) fr.mood = clamp(fr.mood + 10, 0, 100);
      delete e.pendingIdea;
    }
    if (x.rng.chance(p)) {
      e.effects.push({ id: newId(e, "fx"), kind: "product", label: `${name} hit`, startDay: day, endDay: day + K.PRODUCT_HIT_DAYS, demand: K.PRODUCT_HIT_BOOST, budgetPerDay: cmd.budget / K.PRODUCT_HIT_DAYS });
      e.brand.permanentDemand = Math.min(K.PERMANENT_DEMAND_CAP, e.brand.permanentDemand * (1 + K.PRODUCT_HIT_PERMANENT));
      emit(x, "product", `The ${name} is a hit: +${Math.round(K.PRODUCT_HIT_BOOST * 100)}% demand for a year, and it stays on the menu.`, "good");
    } else {
      e.effects.push({ id: newId(e, "fx"), kind: "product", label: `${name} flop`, startDay: day, endDay: day + K.PRODUCT_FLOP_DAYS, demand: -K.PRODUCT_FLOP_HIT });
      for (const r of e.regions) e.brand.recognition[r.id] = clamp((e.brand.recognition[r.id] ?? 0) - K.PRODUCT_RECOGNITION_FLOP, 0, 100);
      emit(x, "product", `The ${name} flops: it fights what customers think the brand is. ${pounds(cmd.budget)} gone, demand −${Math.round(K.PRODUCT_FLOP_HIT * 100)}% for six months.`, "bad");
    }
    return undefined;
  },

  CLOSE_SITE: (x, cmd) => {
    const s = x.site.get(cmd.siteId);
    if (!s || s.status === "closed") return "No such site.";
    if (s.franchisee) {
      const fr = x.fr.get(s.franchisee);
      // HQ pays out the operator's loan as compensation.
      x.e.hq.cash -= s.operatorLoan?.remaining ?? 0;
      if (fr) for (const o of x.e.franchisees) if (o.sites.length) o.mood = clamp(o.mood - (o === fr ? 15 : 3), 0, 100);
    }
    closeSite(x, s, "HQ decision");
    return undefined;
  },

  REMODEL: (x, cmd) => {
    const s = x.site.get(cmd.siteId);
    if (!s || s.status !== "open") return "Only an open site can be remodelled.";
    const cost = remodelCost(s, x.city.get(s.cityId)!, x.e.hq.priceLevel);
    if (s.ownership === "company" && spendable(x.e) < cost) return `Remodelling ${s.name} costs ${pounds(cost)}.`;
    doRemodel(x, s, s.ownership !== "company");
    return undefined;
  },

  BUILD_COMMISSARY: (x, cmd) => {
    const e = x.e;
    const r = e.regions.find((g) => g.id === cmd.regionId);
    if (!r) return "No such region.";
    if (r.commissary) return `${r.name} already has a commissary.`;
    const cost = Math.round(K.COMMISSARY_COST * e.hq.priceLevel);
    if (spendable(e) < cost) return `A commissary costs ${pounds(cost)}.`;
    e.hq.cash -= cost;
    r.commissary = true;
    emit(x, "formula", `Commissary built in ${r.name} (${pounds(cost)}): fresh deliveries every morning.`, "money", { regionId: r.id });
    return undefined;
  },

  SET_INSPECTIONS: (x, cmd) => {
    x.e.inspectionEveryDays = Math.round(clamp(cmd.everyDays, 30, 720));
    emit(x, "inspection", `Mystery inspections every ${x.e.inspectionEveryDays} days.`, "info");
    return undefined;
  },

  TRANSFER_FROM_FOCUSED: (x, cmd) => {
    if (!(cmd.amount > 0)) return "Transfer a positive amount.";
    x.e.hq.cash += Math.round(cmd.amount);
    emit(x, "transfer", `${pounds(cmd.amount)} moved from the flagship's till to HQ.`, "money");
    return undefined;
  },

  FOCUS_SITE: (x, cmd) => {
    const e = x.e;
    if (cmd.siteId) {
      const s = x.site.get(cmd.siteId);
      if (!s || s.status !== "open") return "Only an open site can be focused.";
    }
    for (const s of e.sites) s.focused = s.id === cmd.siteId;
    if (cmd.siteId) e.focusedSiteId = cmd.siteId;
    else delete e.focusedSiteId;
    emit(x, "focus", cmd.siteId ? `Now running ${x.site.get(cmd.siteId)!.name} hands-on.` : "Back to the map.", "info", cmd.siteId ? { siteId: cmd.siteId } : {});
    return undefined;
  },
};

/** Expected covers/day for a site today with no noise (UI forecasts, and the calibration test). */
export function expectedSiteDay(content: ContentPack, e: EmpireState, siteId: string): SiteDayResult {
  const s = e.sites.find((x) => x.id === siteId);
  if (!s) throw new Error(`No site ${siteId}`);
  const city = e.cities.find((c) => c.id === s.cityId)!;
  const fx = effectMultipliers(e, e.hq.day);
  return aggregateSiteDay(content, s, e.brand, city, new Rng([1, 2, 3, 4]), {
    day: e.hq.day,
    calibration: e.calibration,
    priceLevel: e.hq.priceLevel,
    demandMult: fx.demand[city.regionId],
    spendMult: fx.spend[city.regionId],
    foodMult: supplierFoodMult(e),
    breaksRules: !city.localised && menuBreaksRules(content, e.brand.formula.menuDishIds, city.dietaryRules),
    noise: false,
  });
}

/** Scales the covers, sales and food of a focused DayResult by the off-premise multiplier (1 = unchanged). */
function withOffPremise(r: SiteDayResult, mult: number, labourMult: number): SiteDayResult {
  if (mult === 1) return r;
  const covers = Math.round(r.covers * mult);
  const revenue = Math.round(r.revenue * mult);
  const vat = Math.round(r.vat * mult);
  const foodCost = Math.round(r.foodCost * mult);
  const labourCost = Math.round(r.labourCost * labourMult);
  return { ...r, covers, revenue, vat, foodCost, labourCost, contribution: revenue - vat - foodCost - labourCost - r.overheads };
}

/** Brand pull on one site today (the "brand" footfall mod newGameFromSite and the game's evening hook give the sim). */
export function siteBrandPull(content: ContentPack, e: EmpireState, siteId: string): number {
  const s = e.sites.find((x) => x.id === siteId);
  if (!s) throw new Error(`No site ${siteId}`);
  const city = e.cities.find((c) => c.id === s.cityId)!;
  const fx = effectMultipliers(e, e.hq.day);
  return brandPull(content, s, e.brand, city, {
    day: e.hq.day,
    demandMult: fx.demand[city.regionId],
    breaksRules: !city.localised && menuBreaksRules(content, e.brand.formula.menuDishIds, city.dietaryRules),
  });
}

/**
 * Re-fits the model to a focused site's DayResults. With the site's GameState, the fit sees its menu, tables, rota,
 * popularity and the brand pull it traded under, so demandScale stays a property of the sim rather than of the site;
 * costs are normalised back to the reference (cost index, price level, price index), so other sites keep their own
 * factors and the focused site keeps its numbers when demoted.
 */
export function recalibrateFromSite(content: ContentPack, e: EmpireState, siteId: string, history: readonly DayResult[], state?: GameState): EmpireState {
  const s = e.sites.find((x) => x.id === siteId);
  if (!s) throw new Error(`No site ${siteId}`);
  const city = e.cities.find((c) => c.id === s.cityId)!;
  const pull = state ? state.footfallMods.filter((m) => m.source === K.BRAND_PULL_SOURCE).reduce((a, m) => a * m.mult, 1) : siteBrandPull(content, e, siteId);
  const raw = calibrate(content, history, {
    districtId: s.districtId,
    pull,
    ...(state ? { state } : { menu: brandMenu(content, e.brand.formula) }),
  });
  const f = e.brand.formula;
  const pl = e.hq.priceLevel;
  const spendNorm = clamp(f.priceIndex, ...K.PRICE_INDEX_RANGE) * city.costIndex * pl * (f.appOrdering ? K.APP_SPEND : 1);
  const foodNorm = city.costIndex ** 0.6 * pl * (f.fresh ? K.FRESH_FOOD_COST : 1) * supplierFoodMult(e);
  const appSpend = f.appOrdering ? K.APP_SPEND : 1;
  const foodRef = city.costIndex ** 0.6 * pl * (f.fresh ? K.FRESH_FOOD_COST : 1) * supplierFoodMult(e);
  const cal: CalibrationParams = {
    ...raw,
    ...(raw.spendScale !== undefined ? { spendScale: raw.spendScale / (city.costIndex * pl * appSpend) } : {}),
    ...(raw.foodScale !== undefined ? { foodScale: raw.foodScale / foodRef } : {}),
    spendPerCover: Math.round(raw.spendPerCover / spendNorm),
    foodPerCover: Math.round(raw.foodPerCover / foodNorm),
    labourPerDay: Math.round(raw.labourPerDay / (city.costIndex * pl)),
    overheadsFixed: Math.round(raw.overheadsFixed / (city.costIndex * pl)),
  };
  const sites = state ? e.sites.map((x) => (x.id === siteId ? { ...x, tables: state.tables.length, ...ownRoom(content, state) } : x)) : e.sites;
  return { ...e, sites, calibration: cal };
}

export interface SiteGameOptions {
  difficulty?: GameState["difficulty"];
  /** Opening till (pence). Default £20k: a running branch, not a start-up. */
  cash?: number;
}

/**
 * A fresh sim-core GameState for an Empire site, matching what the model assumes for it (P2, round 3): the site's
 * district and name, the brand menu at the formula's price index, the brand's box of tables (or the site's own), a
 * locally hired standard crew of the site's staff quality (two chefs and two servers on rotas A and B), the
 * popularity the model trades at, no loan, and the brand pull as a "brand" footfall mod. Deterministic in `rng`.
 */
export function newGameFromSite(content: ContentPack, e: EmpireState, site: SiteSummary, rng: Rng, opts: SiteGameOptions = {}): GameState {
  const day = e.hq.day;
  let g = newGame(content, { type: "NEW_GAME", seed: rng.int(1, 0x7fff_ffff), districtId: site.districtId, restaurantName: site.name, difficulty: opts.difficulty ?? "normal" });
  const tablesN = siteTables(content, site, e.brand);
  const seats = content.balance.seatsPerTable;
  g = {
    ...g,
    day,
    cash: opts.cash ?? 2_000_000,
    loan: { principal: 0, remaining: 0, dailyPayment: 0, daysRemaining: 0 },
    goals: [],
    tables: Array.from({ length: tablesN }, (_, i) => ({ id: `T${i + 1}`, seats, dirtyTicks: 0 })),
    reputation: { popularity: Math.round(sitePopularity(site) * 10) / 10, prestige: Math.round(sitePrestige(site) * 10) / 10 },
    log: [{ day, tick: 0, text: `You're running ${site.name} hands-on: the brand menu, ${tablesN} tables and a local crew.`, kind: "info" }],
  };
  for (const item of brandMenu(content, e.brand.formula)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: item.dishId, price: item.price }).state;
  g = { ...g, staff: localCrew(content, site, rng, day) };
  const pull = siteBrandPull(content, e, site.id);
  if (Math.abs(pull - 1) > 0.005) g = setFootfallMod(g, K.BRAND_PULL_SOURCE, { mult: Math.round(pull * 1000) / 1000, daysRemaining: K.BRAND_PULL_DAYS });
  // A running branch has a stocked larder: the forecast's needs plus a day's buffer, delivered yesterday.
  const stock: Stock[] = forecastNeeds(content, g).map(({ ingredientId, need }) => {
    const qty = Math.ceil(need * K.BRANCH_STOCK_DAYS);
    return { ingredientId, qty, oldestDay: day - 1, batches: [{ qty, day: day - 1 }] };
  });
  return { ...g, stock };
}

/** Two chefs and two servers hired locally around the site's staff quality, on the standard rotas. */
function localCrew(content: ContentPack, site: SiteSummary, rng: Rng, day: number): Staff[] {
  const q = clamp(site.staffQuality, 0, 100);
  const out: Staff[] = [];
  const roles: { role: "chef" | "server"; rota: readonly boolean[] }[] = [
    { role: "chef", rota: K.CREW_ROTA_A },
    { role: "chef", rota: K.CREW_ROTA_B },
    { role: "server", rota: K.CREW_ROTA_A },
    { role: "server", rota: K.CREW_ROTA_B },
  ];
  roles.forEach(({ role, rota }, i) => {
    const pool = content.staffArchetypes.filter((a) => a.role === role);
    const names = pool.flatMap((a) => a.nameSamples);
    const skill = Math.round(clamp(q + rng.gaussian(0, 4), 5, 95));
    out.push({
      id: `${site.id}-${role}${i % 2 === 0 ? "a" : "b"}`,
      name: names.length ? rng.pick(names) : role === "chef" ? "Sam" : "Alex",
      role,
      skill,
      speed: Math.round(clamp(60 + rng.gaussian(0, 6), 30, 90)),
      charm: Math.round(clamp((role === "server" ? 62 : 40) + rng.gaussian(0, 6), 10, 95)),
      wage: crewWage(skill, role),
      mood: 70,
      fatigue: 0,
      traits: [],
      hiredDay: day,
      potential: Math.min(100, skill + 10),
      rota: rota.slice(),
    });
  });
  return out;
}

export { calibrate };
