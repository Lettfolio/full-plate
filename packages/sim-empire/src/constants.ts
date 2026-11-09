/**
 * Every tunable number in sim-empire. No logic lives here; the balance agent may change these freely.
 * Money is integer pence. A year is 360 days (sim-core's 12 × 30-day months).
 *
 * Real-world anchors (docs/BRIEF.md, Path A) are noted next to each value. Dollar figures are converted at
 * roughly £1 = $1.27 and then rounded to a friendly UK number.
 */

export const EMPIRE_SAVE_VERSION = 1 as const;
export const DAYS_PER_YEAR = 360;
export const DAYS_PER_QUARTER = 90;

// ── franchise contract (BRIEF Path A §3) ──
/** McDonald's charges $45k for a 20-year franchise → about £35k. */
export const DEFAULT_FRANCHISE_FEE = 3_500_000;
/** Royalty on net sales: McDonald's 4–5%, Subway 8%. */
export const DEFAULT_ROYALTY_PCT = 0.05;
export const ROYALTY_RANGE: [number, number] = [0, 0.12];
/** Advertising fund: 4–4.5% of net sales. */
export const DEFAULT_AD_FUND_PCT = 0.04;
export const AD_FUND_RANGE: [number, number] = [0, 0.08];
/** Rent on HQ-owned land as a share of net sales (5–16%), or cost + 40%, whichever is higher (Sonneborn). */
export const DEFAULT_RENT_PCT = 0.1;
export const RENT_PCT_RANGE: [number, number] = [0.05, 0.16];
export const RENT_COST_MARKUP = 0.4;
export const DEFAULT_TERM_DAYS = 20 * DAYS_PER_YEAR;
export const DEFAULT_REMODEL_EVERY_DAYS = 10 * DAYS_PER_YEAR;
export const FEE_RANGE: [number, number] = [0, 15_000_000];
/** "Benchmark" total take (royalty + ad fund + rent share) that applicants and franchisees consider normal. */
export const BENCHMARK_TAKE = DEFAULT_ROYALTY_PCT + DEFAULT_AD_FUND_PCT + DEFAULT_RENT_PCT;

// ── licences (Starbucks in airports and campuses) ──
export const LICENCE_ROYALTY_PCT = 0.1;
export const LICENCE_SETUP_COST = 2_500_000;
export const LICENCE_CONSISTENCY_PENALTY = 20;

// ── building and property ──
/** Fit-out of a quick-service unit (UK £30–150k kitchen + £15–35k furniture, plus signage and kit for a QSR box). × city costIndex. */
export const SITE_BUILD_COST = 22_000_000;
export const DRIVE_THRU_BUILD_EXTRA = 12_000_000;
/** Franchisees put this share of the build cost down in cash; a bank lends the rest. */
export const FRANCHISEE_EQUITY_SHARE = 0.3;
export const OPERATOR_LOAN_APR = 0.07;
export const OPERATOR_LOAN_YEARS = 10;
/**
 * Market rent for a new QSR plot = district monthlyRent × this × city costIndex: a drive-thru box on a
 * corner plot is bigger than the first restaurant's unit (whose rent stays the sim-core district rent).
 * Lands occupancy near the brief's ~5% of sales at a typical mature site.
 */
export const QSR_RENT_MULT = 1.6;
/** Leases are reviewed to current prices every 5 years. */
export const RENT_REVIEW_DAYS = 5 * DAYS_PER_YEAR;
/** Purchase price = annual market rent / yield. */
export const PROPERTY_YIELD = 0.07;
export const PROPERTY_DEPOSIT_SHARE = 0.4;
export const MORTGAGE_APR = 0.06;
export const MORTGAGE_YEARS = 25;
/** Property values rise with prices; forced sales recover this share of value. */
export const FORCED_SALE_RECOVERY = 0.5;

// ── remodels (McDonald's 2018 dispute: $160k–$750k each → £130k–£600k) ──
export const REMODEL_COST_MIN = 13_000_000;
export const REMODEL_COST_MAX = 60_000_000;
/** Remodel cost scales between min and max by annual revenue up to this figure. */
export const REMODEL_COST_REVENUE_REF = 300_000_000;
export const REMODEL_CONSISTENCY_BONUS = 15;
/** Sites start looking tired after this many years without a remodel… */
export const STALE_AFTER_YEARS = 6;
/** …and then lose this share of demand per extra year, down to STALE_FLOOR. */
export const STALE_RATE_PER_YEAR = 0.04;
export const STALE_FLOOR = 0.75;

// ── unit economics anchors (QSR: food ~30%, labour ~25%, occupancy ~5%, margin ~25%) ──
/** Subway's warning: franchisees fail below roughly $500k/yr → £400k/yr gross takings per site. */
export const COLLAPSE_REVENUE_YEAR = 40_000_000;
/** Annual revenue is an EMA of daily revenue with this time constant (days). */
export const ANNUAL_EMA_DAYS = 90;
/** Labour = labourPerDay × (covers / coversMean)^this (busier sites add crew a little slower than covers). */
export const LABOUR_SCALE_EXP = 0.85;
/** Fixed overheads (utilities, repairs, supplies) scale as (covers / coversMean)^this. */
export const OVERHEAD_SCALE_EXP = 0.85;
/** Each 10 points of standardisation above the reference cuts labour per cover by this share (Speedee system). */
export const LABOUR_EFFICIENCY_PER_10_STD = 0.02;

// ── demand model factors (all normalised to 1 at the calibration reference state) ──
export const REC_BASE = 1;               // recognition factor = (1 + rec/100) / (1 + ref/100)
export const CONSISTENCY_BASE = 0.8;       // (0.8 + 0.4·c/100) / ref
export const CONSISTENCY_SLOPE = 0.4;
export const STAFF_BASE = 0.85;            // (0.85 + 0.3·q/100) / ref
export const STAFF_SLOPE = 0.3;
/**
 * Speedee throughput: +X covers per point of standardisation above the reference (positive side only). A
 * sit-down restaurant turned assembly line serves far more people from the same box: a locked formula (+20)
 * is +24%, the full tech tree (+50) +60%, before the drive-thru and app multipliers.
 */
export const STD_THROUGHPUT = 0.012;
/**
 * [round 3] Speedee's other half: a standardised formula runs a takeaway counter beside the dining room. Each point
 * of standardisation above the reference adds this share of the dining room's covers as takeaway (locked formula
 * +40%, the full tech tree +100%), before the drive-thru and app multipliers. Seats only grow by STD_THROUGHPUT.
 */
export const TAKEAWAY_PER_STD = 0.02;
/**
 * [round 3] The capacity model (EMPIRE-NOTES §3). A site is a sim-core dining room: the standard box has
 * content.balance.startingTables tables × STD throughput, capped at maxTables, and a standard crew of two chefs
 * and two servers on rotas A (Wed–Sun) and B (Mon, Tue, Fri–Sun): one pair Monday–Thursday, two at the weekend.
 */
export const CREW_ROTA_A: readonly boolean[] = [false, false, true, true, true, true, true];
export const CREW_ROTA_B: readonly boolean[] = [true, true, false, false, true, true, true];
/** Hourly wage (pence): NLW, plus 9p per chef skill point above 30 and 2p per server skill point above 20 (content archetypes). */
export const CREW_WAGE_BASE = 1_271;
export const CREW_WAGE_PER_SKILL = 9;
export const SERVER_WAGE_PER_SKILL = 2;
/** Labour for off-premise covers (takeaway counter, drive-thru, app) scales as off^this: a counter is lean. */
export const OFF_PREMISE_LABOUR_EXP = 0.5;
/** Popularity a modelled site trades at when the calibration has none (a well-run sim-core restaurant). */
export const DEFAULT_POPULARITY = 85;
/** Popularity of a standard crew at staff quality 50, and per point away from 50 (sim-core ratings follow the crew). */
export const POPULARITY_REF = 79;
export const POPULARITY_PER_SKILL = 0.6;
/** Prestige of the founder's flagship when newEmpire has no GameState to read it from (two years of good reviews). */
export const FLAGSHIP_PRESTIGE = 80;
/** Prestige of a standard crew at staff quality 50, and per point away from 50 (clamped 0–100). */
export const PRESTIGE_REF = 45;
export const PRESTIGE_PER_SKILL = 3;
/** Share of the fitted demandScale's deviation from 1 that calibrate keeps (shrinkage toward sim-core's closed form). */
export const DEMAND_SCALE_KEEP = 0.5;
/** A promoted branch opens with this many services' worth of forecast stock on the shelves. */
export const BRANCH_STOCK_DAYS = 1.5;
/** Days the "brand" footfall mod lasts in a promoted site's GameState (the game refreshes it every evening). */
export const BRAND_PULL_DAYS = 3_650;
/** Covers ∝ priceIndex^−elasticity (legacy; demand now follows sim-core's own price response on the brand menu). */
export const PRICE_ELASTICITY = 1.2;
export const PRICE_INDEX_RANGE: [number, number] = [0.5, 1.6];
/**
 * Drive-thru is ~70% of US McDonald's sales; here it adds 30% covers at sites built or remodelled with one. Round 3:
 * drive-thru and app orders are off-premise, so they sit on top of the dining room's seat cap (and on top of a
 * focused site's DayResult), not inside it.
 */
export const DRIVE_THRU_COVERS = 1.3;
export const APP_COVERS = 1.1;
export const APP_SPEND = 1.05;
/** Fresh, never frozen (In-N-Out): more appeal, more food cost, needs a commissary in the region. */
export const FRESH_APPEAL = 1.08;
export const FRESH_FOOD_COST = 1.12;
/** City footfall index = (population / ref)^exp; the home city is ~1. */
export const FOOTFALL_POP_REF = 2_500_000;
export const FOOTFALL_POP_EXP = 0.25;
/** Menus that break a city's dietary rules without LOCALISE_MENU keep only this share of demand. */
export const DIETARY_PENALTY = 0.55;
/** Local champion: demand × (1 − strength × CHAMPION_HIT × (1 − rec/200)). */
export const CHAMPION_HIT = 0.35;
/** A localised menu costs consistency in that city. */
export const LOCALISE_CONSISTENCY_PENALTY = 5;
export const LOCALISE_COST = 15_000_000;
/** KFC-style invented tradition: chance per LOCALISE_MENU; city demand and region recognition bump. */
export const TRADITION_CHANCE = 0.15;
export const TRADITION_DEMAND = 1.1;
export const TRADITION_RECOGNITION = 15;

// ── saturation (BRIEF §6) ──
/** Natural number of sites a city supports before cannibalisation bites. */
export const PEOPLE_PER_SITE = 60_000;
/** Each extra site in the same district counts this many more times toward saturation. */
export const SAME_DISTRICT_EXTRA = 1.5;
export const SATURATION_MAX = 0.85;

// ── staff and consistency ──
export const COMPANY_STAFF_QUALITY = 50;
export const FRANCHISE_STAFF_BASE = 35;
export const FRANCHISE_STAFF_PER_COMPETENCE = 0.3;
export const ACADEMY_STAFF_BONUS = 15;
export const FRESH_STAFF_BONUS = 10;
/** Consistency and staff quality move this share of the gap to their target each day. */
export const DRIFT_PER_DAY = 0.02;
export const FRANCHISE_CONSISTENCY_PER_COMPETENCE = 0.2; // (competence − 50) × this

// ── standardisation tech tree (formula → academy → drive-thru → app) ──
export const STD_BASE = 30;
export const STD_FORMULA_LOCKED = 20;
export const STD_PER_EXTRA_DISH = 3;
export const STD_MENU_FREE = 8;
export const STD_ACADEMY = 20;
export const STD_DRIVE_THRU = 5;
export const STD_APP = 5;
export const TECH: Record<"academy" | "driveThru" | "appOrdering", { cost: number; days: number; requires?: "academy" | "driveThru" }> = {
  academy: { cost: 25_000_000, days: 90 },                          // Hamburger University, 1961
  driveThru: { cost: 40_000_000, days: 120, requires: "academy" },
  appOrdering: { cost: 60_000_000, days: 180, requires: "driveThru" },
};

// ── HQ ──
export const HQ_OVERHEAD_DAILY = 6_000;
export const HQ_OVERHEAD_PER_SITE_DAILY = 3_000;
export const INSPECTION_COST = 80_000;
export const DEFAULT_INSPECTION_EVERY_DAYS = 180;
export const INSPECTION_CONSISTENCY_BONUS = 3;
/** HQ is insolvent below this cash (an overdraft line). Overdrafts cost OVERDRAFT_APR. */
export const HQ_CREDIT_LINE = 200_000_000;
/** Share of the credit line HQ may draw for capital spending (sites, plots, research); the rest absorbs losses. */
export const DEVELOPMENT_FACILITY_SHARE = 0.5;
/**
 * Round 3 review: the bank lends for development against trading sites, £150k per open site (× price level), up to
 * the cap above. At the fork (one site) HQ can spend the £500k investment + £150k; the full £1m facility needs ~7 open
 * sites. Before this the whole £1m was available on day one, so "enter a country + three builds" took HQ to −£800k.
 */
export const FACILITY_PER_OPEN_SITE = 15_000_000;
export const OVERDRAFT_APR = 0.08;
export const CITY_ENTRY_COST = 12_000_000;
export const COUNTRY_ENTRY_COST = 40_000_000;
export const COMMISSARY_COST = 150_000_000;
export const INFLATION = 0.025;

// ── recognition ──
/** Region recognition target = 100 × (1 − e^(−visibility / REC_K)). */
export const REC_K = 6;
/** Visibility per site = 1 / (region population in millions): ~5.5 sites per million people reach WIN_RECOGNITION. */
export const AD_PENCE_PER_VIS = 5_000_000;
export const REC_DRIFT_PER_DAY = 1 / 90;
export const HOME_START_RECOGNITION = 15;
/** The region win check: "present and profitable" means recognition ≥ this. */
export const WIN_RECOGNITION = 60;
export const WIN_MEALS = 1_000_000_000;

// ── franchisees ──
export const MOOD_BASE = 55;
export const MOOD_MARGIN_WEIGHT = 200;       // per unit of operator margin above MOOD_MARGIN_REF
export const MOOD_MARGIN_REF = 0.08;
export const MOOD_ROYALTY_WEIGHT = 300;      // per unit of royalty above default
export const MOOD_AD_WEIGHT = 200;
export const MOOD_RENT_WEIGHT = 150;
export const MOOD_DRIFT_PER_DAY = 0.03;
export const MOOD_ROYALTY_RISE_SHOCK = 5;    // per percentage point of royalty rise
export const MOOD_FORCED_REMODEL = 12;
export const MOOD_SCHEDULED_REMODEL = 4;
export const MOOD_DISCOUNT_CAMPAIGN = 8;
export const MOOD_SCANDAL = 8;
export const MOOD_CAUGHT_SKIMMING = 10;
export const ASSOCIATION_MOOD = 35;
export const ASSOCIATION_DISSOLVE_MOOD = 50;
export const ASSOCIATION_MIN_FRANCHISEES = 5;
/** Franchisees go bust below this cash. */
export const FRANCHISEE_BANKRUPT_CASH = -15_000_000;
/** HQ takes over a bankrupt franchisee's site (rather than closing it) if it has this much cash per site. */
export const TAKEOVER_CASH_PER_SITE = 5_000_000;
/** Multi-unit operators ask for more sites when mood ≥ this. */
export const MULTI_UNIT_MOOD = 55;
/** A development schedule: an operator takes at most one new site per this many days. */
export const MULTI_UNIT_COOLDOWN_DAYS = 180;
export const APPLICANTS_BASE_PER_MONTH = 2.5;
export const APPLICANT_POOL_MAX = 15;
/** Skimming: share of sales hidden = max(0, (honesty threshold − honesty)/100) × SKIM_RATE. */
export const SKIM_HONESTY_THRESHOLD = 60;
export const SKIM_RATE = 0.15;
export const SKIM_CATCH_CHANCE = 0.6;
export const SKIM_PENALTY_MULT = 1.5;
/** Product ideas per year = 1 − e^(−this × franchisees): a few with a handful of operators, ~1 a year at scale. */
export const IDEA_CHANCE_PER_FRANCHISEE_YEAR = 0.03;

// ── suppliers (Simplot fries 1967; the 2024 onion E. coli outbreak) ──
export const SUPPLIER_DISCOUNT_CAP = 0.18;
export const NON_EXCLUSIVE_SHARE = 0.5;       // non-exclusive deals give half the discount and hit 35% as hard
export const NON_EXCLUSIVE_IMPACT = 0.35;
export const SUPPLIER_OUTAGE_DEMAND = 0.85;
export const SUPPLIER_OUTAGE_DAYS: [number, number] = [30, 60];
export const SUPPLIER_SCANDAL_CHANCE = 0.4;

// ── scandals (Chipotle 2015: −22% same-store sales, years to recover) ──
export const SCANDAL_RATE_PER_YEAR = 0.12;
export const SCANDAL_DEPTH: [number, number] = [0.15, 0.25];
export const SCANDAL_RECOVERY_DAYS: [number, number] = [4 * DAYS_PER_QUARTER, 12 * DAYS_PER_QUARTER];
export const SCANDAL_SPILLOVER = 0.4;
export const SCANDAL_RECOGNITION_HIT = 8;
export const SCANDAL_LEGAL_COST = 25_000_000;
/** Geopolitics (McDonald's sold 850 Russian stores in 2022): chance per foreign country with sites per year. */
export const FORCED_EXIT_CHANCE_PER_YEAR = 0.015;

// ── campaigns and product launches (Arch Deluxe flop; Filet-O-Fish hit) ──
export const CAMPAIGN_DAYS = 30;
export const DISCOUNT_DEMAND = 1.12;
export const DISCOUNT_SPEND = 0.9;
export const PRODUCT_SUCCESS: Record<"core" | "stretch" | "franchiseeIdea", number> = { core: 0.55, stretch: 0.25, franchiseeIdea: 0.7 };
export const PRODUCT_HIT_BOOST = 0.1;
export const PRODUCT_HIT_DAYS = DAYS_PER_YEAR;
export const PRODUCT_HIT_PERMANENT = 0.03;
/** permanentDemand never exceeds this (a menu only has room for so many classics). */
export const PERMANENT_DEMAND_CAP = 1.15;
export const PRODUCT_FLOP_HIT = 0.03;
export const PRODUCT_FLOP_DAYS = 180;
export const PRODUCT_BUDGET_REF = 100_000_000;
export const PRODUCT_RECOGNITION_FLOP = 3;

// ── reference state for calibration (newEmpire puts the flagship exactly here) ──
export const REF_RECOGNITION = HOME_START_RECOGNITION;
export const REF_STANDARDISATION = STD_BASE;
export const REF_STAFF_QUALITY = COMPANY_STAFF_QUALITY;
export const REF_CONSISTENCY = STD_BASE + 20; // the flagship's founder-run consistency at the fork
/** Default calibration (used before any focused history exists); roughly a sim-core High Street site. */
export const DEFAULT_CALIBRATION = {
  baseCovers: 72,
  coversMean: 80,
  spendPerCover: 1_500,
  foodPerCover: 410,
  labourPerDay: 36_000,
  overheadsFixed: 8_000,
  cardFeePct: 0.015,
  vatPct: 1 / 6,
  noiseSd: 0.12,
} as const;
/** calibrate() needs at least this many days. */
export const MIN_CALIBRATION_DAYS = 14;

// ── logs ──
export const EVENT_LOG_MAX = 200;
export const MONTHLY_HISTORY_MAX = 240;
