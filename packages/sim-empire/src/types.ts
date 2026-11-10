/**
 * @full-plate/sim-empire — the contract for Path A (the Empire).
 *
 * Conventions match sim-core: integer pence, a day is the unit, all randomness from the seeded RNG stored
 * in the state, pure functions returning new state. The empire is many sites: at most one is "focused"
 * (a full sim-core GameState the player watches); the rest are aggregate summaries stepped by a
 * closed-form model calibrated against the focused sim.
 */
import type { DayResult, DishId, DistrictId, Pence } from "@full-plate/sim-core";

export type { DayResult, DishId, DistrictId, Pence };
export type SiteId = string;
export type FranchiseeId = string;
export type ApplicantId = string;
export type CityId = string;
export type RegionId = string;
export type SupplierId = string;

/** The ownership slider: company-owned (control, capital), franchised (growth, less control), licensed (airports, campuses). */
export type Ownership = "company" | "franchise" | "licence";
/**
 * Who controls the plot. thirdParty: the operator leases from an outside landlord. hqLease: HQ holds the head
 * lease and sublets to the operator (Sonneborn). hqOwned: HQ bought the plot (landlord mode).
 * Company sites are always hqLease or hqOwned; licences are always thirdParty.
 */
export type LandMode = "thirdParty" | "hqLease" | "hqOwned";
export type SiteStatus = "building" | "open" | "closed";
export type Tech = "academy" | "driveThru" | "appOrdering";
export type DietaryRule = "no-beef" | "no-pork" | "halal" | "kosher";

/** The terms of one franchise agreement, frozen when signed (contract changes apply at renewal unless forced). */
export interface SiteContract {
  royaltyPct: number;
  adFundPct: number;
  /** Rent on HQ-controlled land as a share of sales; HQ charges max(this × sales, cost × (1 + RENT_COST_MARKUP)). */
  rentPctOfSales: number;
  signedDay: number;
  termDays: number;
  remodelEveryDays: number;
}

export interface SiteSummary {
  id: SiteId;
  name: string;
  cityId: CityId;
  /** A sim-core district archetype id (student_quarter, high_street, ...): footfall, season and rent come from it. */
  districtId: DistrictId;
  /** Day the site opened (or will open while building). */
  opened: number;
  status: SiteStatus;
  ownership: Ownership;
  franchisee?: FranchiseeId;
  land: LandMode;
  /** Present on franchise and licence sites. */
  contract?: SiteContract;
  /** 0-100: how closely the site follows the formula. Drifts toward a target set by standardisation, staff and operator. */
  brandConsistency: number;
  /** 0-100. */
  staffQuality: number;
  /** 7-day exponential sums (sum ≈ last 7 days at steady state): x7d ← x7d × 6/7 + today. */
  covers7d: number;
  revenue7d: Pence;
  /** Site-level profit after occupancy, before royalties and ad fund. */
  margin7d: Pence;
  /** Annualised takings (EMA of daily revenue × 360); the Subway collapse line reads this. */
  revenueYear: Pence;
  /** Market rent for the plot, pence per month (set at opening, reviewed every RENT_REVIEW_DAYS). */
  rent: Pence;
  rentReviewedDay: number;
  driveThru: boolean;
  lastRemodel: number;
  /**
   * [round 5] Day the site first traded: its ramp-up and honeymoon run from here (EMPIRE-NOTES §3). Absent on the
   * founder's flagship (a two-year-old room) and on pre-round-5 saves, which trade at run-rate.
   */
  openedTrading?: number;
  /**
   * [round 6] Days of age a refurbishment bought back (REFURBISH): the maturity drag reads the site's trading age minus
   * this. Absent = never refurbished.
   */
  refurbDays?: number;
  /** Temporary demand multipliers on this site (roadworks, events...). */
  footfallMods: { mult: number; daysRemaining: number; reason: string }[];
  /** 0-1: share of demand lost to the brand's own neighbours in the city (recomputed daily). */
  saturationPenalty: number;
  lastInspected?: number;
  /** Sales hidden by a dishonest franchisee since the last inspection (pence). */
  unreported: Pence;
  /** Consecutive days below the collapse line (franchisees hand back the keys after COLLAPSE_GRACE_DAYS). */
  failingDays: number;
  /** The operator's bank loan for the build (franchise sites). */
  operatorLoan?: { remaining: Pence; daily: Pence };
  mealsServed: number;
  /** True while this site is the focused sim-core restaurant; its numbers come from DayResults, not the model. */
  focused?: boolean;
  /** [round 3] Tables in the dining room when it differs from the brand's standard box (the flagship's own room). */
  tables?: number;
  /** [round 3] Popularity (0–100) the site last traded at hands-on; without it the model uses its staff quality's. */
  popularity?: number;
  /** [round 3] Prestige (0–100) the site last traded at hands-on; without it the model uses its staff quality's. */
  prestige?: number;
}

export interface Franchisee {
  id: FranchiseeId;
  name: string;
  competence: number;      // 0-100
  honesty: number;         // 0-100
  mood: number;            // 0-100
  cash: Pence;
  sites: SiteId[];
  joinedDay: number;
  /** EMA (MOOD_MARGIN_EMA_DAYS; the name predates round 5) of the operator's net profit ÷ sales across their sites (drives mood). */
  margin30d: number;
  /** Day they last took on a site (multi-unit operators wait MULTI_UNIT_COOLDOWN_DAYS between sites). */
  lastExpansionDay?: number;
  /** [round 6] A royalty holiday granted at a board meeting: no royalty on their sites before this day. */
  feeHolidayUntil?: number;
}

/** Someone who wants a franchise; becomes a Franchisee when given a site. */
export interface Applicant {
  id: ApplicantId;
  name: string;
  competence: number;
  honesty: number;
  cash: Pence;
  arrivedDay: number;
}

/** The brand's standard terms for new agreements (the contract builder). */
export interface FranchiseContract {
  fee: Pence;
  royaltyPct: number;
  adFundPct: number;
  rentPctOfSales: number;
  termDays: number;
  remodelEveryDays: number;
}

export interface Formula {
  menuDishIds: DishId[];
  /** The first node of the tech tree: menu, kitchen layout and service script locked. */
  locked: boolean;
  /** 0-100, derived from the tech tree and menu size (see standardisation()). */
  standardisation: number;
  driveThru: boolean;
  academy: boolean;
  appOrdering: boolean;
  /** In-N-Out: nothing frozen; needs a commissary in each region; better food and staff, higher food cost. */
  fresh: boolean;
  /** Menu price level vs the calibrated restaurant (1 = same prices). */
  priceIndex: number;
}

export interface Brand {
  name: string;
  formula: Formula;
  /** 0-100 per region. */
  recognition: Record<RegionId, number>;
  /** Advertising spend over the last 30 days per region (EMA × 30): ad fund contributions + campaigns. */
  adSpend30d: Record<RegionId, Pence>;
  research?: { tech: Tech; daysLeft: number };
  /** Lasting demand multiplier from product hits (the Filet-O-Fish that stayed on the menu). */
  permanentDemand: number;
}

export interface Region {
  id: RegionId;
  name: string;
  /** In-N-Out rule: fresh-formula sites need one in their region. */
  commissary: boolean;
  /** Map label position (0-1000 × 0-500 SVG space). */
  x: number;
  y: number;
}

export interface City {
  id: CityId;
  name: string;
  country: string;
  regionId: RegionId;
  population: number;
  districts: DistrictId[];
  /** Price and wage level vs the home city (1). Food costs scale by costIndex^0.6. */
  costIndex: number;
  dietaryRules: DietaryRule[];
  /** A local favourite that competes for the same customers (Jollibee). */
  localChampion?: string;
  /** 0-1. */
  championStrength: number;
  entered: boolean;
  /** LOCALISE_MENU done: dietary penalty removed, consistency cost paid. */
  localised: boolean;
  /** An invented tradition took hold (KFC at Christmas in Japan). */
  tradition: boolean;
  /** True after a forced exit; the city can't be re-entered. */
  exited?: boolean;
  /** Map position (0-1000 × 0-500 SVG space). */
  x: number;
  y: number;
}

export interface Supplier {
  id: SupplierId;
  name: string;
  category: string;
  /** Discount on food cost when signed exclusively (half when non-exclusive). */
  discountPct: number;
  /** Chance per year of an outage (and maybe a food-safety scandal). */
  failureRisk: number;
  signed: boolean;
  exclusive: boolean;
  signedDay?: number;
}

export interface PropertyHolding {
  siteId: SiteId;
  purchasePrice: Pence;
  /** Price level when bought: value = purchasePrice × priceLevel / this. */
  priceLevelAtPurchase: number;
  mortgageRemaining: Pence;
  mortgageDaily: Pence;
  /** Rent collected from the operator over the last 30 days (EMA × 30); 0 for company sites. */
  rentIncome: Pence;
}

/** Brand-wide or regional demand effects with a start and end. */
export interface EmpireEffect {
  id: string;
  kind: "scandal" | "campaign" | "discount" | "product" | "supplierOutage";
  label: string;
  startDay: number;
  endDay: number;
  /**
   * Demand multiplier delta. scandal: −depth at start, recovering linearly to 0 by endDay.
   * campaign/discount/product/supplierOutage: constant over the window.
   */
  demand: number;
  /** Spend-per-cover multiplier delta (discounts). */
  spend?: number;
  /** Absent = every region; scandal spillover elsewhere is SCANDAL_SPILLOVER × depth. */
  regionId?: RegionId;
  /** Scandals: the site where it started. */
  siteId?: SiteId;
  supplierId?: SupplierId;
  /** Campaigns and launches: advertising spend per day that feeds regional recognition. */
  budgetPerDay?: number;
}

export type EmpireEventKind =
  | "site_opened" | "site_closed" | "site_failing" | "franchise_sold" | "bought_back" | "applicant"
  | "contract" | "property" | "formula" | "research" | "supplier" | "supplier_outage" | "campaign"
  | "city_entered" | "localised" | "tradition" | "product" | "scandal" | "remodel" | "inspection"
  | "skimming" | "franchisee_bankrupt" | "association" | "forced_exit" | "idea" | "rent_review"
  | "milestone" | "win" | "bankrupt" | "rejected" | "transfer" | "focus"
  /** [round 11] HQ moved money into the hands-on site's till (a float, a top-up, settling a closed till). */
  | "topUp"
  /** [round 6] The monthly board meeting was held (`EmpireState.boardMeeting` holds it until answered). */
  | "boardMeeting"
  /** [round 6] A board decision was taken (or skipped). */
  | "boardDecision"
  | "refurb" | "fee_holiday" | "supply_markup";

export interface EmpireEvent {
  day: number;
  kind: EmpireEventKind;
  text: string;
  tone: "good" | "bad" | "info" | "money";
  siteId?: SiteId;
  cityId?: CityId;
  regionId?: RegionId;
}
/** The sketch's name for logged events. */
export type EmpireEventLog = EmpireEvent;

export interface WinStatus {
  mealsTarget: number;
  /** Regions with recognition ≥ WIN_RECOGNITION and at least one open site making money. */
  regionsWon: RegionId[];
  solvent: boolean;
  /** No franchisee association in revolt. */
  moodOk: boolean;
  achieved: boolean;
  achievedDay?: number;
  reason?: "meals" | "regions";
}

export interface MonthlySnapshot {
  day: number;
  sites: number;
  company: number;
  franchise: number;
  licence: number;
  mealsServed: number;
  hqCash: Pence;
  /** HQ net income over the month. */
  hqIncome: Pence;
  systemSales: Pence;
  avgMood: number;
  avgRecognition: number;
}

/** Fitted parameters of the closed-form site model (see calibrate()). */
export interface CalibrationParams {
  /** Mean fitted covers/day of the reference site over the calibration window (for the UI and notes). */
  baseCovers: number;
  /**
   * [round 3] Fitted demand ÷ sim-core's closed-form demand (`marketDemand`). The model's demand is
   * demandScale × marketDemand(district, brand menu, popularity, day) × brand pull, served through the site's seat
   * and crew capacity (`capacityCovers`, `softCap`). ≈1 when the closed form matches the focused sim. Absent in
   * pre-round-3 saves (read as 1).
   */
  demandScale?: number;
  /**
   * [round 3] Actual menu spend ÷ sim-core's expected basket (marketDemand.spendPerCover), and food + waste ÷ the
   * expected ingredient cost. A site's spend per cover is spendScale × its own district's basket on the brand menu.
   */
  spendScale?: number;
  foodScale?: number;
  /** [round 3] Popularity (0–100) of the focused restaurant the fit was made on (informational). */
  popularity?: number;
  /** Mean covers/day over the history (labour scales with covers relative to this). */
  coversMean: number;
  spendPerCover: Pence;
  /** Food + prep waste + spoilage per cover. */
  foodPerCover: Pence;
  labourPerDay: Pence;
  /** Fixed overheads per day (utilities, rates, incident costs), excluding card fees. */
  overheadsFixed: Pence;
  cardFeePct: number;
  vatPct: number;
  /**
   * Covers multiplier per weekday (0 = Monday, sim-core's weekdayOf), mean 1 over the week, of the reference site
   * with the standard crew (informational since round 3: the model derives it from footfall and crew capacity, so
   * the owner's rota no longer leaks into every site).
   */
  weekdayProfile: number[];
  /** Weekend ÷ weekday covers ratio implied by weekdayProfile (for the UI and notes). */
  weekendMult: number;
  /** District the history came from (season curve and footfall reference). */
  districtId?: DistrictId;
  /** sd of log(actual ÷ fitted covers): the day-to-day noise. */
  noiseSd: number;
  days: number;
  /** The focused history's means, kept for checks and the UI. */
  source: { covers: number; revenue: Pence; profit: Pence };
}

/**
 * [round 6] HQ's money over one month by where it came from (pence; costs negative). `shops` is the company sites' profit
 * after occupancy and the ad fund (the focused site's till is not HQ's); `rent` is landlord income net of the head
 * leases HQ pays; `fees` are franchise joining fees; `supply` the markup on food HQ supplies to franchisees; `costs`
 * HQ's overheads, mortgages and overdraft interest.
 */
export interface BoardIncome {
  shops: Pence;
  royalties: Pence;
  rent: Pence;
  fees: Pence;
  supply: Pence;
  costs: Pence;
}

export type BoardDecisionKind = "royalty" | "localise" | "buyPlot" | "refurbish" | "feeHoliday" | "driveThru" | "supplyMarkup" | "campaign" | "debt";

export interface BoardOption {
  id: string;
  /** Short button text ("Raise it to 6%"). */
  label: string;
  /** One or two short sentences: what it costs now and what it changes later. */
  detail: string;
  /** The real sim command the option applies (absent = do nothing). */
  cmd?: EmpireCommand;
  /** Up-front cost to HQ (pence), when there is one. */
  cost?: Pence;
}

export interface BoardRisk {
  kind: "mood" | "collapse" | "borrowing" | "maturity" | "none";
  text: string;
  siteId?: SiteId;
}

/** [round 6] The monthly board meeting: the month's money, its top mover, one worry and exactly one decision. */
export interface BoardMeeting {
  id: string;
  /** The day it was held (the month's last day). */
  day: number;
  /** Month index (day / 30). */
  month: number;
  income: BoardIncome;
  /** The district whose yearly sales rose most since the last meeting. */
  topMover?: { cityId: CityId; districtId: DistrictId; change: Pence; salesYear: Pence };
  risk: BoardRisk;
  decision: {
    kind: BoardDecisionKind;
    question: string;
    options: BoardOption[];
    /** The option a sensible board would pick (the board-follower strategy and the card's tip). */
    advice: string;
    /** What happens if the meeting is skipped ("Nothing changes." / "Ana will feel ignored."). */
    skipText: string;
  };
}

/** [round 6] One line of the board's minutes (the Money panel's history). */
export interface BoardMinute {
  id: string;
  day: number;
  kind: BoardDecisionKind;
  /** The option id taken, or "skip". */
  choice: string;
  text: string;
  /** HQ's net that month (pence, fees included). */
  net: Pence;
}

export interface EmpireState {
  version: 1;
  seed: number;
  rngState: number[];
  brand: Brand;
  /** Standard terms for new franchise agreements. */
  contract: FranchiseContract;
  sites: SiteSummary[];
  franchisees: Franchisee[];
  applicants: Applicant[];
  cities: City[];
  regions: Region[];
  property: PropertyHolding[];
  suppliers: Supplier[];
  hq: {
    cash: Pence;
    /** The next day to simulate (sim-core day index continues across the fork). */
    day: number;
    /** Inflation index (1 at the fork): prices, wages and rents rise; mortgages don't. */
    priceLevel: number;
    /** HQ net income today and EMA × 30. */
    lastDayNet: Pence;
    income30d: Pence;
    homeCityId: CityId;
  };
  calibration: CalibrationParams;
  focusedSiteId?: SiteId;
  mealsServedTotal: number;
  association: { active: boolean; formedDay?: number };
  inspectionEveryDays: number;
  effects: EmpireEffect[];
  /** A franchisee's product idea waiting for a LAUNCH_PRODUCT with fit "franchiseeIdea". */
  pendingIdea?: { franchiseeId: FranchiseeId; name: string; day: number };
  events: EmpireEventLog[];
  history: MonthlySnapshot[];
  win: WinStatus;
  status: "running" | "bankrupt";
  nextId: number;
  /** [round 6] This month's money by source so far (reset at each board meeting). Absent in older saves (read as 0). */
  monthBook?: BoardIncome;
  /** [round 6] The board meeting waiting for an answer (BOARD_DECIDE). Skipped automatically at the next one. */
  boardMeeting?: BoardMeeting;
  /** [round 6] The last BOARD_MINUTES_MAX decisions, oldest first. */
  boardMinutes?: BoardMinute[];
  /** [round 6] Yearly sales per "cityId|districtId" at the last meeting (the top mover reads it). */
  boardDistrictSales?: Record<string, Pence>;
  /** [round 6] Markup HQ charges franchisees on the food it supplies (0–SUPPLY_MARKUP_MAX). Absent = 0. */
  supplyMarkupPct?: number;
}

/** One aggregate site-day from the closed-form model (or a focused DayResult mapped into the same shape). */
export interface SiteDayResult {
  siteId: SiteId;
  covers: number;
  revenue: Pence;
  vat: Pence;
  foodCost: Pence;
  labourCost: Pence;
  overheads: Pence;
  /** revenue − VAT − food − labour − overheads: what's left to pay occupancy, fees and the operator. */
  contribution: Pence;
}

export type EmpireCommand =
  | {
      type: "OPEN_SITE";
      cityId: CityId;
      districtId: DistrictId;
      ownership: Ownership;
      land: LandMode;
      /** Franchise: an applicant or an existing franchisee takes the site. */
      applicantId?: ApplicantId;
      franchiseeId?: FranchiseeId;
      name?: string;
    }
  /** Refranchise a company site to an applicant or franchisee (they pay fee + book value). */
  | { type: "SELL_FRANCHISE"; siteId: SiteId; applicantId?: ApplicantId; franchiseeId?: FranchiseeId }
  /** Buy a franchise site back into company ownership (pay the operator its value). */
  | { type: "BUY_BACK"; siteId: SiteId }
  | { type: "SET_CONTRACT"; contract: Partial<FranchiseContract>; applyTo: "new" | "all" }
  | { type: "BUY_PROPERTY"; siteId: SiteId }
  | { type: "SET_FORMULA"; menuDishIds?: DishId[]; locked?: boolean; fresh?: boolean; priceIndex?: number }
  | { type: "RESEARCH"; tech: Tech }
  | { type: "SIGN_SUPPLIER"; supplierId: SupplierId; exclusive: boolean }
  | { type: "LAUNCH_CAMPAIGN"; kind: "brand" | "discount"; budget: Pence; regionId?: RegionId }
  | { type: "ENTER_CITY"; cityId: CityId }
  | { type: "LOCALISE_MENU"; cityId: CityId }
  | { type: "LAUNCH_PRODUCT"; name: string; budget: Pence; fit: "core" | "stretch" | "franchiseeIdea" }
  | { type: "CLOSE_SITE"; siteId: SiteId }
  /** hqPays (round 6): HQ funds a franchisee's remodel, so it isn't forced on them. */
  | { type: "REMODEL"; siteId: SiteId; hqPays?: boolean }
  /** [round 6] HQ pays to refurbish a tired site: buys back REFURB_DAYS of its maturity drag. */
  | { type: "REFURBISH"; siteId: SiteId }
  /** [round 6] No royalty on this franchisee's sites for `days` (mood up, HQ cash down). */
  | { type: "FEE_HOLIDAY"; franchiseeId: FranchiseeId; days: number }
  /** [round 6] HQ's markup on the food it supplies to franchisees (0–SUPPLY_MARKUP_MAX). */
  | { type: "SET_SUPPLY_MARKUP"; pct: number }
  /** [round 6] Answer the pending board meeting: one of its option ids, or "skip". */
  | { type: "BOARD_DECIDE"; optionId: string }
  | { type: "BUILD_COMMISSARY"; regionId: RegionId }
  | { type: "SET_INSPECTIONS"; everyDays: number }
  /** The game moves cash from the focused restaurant's till into HQ (it must deduct the same from GameState). */
  | { type: "TRANSFER_FROM_FOCUSED"; amount: Pence }
  /**
   * [round 11] HQ → the focused restaurant's till (the game adds the same to GameState.cash). `why` "float" opens a
   * till, "topUp" covers an overdraft, "close" settles the till of a shop HQ is closing (the only one allowed to take
   * HQ past what it can spend: those debts are HQ's whatever happens).
   */
  | { type: "TRANSFER_TO_FOCUSED"; amount: Pence; why?: "float" | "topUp" | "close" }
  /** Mark a site as the focused one (or none). The game swaps the sim-core GameState itself. */
  | { type: "FOCUS_SITE"; siteId?: SiteId };

export interface EmpireStepResult {
  empire: EmpireState;
  events: EmpireEvent[];
  /** Only with StepOptions.trace: the traced sites' day. */
  trace?: SiteTrace[];
}

/** One traced site-day (StepOptions.trace): the model's P&L and the money flows that follow from it (pence). */
export interface SiteTrace {
  day: number;
  siteId: SiteId;
  result: SiteDayResult;
  netSales: Pence;
  royalty: Pence;
  adFund: Pence;
  /** What the operator (or a company site) pays for the plot today. */
  rent: Pence;
  loan: Pence;
  /** Operator net today (0 on company sites). */
  operator: Pence;
  hq: Pence;
}
