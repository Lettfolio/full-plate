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
/** Portions of every ingredient delivered before opening day; cost is taken from starting cash. */
export const OPENING_STOCK_PORTIONS = 40;
export const STARTING_POPULARITY = 40;
export const STARTING_PRESTIGE = 30;

// ── difficulty ──
export const DIFFICULTY: Record<Difficulty, { footfallMult: number; costMult: number; canGoBust: boolean }> = {
  cosy: { footfallMult: 1.15, costMult: 0.9, canGoBust: false },
  normal: { footfallMult: 1, costMult: 1, canGoBust: true },
  hard: { footfallMult: 0.88, costMult: 1.1, canGoBust: true },
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
export const SPEED_TICKS_BASE = 1.4;
export const SPEED_TICKS_SLOPE = 0.8;
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
export const OWNER = { skill: 40, speed: 45, charm: 45, serverActions: 1.5, chefTickets: 2 };

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
