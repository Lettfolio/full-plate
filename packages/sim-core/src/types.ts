/**
 * Full Plate — shared domain contract.
 *
 * This file is the agreement between sim-core, game (UI) and content (data).
 * Change it only by agreement: everything else builds against it.
 *
 * Conventions
 * - Money is integer pence (never floats).
 * - Time: a Day has an index (0-based). Each day has a fixed number of service
 *   ticks (SERVICE_TICKS). One tick ≈ 5 in-game minutes. Service runs 12:00→22:00
 *   = 120 ticks. Planning and evening phases are not ticked.
 * - All randomness comes from the seeded RNG; the sim never reads wall-clock time.
 * - The sim is pure: `step(state, cmd)` and `tick(state)` return new state. UI
 *   never mutates state.
 */

// ───────────────────────── identifiers ─────────────────────────
export type Pence = number;              // integer
export type DishId = string;
export type IngredientId = string;
export type StaffId = string;
export type CustomerId = string;
export type DistrictId = string;
export type SegmentId = string;
export type EventId = string;
export type TableId = string;

export const SERVICE_TICKS = 120;        // 12:00 → 22:00 at 5-minute ticks
export const MINUTES_PER_TICK = 5;

// ───────────────────────── content (static data) ─────────────────────────
export type Cuisine = "british" | "italian" | "american" | "asian" | "french" | "cafe";
export type DishCourse = "starter" | "main" | "dessert" | "drink" | "side";

export interface IngredientDef {
  id: IngredientId;
  name: string;
  unitCost: Pence;                       // per portion-unit
  shelfLifeDays: number;                 // for spoilage
  seasonality?: number[];                // months 1-12 when in season (cheaper, better)
}

export interface DishDef {
  id: DishId;
  name: string;
  course: DishCourse;
  cuisine: Cuisine;
  ingredients: { id: IngredientId; qty: number }[];
  prepTicks: number;                     // kitchen time per plate
  skillRequired: number;                 // 0-100; chefs below this make mistakes
  baseAppeal: Record<SegmentId, number>; // 0-1 per customer segment
  qualityCeiling: number;                // 0-100; max quality even with perfect chef
  suggestedPrice: Pence;
  /** Flavour text shown in the menu editor. */
  blurb?: string;
}

export interface SegmentDef {
  id: SegmentId;
  name: string;                          // "Students", "Families", "Business", "Foodies", "Tourists"
  priceSensitivity: number;              // 0-1 (1 = very sensitive)
  qualityWeight: number;                 // 0-1
  speedWeight: number;                   // 0-1
  averageBudget: Pence;                  // per head
  partySizeWeights: number[];            // index = party size-1, weights
  /** Arrival curve by service tick, length SERVICE_TICKS, sums to ~1. */
  arrivalCurve: number[];
  tipRate: number;                       // 0-0.2
}

export interface DistrictDef {
  id: DistrictId;
  name: string;                          // "Student Quarter", "High Street", "Business Park", "Seaside"
  monthlyRent: Pence;
  depositMonths: number;
  /** Base footfall per day (potential customers passing). */
  footfall: number;
  /** Mix of segments, sums to 1. */
  segmentMix: Record<SegmentId, number>;
  /** Seasonal footfall multiplier by month 1-12. */
  seasonCurve: number[];
  blurb: string;
}

export type StaffRole = "chef" | "server" | "bar" | "porter" | "manager";

export interface StaffArchetypeDef {
  id: string;
  role: StaffRole;
  nameSamples: string[];
  skillRange: [number, number];          // 0-100
  speedRange: [number, number];          // 0-100
  charmRange: [number, number];          // 0-100 (front of house)
  wageRange: [Pence, Pence];             // per hour
  traits: string[];                      // pool to draw 1-3 from
}

export interface TraitDef {
  id: string;
  name: string;
  description: string;
  /** Multipliers applied in StaffSystem. 1 = neutral. */
  effects: Partial<{
    skill: number; speed: number; charm: number; moodDecay: number; wageDemand: number; mistakeRate: number;
  }>;
}

export interface EventDef {
  id: EventId;
  title: string;
  body: string;
  /** Weight in the deck; 0 disables. */
  weight: number;
  /** Conditions evaluated against state; all must hold. */
  when?: Partial<{
    minDay: number; maxDay: number; minCash: Pence; maxCash: Pence; minPopularity: number; minPrestige: number;
    month: number[];
  }>;
  choices: EventChoiceDef[];
}

export interface EventChoiceDef {
  id: string;
  label: string;
  /** Applied immediately. */
  effects: Partial<{
    cash: Pence; popularity: number; prestige: number; staffMood: number; footfallMultDays: { mult: number; days: number };
  }>;
}

export interface ContentPack {
  ingredients: IngredientDef[];
  dishes: DishDef[];
  segments: SegmentDef[];
  districts: DistrictDef[];
  staffArchetypes: StaffArchetypeDef[];
  traits: TraitDef[];
  events: EventDef[];
  /** Global balance knobs. */
  balance: BalanceDef;
  /**
   * [sim-core addition] Optional review text templates keyed by rating "1".."5".
   * Placeholders: {dish}, {restaurant}, {segment}. sim-core has built-in fallbacks.
   */
  reviewTemplates?: Record<string, string[]>;
  /**
   * [round 3, sim-core] Optional incident text in the shape of sim-core's `incidents/text.ts` (the content package
   * exports it as `incidentText`). Kinds, options and lines that are present replace the built-in text; anything
   * missing falls back to it.
   */
  incidentText?: IncidentTextPack;
  /**
   * [round 3, sim-core] Optional goal ladder and lines in the shape of sim-core's `goals/text.ts` (content exports
   * `goalText`). A non-empty GOAL_LADDER replaces the built-in ladder (entries with an unknown kind are skipped);
   * GOAL_LINES keys present replace the built-in lines.
   */
  goalText?: GoalTextPack;
}

/** [round 3] Data shape of incident text (see ContentPack.incidentText). */
export interface IncidentTextPack {
  INCIDENT_TEXT?: Record<string, {
    title: string;
    body: string;
    options: Record<string, { label: string; description: string; outcome: string }>;
    ignored: string;
  }>;
  INCIDENT_LINES?: Record<string, string>;
}

/** [round 3] Data shape of goal text (see ContentPack.goalText). */
export interface GoalTextPack {
  GOAL_LADDER?: {
    id: string;
    kind: string;
    tier: number;
    title: string;
    hint: string;
    target: number | "tablesPlus2";
    role?: StaffRole;
    reward?: { cash?: Pence; popularity?: number };
  }[];
  GOAL_LINES?: Record<string, string>;
}

export interface BalanceDef {
  startingCash: Pence;
  loanPrincipal: Pence;
  loanTermDays: number;
  loanApr: number;                       // e.g. 0.08
  fitOutCost: Pence;
  /** Reputation drift per day toward 50 when nothing happens. */
  reputationDecay: number;
  /** How many reviews a day are written per 10 covers. */
  reviewRatePer10Covers: number;
  /** Tables available at start and max. */
  startingTables: number;
  maxTables: number;
  seatsPerTable: number;
  /** Waste model shares: prep/plate/spoil sum to 1. */
  wasteShares: { prep: number; plate: number; spoil: number };
  /** Wage multiplier for weekend shifts etc. */
  weekendFootfallMult: number;
  /** Year-1 target: fraction of simulated owners who should survive at normal difficulty (headless target, not enforced). */
  targetYear1Survival: number;
  /**
   * [round 2, sim-core] Opening stock allowance (pence), spent automatically at the first START_SERVICE on
   * what the menu needs for ~1.3× the first-day forecast. Defaults to OPENING_STOCK_BUDGET.
   */
  openingStockBudget?: Pence;
}

// ───────────────────────── runtime state ─────────────────────────
export type Phase = "planning" | "service" | "evening" | "event" | "gameover";
export type Difficulty = "cosy" | "normal" | "hard";

export interface MenuItem {
  dishId: DishId;
  price: Pence;
  active: boolean;
  /** Rolling 7-day stats for the menu matrix. */
  sold7d: number;
  margin7d: Pence;
  /** [sim-core addition] Last ≤7 days of {sold, margin}, newest last; sold7d/margin7d are its sums. */
  recent?: { sold: number; margin: Pence }[];
}

export interface Staff {
  id: StaffId;
  name: string;
  role: StaffRole;
  skill: number; speed: number; charm: number;   // 0-100
  wage: Pence;                                   // per hour
  mood: number;                                  // 0-100
  fatigue: number;                               // 0-100
  traits: string[];
  hiredDay: number;
  /** Hidden potential revealed over time; UI shows it fuzzily. */
  potential: number;
  /** Days worked this week for the rota. */
  rota: boolean[];                               // length 7, true = working
  /** [round 2, sim-core] Day index of a TRAIN day: off the floor that day (paid), skill already raised. */
  trainingDay?: number;
  /** [round 2, sim-core] On a GIVE_BREAK until this service tick (unavailable while tick < this). Cleared when it ends. */
  breakUntilTick?: number;
}

export type CustomerStage = "queue" | "seated" | "ordered" | "eating" | "paying" | "left";

export interface Customer {
  id: CustomerId;
  segment: SegmentId;
  partySize: number;
  arrivedTick: number;
  stage: CustomerStage;
  tableId?: TableId;
  order: DishId[];
  patience: number;                              // 0-100, falls while waiting
  satisfaction: number;                          // 0-100, final rating basis
  spend: Pence;
  tip: Pence;
  /** Set when stage === "left": did they leave before being served. */
  walkedOut?: boolean;
  // ── sim-core additions (all optional, sim always sets them on new customers) ──
  /** Tick at which the customer entered its current stage. */
  stageTick?: number;
  /** Plates delivered so far (order.length when complete). */
  platesReady?: number;
  /** Sum of plated qualities, for the average. */
  qualitySum?: number;
  /** Tick at which the last plate reached the table. */
  servedTick?: number;
  /** Tick at which an eating party finishes. */
  eatUntil?: number;
  /** Tick at which the customer reached stage "left"; removed by ClearingSystem a tick later. */
  leftTick?: number;
  /** Ingredient cost of the plates ordered. */
  foodCost?: Pence;
  /** True after COMP_TABLE: the meal is free and satisfaction is boosted. */
  comped?: boolean;
  /** Final 1-5 rating once paid. */
  rating?: number;
  /** [round 2, sim-core] Satisfaction points added (or removed) by incidents: apologies, freebies, spills. */
  satisfactionBonus?: number;
  /** [round 2, sim-core] A critic/influencer (VIP incident); their rating moves prestige ±5. Usually a party of 1-2. */
  vip?: boolean;
  /** [round 3, sim-core] The party ordered the set menu (GameState.setMenu): one sale of setMenu.price per head. */
  setMenu?: boolean;
}

export interface Table {
  id: TableId;
  seats: number;
  occupiedBy?: CustomerId;
  /** Ticks until cleared after guests leave. */
  dirtyTicks: number;
}

export interface KitchenTicket {
  id: string;
  customerId: CustomerId;
  dishId: DishId;
  createdTick: number;
  ticksRemaining: number;
  chefId?: StaffId;
  quality: number;                               // computed when plated
  /** [sim-core addition] Ingredient freshness/season bonus captured when stock was consumed. */
  freshness?: number;
  /** [round 2, sim-core] A remake for a sent-back plate: when plated, replaces this quality in the party's average. */
  remakeOf?: number;
  /**
   * [round 3, sim-core] Hands-on pass hold: the plate is cooked (quality set, ticksRemaining 0) and waiting under the
   * heat lamps for someone to carry it (PLAYER_SERVED, or an AI server after HANDS_ON.passHoldTicks).
   */
  atPass?: boolean;
  /** [round 3, sim-core] Service tick the plate was plated (set while it is held at the pass). */
  platedAtTick?: number;
  /** [round 3 review] Service tick the hands-on human picked this ticket up (PLAYER_CLAIMED); chefId is the human's. */
  claimedAtTick?: number;
}

export interface Review {
  day: number;
  source: "walkin" | "online" | "critic" | "wordofmouth";
  rating: number;                                // 1-5
  text: string;
  dishId?: DishId;
  /** [sim-core addition] Average plate quality behind the review (drives prestige). */
  quality?: number;
}

/** [round 3] Per-dish line of a DayResult. */
export interface DayDishLine {
  /** Plates paid for. */
  sold: number;
  /** Plates cooked (remakes not counted twice). */
  plated: number;
  /** Mean plated quality 0-100 (0 when none plated). */
  qualityMean: number;
  /** Takings for this dish (set-menu sales are split across its dishes by suggested price). */
  revenue: Pence;
  /** Stock cost (price paid) of the plates fired. */
  foodCost: Pence;
}

export interface DayResult {
  /** [round 3] The restaurant was shut today (CLOSE_TODAY): no service, rent/loan/overheads paid, rostered wages at 50%. */
  closed?: boolean;
  /** [round 3] Per-dish sales and quality for dishes ordered today. */
  perDish?: Record<DishId, DayDishLine>;
  /** [round 3] Plates and mean quality per cook: staff ids, plus "owner" (owner covering) and "player" (hands-on). */
  perChef?: Record<StaffId, { plates: number; qualityMean: number }>;
  /** [round 3] Mean ingredient freshness/season bonus of the plates cooked today (quality points; 0 when none). */
  freshnessMean?: number;
  /** [round 2] incidents that happened today and how they went. */
  incidents?: IncidentSummary[];
  /** [round 2] roles the owner covered today; drives the "hire someone" lesson in the evening copy. */
  ownerCovered?: StaffRole[];
  day: number;
  covers: number;
  walkouts: number;
  revenue: Pence;
  tips: Pence;
  foodCost: Pence;
  labourCost: Pence;
  rent: Pence;                                   // apportioned daily
  loanPayment: Pence;
  /** [sim-core addition] Utilities, insurance, business rates and card fees. Included in profit. */
  overheads?: Pence;
  /** [sim-core addition] VAT owed on today's takings (menu prices are VAT-inclusive). Included in profit. */
  vat?: Pence;
  /** [round 2, sim-core] Cash spent on incident fixes (engineer, call-ins, freebies). Included in profit. Corner-shop stock is food, not this. */
  incidentCosts?: Pence;
  waste: { prep: Pence; plate: Pence; spoil: Pence };
  profit: Pence;
  averageSpend: Pence;
  averageRating: number;                         // 1-5
  bestDish?: DishId;
  worstDish?: DishId;
  popularityDelta: number;
  prestigeDelta: number;
  reviews: Review[];
  staffMoodDelta: Record<StaffId, number>;
}

export interface Stock {
  ingredientId: IngredientId;
  qty: number;
  /** Day the oldest batch was delivered; used for spoilage. */
  oldestDay: number;
  /** [sim-core addition] FIFO delivery batches, oldest first; qty is their sum. `cost` = pence paid per portion (round 2; base unitCost when absent). */
  batches?: { qty: number; day: number; cost?: number }[];
}

export interface Loan {
  principal: Pence;
  remaining: Pence;
  dailyPayment: Pence;
  daysRemaining: number;
}

export interface Reputation {
  popularity: number;                            // 0-100, drives footfall
  prestige: number;                              // 0-100, drives spend & critics
}

export interface ActiveEvent {
  eventId: EventId;
  /** Index into choices once resolved. */
  chosen?: string;
}

export interface GameState {
  version: 1;
  seed: number;
  rngState: number[];                            // serialisable RNG state
  difficulty: Difficulty;
  day: number;                                   // 0-based; day 0 is opening day
  tick: number;                                  // 0..SERVICE_TICKS during service
  phase: Phase;
  restaurantName: string;
  districtId: DistrictId;
  cash: Pence;
  loan: Loan;
  reputation: Reputation;
  menu: MenuItem[];
  staff: Staff[];
  tables: Table[];
  stock: Stock[];
  /** Pending deliveries arriving next morning. */
  orders: { ingredientId: IngredientId; qty: number; cost: Pence }[];
  // live service
  customers: Customer[];
  tickets: KitchenTicket[];
  todays: Partial<DayResult> & { reviews: Review[] };
  history: DayResult[];
  activeEvent?: ActiveEvent;
  /**
   * Footfall multipliers from events: [mult, daysRemaining]. [round 3] `source` tags who owns an entry (e.g. "stars",
   * "career:regulars") so a layer can replace its own mod without touching others (see setFootfallMod).
   */
  footfallMods: FootfallMod[];
  log: LogEntry[];                               // last ~200 entries for the UI ticker
  stats: { totalCovers: number; totalRevenue: Pence; daysOpen: number };
  // ── sim-core additions (optional so older saves stay valid) ──
  /** Dishes pulled for today via EIGHTY_SIX (manual or out-of-stock). Cleared at END_DAY. */
  eightySixed?: DishId[];
  /** Candidate indices already hired today. Cleared at END_DAY. */
  hiredCandidates?: number[];
  /** Consecutive evenings spent below the insolvency line (normal/hard). */
  distressDays?: number;
  /** Running tallies for the current service; reset at START_SERVICE. */
  service?: ServiceTally;
  /** Recent events, for deck cooldowns. */
  eventHistory?: { eventId: EventId; day: number }[];
  /** Why the game ended, when phase === "gameover". */
  gameOverReason?: string;
  // ── round 2 additions ──
  /** Live problems during service the player can react to. Cleared at START_SERVICE. */
  incidents?: Incident[];
  /** Guided objectives; the first N unfinished are shown by the UI. */
  goals?: Goal[];
  /** Owner coverage this service: which roles the owner is filling because nobody is rostered. */
  ownerCovering?: StaffRole[];
  /** [round 2, sim-core] Owner tiredness 0-100 from covering shifts; persists across days and slows the owner when covering. */
  ownerFatigue?: number;
  /** [round 2, sim-core] This morning's delivery that came up short (drives the supplier_short incident). Cleared at END_DAY. */
  shortDelivery?: { ingredientId: IngredientId; missing: number };
  /** [round 2, sim-core] Incidents the player has resolved by choosing an option (lifetime; drives goals). */
  incidentsHandled?: number;
  // ── round 3 additions (all optional; save version stays 1) ──
  /**
   * A human is playing a role in the hands-on view (SET_HANDS_ON). The sim backs off that role with a slow fallback
   * (see docs/SIM-NOTES.md "Round 3 hooks"). `since` = the service tick it was set (0 when set in planning). Cleared when
   * service closes (and at END_DAY).
   */
  handsOn?: {
    role: StaffRole;
    since: number;
    /**
     * Career mode: the Staff member the human plays. Used to attribute the human's plates (DayResult.perChef); their
     * Staff record still runs as AI for the fallback work (tickets beyond the human's reserve).
     */
    staffId?: StaffId;
  };
  /** A fixed-price set/tasting menu (SET_SET_MENU). While active, foodie and business parties order it. */
  setMenu?: SetMenu;
  /** The owner's own skills when covering (career handover); replaces OWNER.skill/speed/charm. SET_OWNER_PROFILE. */
  ownerProfile?: { skill: number; speed: number; charm: number };
  /** Per-game recruitment fee (career perk); replaces RECRUITMENT_FEE in HIRE when present. */
  recruitmentFee?: Pence;
}

/** [round 3] A footfall multiplier entry (GameState.footfallMods). */
export interface FootfallMod { mult: number; daysRemaining: number; source?: string }

/** [round 3] A fixed-price set menu: every guest who takes it gets every dish, for `price` per head. */
export interface SetMenu { dishIds: DishId[]; price: Pence; active: boolean }

// ───────────────────────── round 2: incidents & goals ─────────────────────────
/**
 * An Incident is a small live problem during service. It appears via INCIDENT_STARTED, sits in
 * state.incidents with a countdown, and resolves either by a player RESPOND_INCIDENT command
 * (one of its options) or by timing out (which applies its `ignored` effects). Options cost
 * something (cash, a server's attention, a chef's time) and have a visible outcome; the point is
 * that watching service has decisions in it.
 */
export type IncidentKind =
  | "sent_back"        // a plate comes back: remake (chef time), comp (cash), apologise (server charm)
  | "spill"            // table needs cleaning: send porter/server (slower service), ignore (satisfaction hit)
  | "big_party"        // a walk-in party larger than any table: push tables together (ties up a server), turn away
  | "rush"             // a surge in arrivals for ~10 ticks: 86 slow dishes, call in off-duty staff (cost), ride it
  | "supplier_short"   // a delivery is short: buy at the corner shop (expensive), 86 the dish
  | "equipment"        // fryer/oven trips: quick fix (chef time), call engineer (cash), limp on (slow kitchen)
  | "vip"              // a critic or influencer is seated: assign your best server, send a freebie
  | "staff_wobble";    // a staff member is flagging: give a break (short-handed), push on (mood hit)

export interface IncidentOption {
  id: string;
  label: string;                       // short button text
  description: string;                 // one line: cost and likely outcome
  cost?: Pence;                        // shown and charged if chosen
  /** [round 2, integration] Why this option can't be chosen right now (e.g. "No two free tables"); absent = available. Refreshed every tick. */
  disabled?: string;
}

export interface Incident {
  id: string;
  kind: IncidentKind;
  startedTick: number;
  /** Ticks left before it auto-resolves as ignored. */
  ticksLeft: number;
  title: string;
  body: string;
  options: IncidentOption[];
  /** Related entities for the UI to highlight. */
  customerId?: CustomerId;
  tableId?: TableId;
  staffId?: StaffId;
  dishId?: DishId;
  /** [round 2, sim-core] Kind-specific number: plate quality (sent_back), portions missing (supplier_short), party size (big_party). */
  value?: number;
  /** Set once resolved (option id or "ignored"); resolved incidents are kept for the evening summary. */
  resolution?: string;
  /** One-line outcome text written when resolved, shown in the ticker and evening. */
  outcome?: string;
}

export type GoalKind =
  | "add_dishes" | "hire_role" | "order_stock" | "open_first_day" | "serve_covers" | "earn_rating"
  | "profit_day" | "profit_week" | "buy_table" | "survive_days" | "resolve_incident" | "reach_popularity";

export interface Goal {
  id: string;
  kind: GoalKind;
  title: string;
  hint: string;                        // where to click
  target: number;                      // e.g. covers to serve
  progress: number;
  done: boolean;
  /** Reward on completion: a little cash and/or popularity so goals feel worth it. */
  reward?: { cash?: Pence; popularity?: number };
  /** Shown in order; goals unlock when all lower `tier` goals are done. */
  tier: number;
  /** [round 2, sim-core] For hire_role goals: which role. */
  role?: StaffRole;
}

/**
 * [round 2, sim-core] A temporary service modifier from an incident, active while tick < untilTick.
 * actions: + FOH actions per tick (negative = a server tied up). kitchen: × kitchen progress per tick.
 * arrivals: × passing parties. `source` is the incident id that created it.
 */
export interface ServiceMod { kind: "actions" | "kitchen" | "arrivals"; value: number; untilTick: number; source?: string }

/** Added to DayResult (optional). */
export interface IncidentSummary { kind: IncidentKind; resolution: string; outcome: string }

/** [sim-core addition] Per-service accumulators used to build the DayResult. */
export interface ServiceTally {
  parties: number;
  ratingSum: number;          // Σ rating × partySize
  satisfactionSum: number;    // Σ satisfaction × partySize
  ratedCovers: number;
  qualitySum: number;         // Σ plate quality
  plates: number;
  /**
   * Per dish: plates sold (paid for), plates cooked, Σ plate quality, Σ margin; [round 3, optional] takings and
   * stock cost of plates fired (for DayResult.perDish).
   */
  dishes: Record<DishId, { sold: number; plated: number; qualitySum: number; margin: Pence; revenue?: Pence; foodCost?: number }>;
  /** Potential parties expected today (arrival system), for the UI and stats. */
  potentialParties: number;
  /** Per-segment arrival inputs fixed at START_SERVICE (recomputed on EIGHTY_SIX). */
  arrivals: { segment: SegmentId; potentialParties: number; entryLogit: number }[];
  nextCustomer: number;       // id counters
  nextTicket: number;
  /** Front-of-house actions gained per tick (fixed for the service). */
  actionsPerTick: number;
  /** Front-of-house actions left this tick (fraction carries over, capped at 1). */
  actionsLeft: number;
  plateWaste: Pence;
  walkoutParties: number;
  /** Tips earned by front of house today (tips are staff money, not revenue). */
  serverTips: Pence;
  /** Portions of each ingredient consumed today (prep waste basis). */
  ingredientsUsed: Record<IngredientId, number>;
  /** One entry per paying party, for review sampling. */
  paid: { segment: SegmentId; partySize: number; rating: number; quality: number; dishId?: DishId }[];
  // ── round 2 (optional so mid-service saves from round 1 still load) ──
  /** Ingredient cost actually paid (FIFO cost basis) for plates fired today; float, rounded into foodCost. */
  foodCost?: number;
  /** Mean charm of front of house right now (owner/fatigue/breaks applied). */
  frontCharm?: number;
  /** Temporary service modifiers from incidents: extra FOH actions per tick, or a kitchen speed multiplier. */
  mods?: ServiceMod[];
  /** Fractional kitchen progress carried between ticks while the kitchen is slowed. */
  kitchenCarry?: number;
  /** Prestige gained or lost from critics today; folded in by ReputationSystem. */
  prestigeBonus?: number;
  /** Popularity gained or lost from incidents today (e.g. turning a big party away); folded in by ReputationSystem. */
  popularityBonus?: number;
  /** Cash spent on incident options today (see DayResult.incidentCosts). */
  incidentCosts?: number;
  /** Incidents started this service, last start tick, and the id counter. */
  incidentsStarted?: number;
  lastIncidentTick?: number;
  // ── round 3 (optional) ──
  /** Per cook: plates and Σ quality (for DayResult.perChef). Keys: staff id, "owner", "player". */
  chefs?: Record<string, { plates: number; qualitySum: number }>;
  /** Σ freshness of plated (non-remake) plates (for DayResult.freshnessMean; divide by `plates`). */
  freshnessSum?: number;
}

export interface LogEntry { day: number; tick: number; text: string; kind: "info" | "good" | "bad" | "money" }

// ───────────────────────── commands (UI → sim) ─────────────────────────
export type Command =
  | { type: "NEW_GAME"; seed: number; districtId: DistrictId; restaurantName: string; difficulty: Difficulty }
  | { type: "SET_MENU_ITEM"; dishId: DishId; price?: Pence; active?: boolean }
  | { type: "ADD_MENU_ITEM"; dishId: DishId; price: Pence }
  | { type: "REMOVE_MENU_ITEM"; dishId: DishId }
  | { type: "HIRE"; candidateIndex: number }
  | { type: "FIRE"; staffId: StaffId }
  | { type: "SET_ROTA"; staffId: StaffId; rota: boolean[] }
  | { type: "ORDER_STOCK"; ingredientId: IngredientId; qty: number }
  | { type: "BUY_TABLE" }
  | { type: "START_SERVICE" }
  | { type: "COMP_TABLE"; customerId: CustomerId }      // free their meal, big satisfaction boost
  | { type: "EIGHTY_SIX"; dishId: DishId }               // pull a dish for today
  | { type: "END_DAY" }                                  // from evening → next planning
  | { type: "RESOLVE_EVENT"; choiceId: string }
  // round 2
  | { type: "RESPOND_INCIDENT"; incidentId: string; optionId: string }
  | { type: "TRAIN"; staffId: StaffId }                  // planning: pay for a training day (skill up, not on rota that day)
  | { type: "GIVE_BREAK"; staffId: StaffId }             // service: short break (fatigue down, briefly short-handed)
  // round 3 — hands-on results (service only; see docs/SIM-NOTES.md "Round 3 hooks")
  | { type: "PLAYER_COOKED"; ticketId: string; quality: number }
  | { type: "PLAYER_SERVED"; customerId: CustomerId; ticketId: string; speedBonus: number }
  | { type: "PLAYER_CLEARED"; tableId: TableId }
  | { type: "PLAYER_TOOK_PAYMENT"; customerId: CustomerId }
  | { type: "PLAYER_DROPPED"; ticketIds: string[]; cost: Pence }
  /** [round 3 review] The hands-on human picked a ticket up: the AI leaves it alone until HANDS_ON.claimTimeoutTicks. */
  | { type: "PLAYER_CLAIMED"; ticketId: string }
  | { type: "SET_HANDS_ON"; role: StaffRole | null; staffId?: StaffId } // planning or service; null = human left
  // round 3 — paths and career
  | { type: "CLOSE_TODAY" }                              // planning → evening with a closed DayResult
  | { type: "SET_SET_MENU"; dishIds: DishId[]; price: Pence; active: boolean } // planning
  | { type: "SET_OWNER_PROFILE"; skill: number; speed: number; charm: number } // planning/evening/event
  /** [round 3 review] Hire a known person (a former colleague, a poached chef): planning; fee + cash buffer as HIRE. */
  | { type: "HIRE_STAFF"; staff: Staff };

// ───────────────────────── events (sim → UI) ─────────────────────────
export type SimEvent =
  | { type: "CUSTOMER_ARRIVED"; customerId: CustomerId }
  | { type: "CUSTOMER_SEATED"; customerId: CustomerId; tableId: TableId }
  | { type: "CUSTOMER_WALKED_OUT"; customerId: CustomerId }
  | { type: "DISH_PLATED"; ticketId: string; quality: number }
  | { type: "CUSTOMER_PAID"; customerId: CustomerId; spend: Pence; tip: Pence; rating: number }
  | { type: "SERVICE_ENDED"; result: DayResult }
  | { type: "EVENT_TRIGGERED"; eventId: EventId }
  | { type: "CASH_LOW"; cash: Pence }
  | { type: "GAME_OVER"; reason: string }
  | { type: "LOG"; entry: LogEntry }
  // round 2
  | { type: "INCIDENT_STARTED"; incidentId: string }
  | {
      type: "INCIDENT_RESOLVED";
      incidentId: string;
      resolution: string;
      outcome: string;
      /** [integration] How it went: "bad" when ignored or a costly choice, "neutral" for a shrug (closing time, ride it out). */
      tone?: "good" | "bad" | "neutral";
    }
  | {
      type: "GOAL_COMPLETED";
      goalId: string;
      /** [integration] The reward just paid (absent when the goal has none). */
      reward?: { cash?: Pence; popularity?: number };
    };

export interface StepResult {
  state: GameState;
  events: SimEvent[];
}

/** Candidates offered in the planning phase; derived, not stored. */
export interface Candidate {
  name: string;
  role: StaffRole;
  skill: number; speed: number; charm: number;
  wage: Pence;
  traits: string[];
  /** Fuzzy band shown to the player, e.g. "promising". */
  potentialHint: string;
  /** [sim-core addition] True once hired today; the index stays stable but cannot be hired again. */
  hired?: boolean;
}

/** Menu-matrix classification for the UI. */
export type MenuQuadrant = "star" | "ploughhorse" | "puzzle" | "dog";

// ───────────────────────── public API shape ─────────────────────────
/**
 * sim-core exports these functions (see index.ts). They are pure.
 *
 *   newGame(content, cmd: NEW_GAME): GameState
 *   applyCommand(content, state, cmd): StepResult     // planning/evening/event commands
 *   tick(content, state): StepResult                  // one service tick; no-op outside service
 *   runDay(content, state): StepResult                // convenience: START_SERVICE → all ticks → evening
 *   candidates(content, state): Candidate[]           // deterministic from seed+day
 *   classifyMenu(content, state): Record<DishId, MenuQuadrant>
 *   serialize(state): string / deserialize(json): GameState  (with version migration)
 */
