/**
 * Every tunable number in sim-stars. No logic lives here. Money is integer pence.
 * Real-world anchors are in docs/BRIEF.md "Path B — The Stars"; the numbers are tuned for play, see STARS-NOTES.md.
 */
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from "@full-plate/sim-core";

export const YEAR_DAYS = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360
/** RNG salt so a Stars stream never collides with the game's own stream. */
export const STARS_SALT = 0x57a25;

// ── calendar of the guides (month 1-12; each publishes on the 1st of its month) ──
/** Michelin Great Britain & Ireland is published in February. */
export const GUIDE_MONTH = 2;
export const FIFTY_BEST_MONTH = 6;
export const GOOD_FOOD_MONTH = 9;
export const GAULT_MILLAU_MONTH = 11;
/** The first guide day needs at least this long an assessment window. */
export const MIN_FIRST_WINDOW_DAYS = 180;

// ── inspectors ──
/** Inspectors leave a newly started Stars run alone for its first N days (the first window only). */
export const SETTLE_IN_DAYS = 21;
export const VISITS_MIN = 2;
export const VISITS_MAX = 5;
/** No visits in the last N days before guide day (the guide is at the printer). */
export const VISIT_CUTOFF_DAYS = 15;
/** "Inspection season": the last N days before guide day (more visits, more stress). */
export const SEASON_DAYS = 120;
/** Share of visits drawn inside inspection season. */
export const SEASON_VISIT_SHARE = 0.5;
/** Per-criterion noise of one inspector's palate. */
export const INSPECTOR_NOISE_SD = 3;
export const INSPECTOR_NAMES = ["Inspector A.", "Inspector B.", "Inspector C.", "Inspector D.", "Inspector E.", "Inspector F.", "Inspector G.", "Inspector H."];
/** Chance a real visit produces a cosy "someone was taking notes" hint; decoy chance on an ordinary open night. */
export const HINT_ON_VISIT = 0.4;
export const HINT_DECOY = 0.015;

// ── guide decision (Fat Duck rule) ──
/** Mean visit score needed for 1/2/3 stars. */
export const STAR_THRESHOLDS: readonly [number, number, number] = [78, 85, 91];
/** A promotion is normally +1 star per guide; +2 when the score clears the target threshold by this much over ≥ 3 visits. */
export const DOUBLE_JUMP_MARGIN = 3;
export const DOUBLE_JUMP_MIN_VISITS = 3;
/** Fat Duck rule: fewer open days than this, or fewer than MIN_VISITS_ASSESSED visits completed ⇒ not assessed ⇒ stars lapse. */
export const MIN_OPEN_DAYS_ASSESSED = 120;
export const MIN_VISITS_ASSESSED = 2;
/** On guide day the visit's consistency criterion is blended with the whole year's consistency by this weight. */
export const YEAR_CONSISTENCY_WEIGHT = 0.5;
/** Win: three stars held on this many consecutive guide days (and cash ≥ 0). */
export const WIN_YEARS = 5;
/** After HAND_BACK_STARS the guide leaves you out for this many guide days. */
export const HAND_BACK_EXCLUDED_YEARS = 3;

// ── proxies (see proxies.ts) ──
export const CONSISTENCY_WINDOW_DAYS = 60;
/** A day whose mean quality is this far below the window mean is an "off night". */
export const OFF_NIGHT_DROP = 8;
export const CONSISTENCY_SD_WEIGHT = 3;
export const CONSISTENCY_OFF_WEIGHT = 60;
/** Consistency also slips when the level itself is below this (a steady 60 is not "consistent" in Michelin terms). */
export const CONSISTENCY_LEVEL_FLOOR = 80;
export const CONSISTENCY_LEVEL_WEIGHT = 0.6;
/** Fewer than this many days in the window: shrink toward CONSISTENCY_PRIOR. */
export const CONSISTENCY_MIN_DAYS = 10;
export const CONSISTENCY_PRIOR = 60;
export const TECHNIQUE_AMBITION_SCALE = 1.35;
export const PERSONALITY_SIGNATURE_WEIGHT = 40;
export const PERSONALITY_REPUTATION_WEIGHT = 0.25;
export const PERSONALITY_HARMONY_WEIGHT = 0.45;
export const RELAUNCH_PERSONALITY_BONUS = 10;
export const LOYALTY_PERSONALITY_BONUS = 5;
export const INGREDIENTS_SEASON_WEIGHT = 25;
export const INGREDIENTS_PARTNER_WEIGHT = 20;
export const INGREDIENTS_HARMONY_WEIGHT = 0.55;
export const INGREDIENTS_PREPAID_BONUS = 5;
export const INGREDIENTS_BASE = 5;
/** Consistency criterion penalty per satellite whose head chef is not trained (the group cap). */
export const GROUP_CAP_PENALTY = 6;
/** Consistency penalty while the kitchen is disrupted (burnout, head chef just left). */
export const DISRUPTION_PENALTY = 15;
export const DISRUPTION_DAYS = 45;
/** Stress above this starts to cost consistency, by STRESS_CONSISTENCY_WEIGHT per point. */
export const STRESS_CONSISTENCY_FROM = 70;
export const STRESS_CONSISTENCY_WEIGHT = 0.4;
/** Each stagiaire adds this much consistency (more hands at the pass), up to STAGIAIRE_MAX. */
export const STAGIAIRE_CONSISTENCY = 1;
export const STAGIAIRE_MAX = 6;
/** EMA weight of each day's score for the non-Michelin tracks. */
export const DAILY_SCORE_ALPHA = 0.02;
export const DAILY_SCORE_START = 55;

// ── chef stress ──
/** Stress moves toward a target by this share per day. */
export const STRESS_PULL = 0.015;
export const STRESS_BASE = 20;
export const STRESS_PER_STAR = 14;
export const STRESS_SEASON = 10;
export const STRESS_PER_UNTRAINED_SATELLITE = 5;
/** Each stagiaire (paid or not) takes a little load off the head chef. */
export const STAGIAIRE_STRESS_RELIEF = 1;
export const STRESS_CLOSED_TARGET = 10;
/** Every consecutive year already held at three stars adds this (keeping it is harder than winning it). */
export const STRESS_PER_STREAK_YEAR = 3;
export const STAGIAIRE_RELIEF_MAX = 6;
export const STRESS_GUIDE_SPIKE_PER_STAR = 4;
export const STRESS_LOST_STAR_SPIKE = 10;
export const STRESS_WARNING = 75;
export const BURNOUT_FROM = 85;
/** Daily burnout chance per point above BURNOUT_FROM. */
export const BURNOUT_CHANCE_PER_POINT = 0.004;
export const BURNOUT_STRESS_AFTER = 40;
export const BURNOUT_PRESTIGE = -8;
export const BURNOUT_FOOTFALL = { mult: 0.85, days: 30 };

// ── head chef & the Smyth arc ──
export const REPUTATION_GAIN_BASE = 0.01;
export const REPUTATION_GAIN_PER_STAR = 0.025;
export const SMYTH_MIN_REPUTATION = 70;
export const SMYTH_MIN_TENURE = 3 * 360;
export const SMYTH_DAILY_CHANCE = 0.004;
export const SMYTH_DECISION_DAYS = 60;
/** Seed money for the head chef's own place (a minority stake; the alumni restaurant sends a share back daily). */
export const BACK_HEAD_CHEF_COST = 3_000_000;
export const LOYALTY_DAYS = 3 * 360;
export const NEW_HEAD_CHEF_REPUTATION = 30;
/** A chef this many skill points better than the head chef is promoted to the pass automatically. */
export const HEAD_CHEF_PROMOTE_GAP = 10;
export const RIVAL_GROWTH_PER_YEAR = 8;
/** Footfall lost per star the rival holds. */
export const RIVAL_FOOTFALL_PER_STAR = 0.04;

// ── stagiaires ──
/** Paid stagiaire, per day (8 h at NLW £12.71 + on-costs ≈ £110; Noma paid ~$50-70k a month for its whole cohort). */
export const STAGIAIRE_DAILY_WAGE = 11_000;
/** Unpaid: daily scandal chance per stagiaire, growing with the years the policy has run (the choice ages). */
export const STAGIAIRE_SCANDAL_CHANCE = 0.00015;
export const STAGIAIRE_SCANDAL_AGEING = 0.5;
export const SCANDAL_PRESTIGE = -15;
export const SCANDAL_POPULARITY = -10;
export const SCANDAL_FOOTFALL = { mult: 0.75, days: 60 };
export const SCANDAL_STRESS = 15;

// ── test kitchen ──
export const TEST_KITCHEN_COST = 800_000;
export const TEST_KITCHEN_DAILY = 2_000;
export const RESEARCH_COST = 60_000;
export const RESEARCH_BASE_DAYS = 20;
/** Signature dishes: × baseAppeal and + qualityCeiling in `withSignatures`; + footfall each (capped). */
export const SIGNATURE_APPEAL_MULT = 1.15;
export const SIGNATURE_CEILING_BONUS = 3;
export const SIGNATURE_FOOTFALL_EACH = 0.02;
export const SIGNATURE_FOOTFALL_CAP = 4;

// ── sourcing ──
export const SOURCING_DAILY = 1_000;
export const SOURCING_START_RELATIONSHIP = 10;
/** Relationship gained per open day (≈ 3.5 years to the top) and lost per closed day ("lost in a season"). */
export const SOURCING_GAIN = 0.07;
export const SOURCING_LOSS = 0.6;
export const SOURCING_SEASONAL_BASE = 0.02;
export const SOURCING_SEASONAL_SCALE = 0.08;

// ── ticketing ──
export const TICKETING_COST = 500_000;
/** Prepaid seats: fewer no-shows (footfall), cash up front buys a supplier discount (share of food cost back). */
export const PREPAID_FOOTFALL = 0.05;
export const PREPAID_SUPPLIER_DISCOUNT = 0.05;
/** Time-based pricing: premium Saturday, discounted Tuesday ⇒ a small revenue share. */
export const DYNAMIC_PRICING_UPLIFT = 0.03;

// ── satellites ──
export const SATELLITES: Record<"bar" | "bistro" | "ticketed" | "backed", { cost: number; daily: number; staff: number; label: string }> = {
  bar: { cost: 3_000_000, daily: 18_000, staff: 2, label: "Bar" },
  bistro: { cost: 6_000_000, daily: 32_000, staff: 4, label: "Bistro" },
  ticketed: { cost: 8_000_000, daily: 40_000, staff: 3, label: "Ticketed room" },
  backed: { cost: 0, daily: 8_000, staff: 0, label: "Alumni restaurant" },
};
/** Satellite takings rise with the flagship's stars (the name sells). */
export const SATELLITE_STAR_UPLIFT = 0.15;
export const SATELLITE_TRAINING_COST = 1_000_000;
export const SATELLITE_TRAINING_DAYS = 120;
export const MAX_SATELLITES = 5;

// ── refit / relaunch / endings ──
export const RELAUNCH_COST = 2_500_000;
export const RELAUNCH_CLOSED_DAYS = 30;
export const RELAUNCH_DAYS = 360;
export const RELAUNCH_STRESS = -30;
export const HAND_BACK_STRESS = -40;
export const MAX_REFIT_DAYS = 360;

// ── reputation feed into GameState ──
/** Star bump: footfall multiplier by stars (+25% for a first star). */
export const STAR_FOOTFALL: readonly [number, number, number, number] = [1, 1.25, 1.35, 1.45];
/** After losing a star the old bump fades over this many days ("it hurts less than you expect"). */
export const STAR_AFTERGLOW_DAYS = 180;
/** Prestige anchor the restaurant is pulled toward each day (by PRESTIGE_ANCHOR_PULL), from prestigeScore(). */
export const PRESTIGE_ANCHOR_PULL = 0.03;
export const PRESTIGE_STAR_GAIN = 10;
export const PRESTIGE_STAR_LOSS = -6;

// ── other prestige tracks ──
export const CRITIC_INTERVAL: [number, number] = [45, 120];
export const CRITIC_NAMES = ["The Evening Gazette", "The Courier's food desk", "Local Eats Weekly"];
/** Critic rating bands on the day's criteria mean (5 stars ≥ first …). */
export const CRITIC_BANDS: readonly [number, number, number, number] = [85, 75, 62, 50];
export const CRITIC_FOOTFALL: Record<number, { mult: number; days: number } | undefined> = {
  5: { mult: 1.6, days: 14 },
  4: { mult: 1.2, days: 10 },
  3: undefined,
  2: { mult: 0.85, days: 10 },
  1: { mult: 0.7, days: 14 },
};
export const CRITIC_PRESTIGE_PER_STAR = 3;
export const CRITIC_NOISE_SD = 3;
/** World's 50 Best: world score = EMA + stars × 4 + prestige × 0.15; rank = 1 + (TOP − score) × SLOPE, listed when ≤ 50. */
export const FIFTY_BEST_RANK_SLOPE = 6;
export const FIFTY_BEST_TOP = 110;
export const FIFTY_BEST_NOISE_SD = 2;
export const GAULT_MILLAU_MAX = 19.5;
export const GOOD_FOOD_MAX = 10;

/** Stars bring landlords offering sites: satellite fit-out is cheaper by this share per star. */
export const SATELLITE_STAR_DISCOUNT = 0.1;
/** Prestige target the game's prestige is pulled toward: base + per star + Gault&Millau + Good Food + 50 Best. */
export const PRESTIGE_TARGET = { base: 20, perStar: 15, perGmPoint: 1.2, perGoodFoodTier: 1, fiftyBestMax: 10 };

/** Named partner farms and foragers (supplier catalogue for SIGN_SOURCING). Ingredient ids missing from content are dropped. */
export const SUPPLIERS: readonly { id: string; name: string; ingredientIds: string[] }[] = [
  { id: "day_boats", name: "Brixham Day Boats", ingredientIds: ["cod", "scallops", "mussels", "prawns", "salmon"] },
  { id: "hollow_lane", name: "Hollow Lane Farm", ingredientIds: ["lamb", "beef_steak", "beef_mince", "pork_belly", "eggs"] },
  { id: "foragers", name: "The Forager's Basket", ingredientIds: ["mushrooms", "herbs", "salad_leaves", "asparagus"] },
  { id: "kitchen_garden", name: "Kitchen Garden Co-op", ingredientIds: ["tomatoes", "potatoes", "leeks", "root_veg", "peppers", "peas", "strawberries"] },
  { id: "marsh_duck", name: "Marsh End Ducks", ingredientIds: ["duck_breast", "chicken_breast"] },
  { id: "dairy", name: "Westcombe Dairy", ingredientIds: ["butter", "cream", "milk", "cheddar"] },
];
