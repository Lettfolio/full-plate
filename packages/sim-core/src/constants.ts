/**
 * Every tunable number used by sim-core logic that is not in content's BalanceDef.
 * The balance agent may change these freely; no logic lives here.
 * Money is integer pence. "Tick" = 5 in-game minutes.
 */
import type { Difficulty, StaffRole } from "./types";

export const SAVE_VERSION = 1 as const;

// ── calendar ──
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
/** Month (1-12) of day 0. April matches the NLW uprating date in the brief. */
export const START_MONTH = 4;
/** Weekday of day 0 (0 = Monday). Opening on a Wednesday gives a gentle first weekend. */
export const START_WEEKDAY = 2;
/** Weekday indices (0 = Monday) treated as weekend for footfall. */
export const WEEKEND_DAYS: readonly number[] = [4, 5, 6];

// ── opening ──
/**
 * Default opening stock allowance (pence) when content's BalanceDef.openingStockBudget is absent.
 * newGame starts with an empty larder; at the first START_SERVICE this much (at most) is spent on what the
 * active menu needs for OPENING_STOCK_COVER_MULT × the first-day cover forecast, delivered at once.
 */
export const OPENING_STOCK_BUDGET = 60_000;
export const OPENING_STOCK_COVER_MULT = 1.3;
export const STARTING_POPULARITY = 40;
export const STARTING_PRESTIGE = 30;

// ── difficulty ──
export const DIFFICULTY: Record<Difficulty, { footfallMult: number; costMult: number; canGoBust: boolean }> = {
  cosy: { footfallMult: 1.15, costMult: 0.9, canGoBust: false },
  normal: { footfallMult: 1, costMult: 1, canGoBust: true },
  hard: { footfallMult: 0.8, costMult: 1.2, canGoBust: true },
};

// ── arrivals ──
export const ENTRY_BIAS = -3.2;
export const APPEAL_WEIGHT = 1.2;
/** Σ baseAppeal over the active menu is capped here before weighting. */
export const APPEAL_CAP = 2.5;
export const PRICE_GAP_WEIGHT = 4;
/**
 * Extra entry-logit penalty per unit of markup over the going rate (Σ menu price ÷ Σ suggestedPrice − 1),
 * scaled by priceSensitivity. Passers-by compare you with similar places, not only with their budget;
 * without this, pricing 25% over suggested loses too few guests and strictly dominates (docs/REVIEW.md).
 * Pricing at or below suggested is unaffected.
 */
export const MARKUP_WEIGHT = 8;
export const QUEUE_PENALTY_PER_PARTY = 0.35;
export const MAX_QUEUE_PARTIES = 8;
/** Prestige adds up to this much to the entry logit for quality-weighted segments. */
export const PRESTIGE_APPEAL_WEIGHT = 0.6;
/** No new parties after this tick (last seating ~90 minutes before close). */
export const LAST_SEATING_TICK = 102;
/** Expected extra courses per head used when estimating spend-per-head for the price gap. */
export const COURSE_ORDER_CHANCE: Record<string, number> = {
  starter: 0.3,
  dessert: 0.3,
  drink: 0.6,
  side: 0.2,
};

// ── patience (points per tick, 0-100 scale) ──
export const PATIENCE_START = 100;
export const PATIENCE_DECAY: Record<"queue" | "seated" | "ordered", number> = {
  queue: 6,
  seated: 4,
  ordered: 2.2,
};
/** Decay is multiplied by (PATIENCE_SPEED_BASE + segment.speedWeight). */
export const PATIENCE_SPEED_BASE = 0.5;
/** Patience restored when a queued party is finally seated. */
export const SEATED_PATIENCE_RESTORE = 30;
/** Popularity lost per walk-out party (applied in the evening). */
export const WALKOUT_POPULARITY_HIT = 0.15;
export const WALKOUT_POPULARITY_HIT_CAP = 3;

// ── ordering ──
/** Weight multiplier for a dish = 1 − sens × clamp((price − suggested)/suggested, lo, hi). */
export const ORDER_PRICE_CLAMP: [number, number] = [-0.5, 1];
export const MIN_DISH_WEIGHT = 0.02;

// ── kitchen ──
export const CHEF_PARALLEL_TICKETS = 3;
export const BAR_PARALLEL_TICKETS = 4;
/** prep ticks × (SPEED_TICKS_BASE − SPEED_TICKS_SLOPE × speed/100). */
export const SPEED_TICKS_BASE = 1.6;
export const SPEED_TICKS_SLOPE = 1.2;
/**
 * Plate quality before ceiling/fatigue = PIVOT + (skill − PIVOT) × SLOPE. A slope above 1 makes a good
 * chef visibly better than an average one (and a tired owner visibly worse).
 */
export const SKILL_QUALITY_PIVOT = 50;
export const SKILL_QUALITY_SLOPE = 1.4;
export const SKILL_GAP_PENALTY = 0.8;
export const FATIGUE_QUALITY_PENALTY = 0.15;
export const QUALITY_NOISE_SD = 4;
export const MISTAKE_BASE_CHANCE = 0.02;
/** Extra mistake chance per point the chef is below the dish's skill requirement. */
export const MISTAKE_PER_SKILL_GAP = 0.005;
export const MISTAKE_QUALITY_HIT = 30;
/** Mood scales effective skill/speed between these bounds (mood 0 → low, 100 → high). */
export const MOOD_EFFECT_RANGE: [number, number] = [0.85, 1.1];

// ── freshness ──
export const IN_SEASON_QUALITY_BONUS = 3;
export const IN_SEASON_COST_MULT = 0.85;
/** Fresh stock adds up to FRESH_BONUS_MAX; stock at its shelf life subtracts up to FRESH_PENALTY_MAX. */
export const FRESH_BONUS_MAX = 4;
export const FRESH_PENALTY_MAX = 6;

// ── owner fallback (when nobody of a role is on today) ──
/** The owner is a mediocre generalist who covers any chef/server gap. */
export const OWNER = { skill: 40, speed: 45, charm: 50, serverActions: 1.5, chefTickets: 2 };
/** Covering kitchen AND floor: the owner is in two places, so kitchen throughput (1/cook time) and FOH actions are × this. */
export const OWNER_BOTH_SPEED_MULT = 0.5;
/** Covering both: each plate waits this many extra ticks at the pass before the owner can run it out. */
export const OWNER_PASS_DELAY_TICKS = 1;
/** Covering both: tables take this many extra ticks to clear. */
export const OWNER_EXTRA_DIRTY_TICKS = 1;
/** Owner fatigue (0-100) gained per role covered in a service, plus per 10 covers served that day. */
export const OWNER_FATIGUE_PER_ROLE = 22;
export const OWNER_FATIGUE_PER_10_COVERS = 1;
/** Owner fatigue recovered on an evening when the owner did not cover. */
export const OWNER_FATIGUE_RECOVERY = 25;
/** At fatigue 100 the owner's skill, speed, charm and actions are × (1 − this). */
export const OWNER_FATIGUE_EFFECT = 0.4;
/** Above this owner fatigue the evening log warns the player. */
export const OWNER_FATIGUE_WARNING = 60;

// ── front of house ──
/** Actions per server per tick = SERVER_ACTIONS_BASE + speed / SERVER_ACTIONS_SPEED_DIV. */
export const SERVER_ACTIONS_BASE = 1;
export const SERVER_ACTIONS_SPEED_DIV = 50;
export const MANAGER_EXTRA_ACTIONS = 0.5;
/** Front-of-house action costs (actions accrue per tick from servers). */
export const SEAT_ACTION_COST = 0.5;
export const ORDER_ACTION_COST = 1;
export const PAY_ACTION_COST = 0.5;
/** Unused actions carried to the next tick are capped here. */
export const ACTIONS_CARRY_CAP = 1;
/** Ticks a seated party reads the menu before it can order. */
export const MENU_READ_TICKS = 1;
export const EAT_TICKS_BASE = 8;
export const EAT_TICKS_PER_EXTRA_GUEST = 1;
export const DIRTY_TICKS = 3;
export const DIRTY_TICKS_WITH_PORTER = 1;
/** [review round 2] A porter also helps front of house: extra FOH actions per tick (fetching, clearing, water). */
export const PORTER_EXTRA_ACTIONS = 0.5;

// ── front-of-house charm (0-100; 50 = neutral) ──
/** Patience decay × (1 + WEIGHT × (50 − charm)/50), clamped to CHARM_PATIENCE_CLAMP. */
export const CHARM_PATIENCE_WEIGHT = 0.3;
export const CHARM_PATIENCE_CLAMP: [number, number] = [0.6, 1.4];
/** Tips × (TIP_CHARM_BASE + TIP_CHARM_SLOPE × charm/100). Charm 50 ⇒ ×1. */
export const TIP_CHARM_BASE = 0.6;
export const TIP_CHARM_SLOPE = 0.8;
/** A 3★ party becomes 4★ with chance UPGRADE_MAX × (charm − UPGRADE_FROM)/(100 − UPGRADE_FROM). */
export const CHARM_UPGRADE_FROM = 40;
export const CHARM_UPGRADE_MAX = 0.4;

// ── satisfaction & rating ──
export const CHARM_SATISFACTION_MAX = 10;
/** Waiting (arrival → last plate) up to this many ticks costs nothing in the speed score. */
export const WAIT_GRACE_TICKS = 6;
export const WAIT_PENALTY_PER_TICK = 4;
/** Patience points docked when a party's dish runs out and they must choose again. */
export const OUT_OF_STOCK_PATIENCE_HIT = 10;
export const COMP_SATISFACTION_BONUS = 25;
/** value score = VALUE_MID + VALUE_SLOPE × (budget − spendPerHead)/budget, clamped 0-100. */
export const VALUE_MID = 50;
export const VALUE_SLOPE = 100;
/** Satisfaction ≥ threshold[i] ⇒ rating i+2 (below the first ⇒ 1). */
export const RATING_THRESHOLDS: readonly number[] = [35, 50, 65, 80];
export const TIP_MIN_RATING = 3;

// ── reviews ──
export const REVIEW_SOURCE_WEIGHTS: { source: "online" | "wordofmouth" | "walkin"; weight: number }[] = [
  { source: "online", weight: 0.6 },
  { source: "wordofmouth", weight: 0.3 },
  { source: "walkin", weight: 0.1 },
];

// ── reputation ──
export const POPULARITY_PULL = 0.1;
export const RATING_TO_POPULARITY = 20;
export const PRESTIGE_GOOD_REVIEW = 0.6;
export const PRESTIGE_BAD_REVIEW = 0.4;
export const PRESTIGE_GOOD_MIN_RATING = 4;
export const PRESTIGE_GOOD_MIN_QUALITY = 70;
export const PRESTIGE_BAD_MAX_RATING = 2;
export const REPUTATION_NEUTRAL = 50;

// ── finance ──
export const SHIFT_HOURS = 10;
/** Fixed daily overheads (utilities, insurance, business rates), scaled by difficulty cost multiplier. */
export const OVERHEADS_DAILY = 8_000;
/** UK standard VAT; menu prices include it, so VAT owed = revenue × rate / (1 + rate). */
export const VAT_RATE = 0.2;
/** Card processing fee as a share of revenue. */
export const CARD_FEE_RATE = 0.015;
/** Employer NI + pension on top of hourly wage. */
export const EMPLOYER_ONCOST = 0.1;
export const TABLE_COST = 60_000;
export const RECRUITMENT_FEE = 15_000;
/** Hiring needs cash ≥ fee + this many shifts of the candidate's wage. */
export const HIRE_CASH_BUFFER_SHIFTS = 5;
export const MAX_STAFF = 12;
/** Stock may be ordered into an overdraft down to −this. */
export const STOCK_OVERDRAFT_LIMIT = 300_000;
export const MAX_ORDER_QTY = 1000;
export const MAX_PRICE = 100_000;
export const MAX_MENU_ITEMS = 16;
/** Insolvency line = −(months × rent + months × wages). */
export const INSOLVENCY_MONTHS = 3;
export const INSOLVENCY_DAYS = 14;
/** Cash warning threshold for CASH_LOW in normal/hard. */
export const CASH_LOW_WARNING = 0;

// ── waste ──
/** Extra stock trimmed in prep as a fraction of portions used, at waste share 0.45 and chef skill 50. */
export const PREP_WASTE_RATE = 0.08;
/** Satisfaction below this leaves food on the plate. */
export const PLATE_WASTE_SATISFACTION = 60;
export const PLATE_WASTE_MAX_FRACTION = 0.5;
/** Reference waste shares (WRAP); content shares scale relative to these. */
export const WRAP_SHARES = { prep: 0.45, plate: 0.34, spoil: 0.21 };

// ── staff ──
export const CANDIDATES_MIN = 3;
export const CANDIDATES_MAX = 5;
/** First candidates cover these roles before random picks. */
export const CANDIDATE_CORE_ROLES: readonly StaffRole[] = ["chef", "server"];
export const POTENTIAL_HINTS: { min: number; label: string }[] = [
  { min: 85, label: "a natural" },
  { min: 70, label: "promising" },
  { min: 55, label: "steady" },
  { min: 0, label: "limited" },
];
/** Hidden potential = skill + U(0, POTENTIAL_HEADROOM), capped at 100. */
export const POTENTIAL_HEADROOM = 30;
/** Default rota, index = weekday (0 = Monday): five shifts, Monday and Tuesday off. */
export const DEFAULT_ROTA: readonly boolean[] = [false, false, true, true, true, true, true];
export const START_MOOD = 70;
export const SKILL_GROWTH_PER_SHIFT = 0.15;
export const FATIGUE_PER_SHIFT = 10;
/** Extra fatigue per shift per 10 covers handled per staff member. */
export const FATIGUE_PER_10_COVERS = 1.5;
export const FATIGUE_RECOVERY_PER_REST_DAY = 30;

// ── training & breaks ──
/** TRAIN: course fee (pence); the staff member is off the floor that day (still paid if rostered). */
export const TRAINING_FEE = 12_000;
/** Skill gained from a training day, toward (never past) potential. */
export const TRAINING_SKILL_GAIN: [number, number] = [3, 6];
export const TRAINING_MOOD = 2;
/** GIVE_BREAK: fatigue removed and how long they are off the floor. */
export const BREAK_FATIGUE_RELIEF = 20;
export const BREAK_TICKS = 6;
export const FATIGUE_MOOD_THRESHOLD = 60;
export const FATIGUE_MOOD_DIVISOR = 8;
/** Rota days beyond this per week cost mood each day worked. */
export const OVERWORK_DAYS = 5;
export const OVERWORK_MOOD_PER_DAY = 1.5;
export const GOOD_DAY_MOOD_PER_STAR = 2;
/** Expected tips per worked shift (pence) for front-of-house; deviations move mood. */
export const TIP_EXPECTATION_PER_SHIFT = 1_500;
export const TIP_MOOD_MAX = 3;
export const REST_DAY_MOOD = 1;
export const MANAGER_MOOD_BONUS = 1;
export const MOOD_DRIFT_TARGET = 60;
export const MOOD_DRIFT_RATE = 0.03;
export const FIRE_MOOD_HIT = 5;
/** Below this mood a staff member may quit each evening. */
export const QUIT_MOOD = 12;
export const QUIT_CHANCE = 0.25;

// ── incidents (live service problems; see systems/incidents.ts) ──
export const INCIDENT_MAX_LIVE = 2;
export const INCIDENT_MAX_PER_SERVICE = 3;
/** Minimum ticks between two incidents starting. */
export const INCIDENT_MIN_GAP_TICKS = 10;
/** No new incidents in the last ticks of service. */
export const INCIDENT_LAST_START_TICK = 108;
/** ticksLeft drawn uniformly from this range. */
export const INCIDENT_TIMEOUT_TICKS: [number, number] = [6, 12];
/** Per-tick start chances (when the kind's condition holds). */
export const INCIDENT_RATES = {
  /** Chance per party that starts eating with mean plate quality below SENT_BACK_QUALITY. */
  sentBackPerParty: 0.4,
  /** Per seated-cover per tick: ≈ 1 spill per 60 covers (a cover sits ~12 ticks). */
  spillPerCoverTick: 1 / 720,
  bigParty: 0.006,
  rush: 0.05,
  supplierShort: 0.25,
  equipment: 0.0012,
  vip: 0.004,
  staffWobble: 0.02,
};
export const SENT_BACK_QUALITY = 45;
export const RUSH_MIN_POTENTIAL_PARTIES = 30;
export const RUSH_MIN_QUEUE = 4;
export const VIP_MIN_POPULARITY = 60;
export const STAFF_WOBBLE_FATIGUE = 75;
/** Chance a delivery line arrives short each morning (one line at most), and the share that turns up. */
export const SHORT_DELIVERY_CHANCE = 0.12;
export const SHORT_DELIVERY_SHARE: [number, number] = [0.3, 0.7];
/** Incident option effects. */
export const INCIDENT = {
  /** sent_back */
  remakeTicks: 3,
  /** Extra ticks a remake party keeps their table waiting for the new plate. */
  remakeWaitTicks: 4,
  apologyMaxBonus: 12,
  sentBackIgnoredHit: -15,
  /** spill */
  spillServerActions: -0.5,
  spillServerTicks: 4,
  spillCleanBonus: 3,
  spillIgnoredHit: -10,
  spillIgnoredDirtyTicks: 3,
  /** big_party: sizes seatsPerTable+1 … 2×seatsPerTable; seating them costs FOH actions for a few ticks. */
  bigPartyServerActions: -0.75,
  bigPartyServerTicks: 4,
  bigPartyTurnAwayPopularity: -0.3,
  bigPartyIgnoredPopularity: -1,
  /** rush */
  rushTicks: 10,
  rushArrivalMult: 1.6,
  rushCallInCost: 6_000,
  rushCallInActions: 1.5,
  rushCallInKitchen: 1.3,
  rushSimplifyKitchen: 1.2,
  /** supplier_short */
  cornerShopMult: 2.5,
  /** equipment */
  equipmentFixTicks: 5,
  equipmentFixKitchen: 0.6,
  engineerCost: 12_000,
  engineerTicks: 2,
  engineerKitchen: 0.8,
  equipmentIgnoredTicks: 30,
  equipmentIgnoredKitchen: 0.7,
  /** vip */
  vipServerActions: -0.4,
  vipServerTicks: 10,
  vipBestServerMaxBonus: 14,
  vipFreebieBonus: 8,
  /** Fallback freebie cost when no starter/dessert is on the menu. */
  vipFreebieCost: 600,
  /** Prestige per star away from 3 in the critic's verdict (5★ ⇒ +5, 1★ ⇒ −5). */
  vipPrestigePerStar: 2.5,
  vipWalkoutPrestige: -5,
  /** staff_wobble */
  wobblePushOnMood: -3,
  wobbleIgnoredMood: -6,
  wobbleIgnoredFatigue: 5,
} as const;

// ── goals ──
/** Goals shown at once is a UI choice; the sim stores every unlocked goal. */
export const GOAL_PROFIT_WEEK_DAYS = 7;

// ── forecasting (suggestedOrder) ──
/** Covers forecast before the first service when the model gives nothing usable. */
export const FORECAST_MIN_COVERS = 20;
/** History forecast = busiest recent demand (covers + walk-outs) × this. */
export const FORECAST_HISTORY_MULT = 1.1;
export const FORECAST_WINDOW_DAYS = 7;
/** Suggested orders are rounded up to multiples of this. */
export const ORDER_ROUND_TO = 5;

// ── events ──
export const EVENT_CHANCE_PER_DAY = 0.15;
export const EVENT_MIN_GAP_DAYS = 3;
export const EVENT_REPEAT_COOLDOWN_DAYS = 21;
export const EVENT_HISTORY_MAX = 30;

// ── bookkeeping ──
export const LOG_MAX = 200;
export const HISTORY_MAX = 400;
export const MENU_WINDOW_DAYS = 7;
/** Kasavana–Smith 70% rule: popular if sold ≥ this × mean sold. */
export const MENU_POPULARITY_RULE = 0.7;

// ── round 3: hands-on, closed days, set menus ──
/**
 * Hands-on fallback rules (SET_HANDS_ON; docs/SIM-NOTES.md "Round 3 hooks").
 * - passHoldTicks: with a human server (all plates) or bar (drinks) on, plates wait at the pass; an AI colleague carries
 *   one only once it has waited this many ticks.
 * - reserveTickets / reserveFallbackTicks: with a human chef (food) or bar (drinks) on, the oldest `reserveTickets`
 *   unassigned tickets of that kind are left on the rail for the human; AI cooks take only tickets beyond those, or a
 *   reserved ticket once it has waited `reserveFallbackTicks` since it was fired.
 * - payHoldTicks: with a human server or bar on, AI front of house takes a party's payment only once it has been
 *   waiting to pay this many ticks (the human's PLAYER_TOOK_PAYMENT is immediate). Waiting to pay costs no satisfaction.
 * - speedBonusSatisfaction: PLAYER_SERVED speedBonus 1 on every plate of a party adds this much satisfaction in total.
 * - maxDropCost: PLAYER_DROPPED cost cap (pence) — a drop is a soft failure.
 * - claimTimeoutTicks: a PLAYER_CLAIMED ticket stays the human's this long before an AI cook may take it.
 */
export const HANDS_ON = {
  passHoldTicks: 4,
  payHoldTicks: 4,
  reserveTickets: 3,
  reserveFallbackTicks: 4,
  speedBonusSatisfaction: 8,
  maxDropCost: 5_000,
  /**
   * Round 3 review: a ticket the human has picked up (PLAYER_CLAIMED) is theirs for this many ticks; then, if it is
   * still not plated, an AI cook takes it (the child wandered off). A hands-on cook takes 6–10 s ≈ 4–7 ticks.
   */
  claimTimeoutTicks: 16,
  /**
   * Round 4: with a hands-on station (SET_HANDS_ON station), a ticket on the human's rail is theirs; the hands-on
   * session's sous chef covers an idle child in real seconds. This is only the sim's safety net (the view was closed
   * without SET_HANDS_ON null): after this many ticks on the rail an AI cook takes it.
   */
  stationFallbackTicks: 40,
  /** Largest rail SET_HANDS_ON accepts. */
  stationMaxCap: 6,
} as const;
/** Key used for the human in DayResult.perChef and KitchenTicket.chefId when SET_HANDS_ON gave no staffId. */
export const PLAYER_COOK_ID = "player";
/** CLOSE_TODAY: rostered staff are paid this share of a shift (notice pay for a shut day). */
export const CLOSED_DAY_WAGE_SHARE = 0.5;
/** Segments that order the set menu when GameState.setMenu is active. */
export const SET_MENU_SEGMENTS: readonly string[] = ["foodies", "business"];
/** Budget multiplier for the set-menu value/price-gap comparison (a tasting-menu budget); 1 when absent. */
export const SET_MENU_BUDGET_MULT: Readonly<Record<string, number>> = { foodies: 1.6 };
/** At most this many dishes in a set menu. */
export const SET_MENU_MAX_DISHES = 12;
