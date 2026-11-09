/**
 * @full-plate/sim-stars — Path B ("The Stars") state, commands and events.
 *
 * Conventions (same as sim-core): money is integer pence, a day is the unit, everything is plain JSON,
 * all randomness comes from the seeded RNG stored in `StarsState.rngState`.
 *
 * HIDDEN vs PUBLIC. Several fields are the inspectors' secret and must never reach the player's screen
 * before guide day: `guides.michelin.scheduled`, unrevealed `inspectorVisits`, `assessment`, and anything
 * returned by `inspectorModel`. The UI reads `starsView()` instead, which strips them (see STARS-NOTES.md).
 */
import type { DishId, Pence, StaffId } from "@full-plate/sim-core";

export const STARS_VERSION = 1 as const;

export type StarCount = 0 | 1 | 2 | 3;

/** The five Michelin criteria, each 0-100. See proxies.ts for how each is derived from a day. */
export interface Criteria {
  /** Quality of the ingredients: seasonality + partner sourcing (+ prepaid-ticketing produce bonus). */
  ingredients: number;
  /** Harmony of flavours: plate quality, half plate-weighted, half a tasting across every food dish cooked. */
  harmony: number;
  /** Mastery of technique: ambition (skillRequired of food sold) blended with execution (quality). */
  technique: number;
  /** The chef's personality in the food: share of signature (test-kitchen) plates + head-chef reputation. */
  personality: number;
  /** Consistency: spread and off-nights over the rolling 60-day quality window, minus group/stress penalties. */
  consistency: number;
}

/** One anonymous inspector meal. Hidden until guide day (`revealed`). */
export interface InspectorVisit {
  day: number;
  inspector: string;          // a pseudonym ("Inspector M."), revealed with the visit
  scores: Criteria;
  total: number;              // mean of the five criteria
  revealed: boolean;
}

export interface Review {
  day: number;
  critic: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
}

export type SatelliteKind = "bar" | "bistro" | "ticketed" | "backed";

/** A satellite earns cash and keeps talent busy; it never earns stars. "backed" = a head chef you funded (Smyth arc). */
export interface Satellite {
  id: string;
  kind: SatelliteKind;
  name: string;
  openedDay: number;
  /** A trained head chef runs it: no consistency drag on the flagship. */
  headChefTrained: boolean;
  /** Days left on the head-chef training programme (absent when not training). */
  trainingDaysLeft?: number;
  /** Cooks/servers the satellite absorbs from the group's pool (for the UI and the game's hiring advice). */
  staffAbsorbed: number;
  /** Lifetime cash it has sent back to the group. */
  earned: Pence;
}

export interface SourcingRelationship {
  supplierId: string;
  name: string;
  ingredientIds: string[];
  /** 0-100; built slowly over years of open days, lost quickly when the restaurant is shut. */
  relationship: number;
  /** Extra ingredients-score per in-season plate from this partner (grows with relationship), 0-0.3. */
  seasonalBonus: number;
  signedDay: number;
}

export interface Rival {
  name: string;
  /** The former head chef's staff id (for the story text). */
  formerStaffId?: StaffId;
  openedDay: number;
  /** 0-100 strength; their stars follow from it on guide day. */
  strength: number;
  stars: StarCount;
}

/** Running accumulators for the current Michelin assessment year (reset on guide day). Hidden. */
export interface Assessment {
  windowStart: number;
  openDays: number;
  /** Sum of each day's criteria over open days (for debug and the yearly consistency). */
  criteriaSum: Criteria;
  /** Daily mean quality: count, Σ, Σ², and "off nights" below OFF_NIGHT_QUALITY. */
  qN: number;
  qSum: number;
  qSumSq: number;
  qOff: number;
}

export interface GuideResult {
  day: number;
  before: StarCount;
  after: StarCount;
  assessed: boolean;
  score?: number;
  visits: number;
  reason: string;
}

export type EndingKind = "dynasty" | "el_bulli" | "handed_back";

export interface Ending {
  kind: EndingKind;
  day: number;
  /** dynasty (3 stars held 5 consecutive guide days, solvent) and el_bulli (close at peak) are wins. */
  win: boolean;
  text: string;
}

export interface StarsLedger {
  /** Cash the game should add (negative = spend) at the next applyStarsEffects. */
  pendingCash: Pence;
  pendingPrestige: number;
  pendingPopularity: number;
  /** One-off footfall modifiers to push into GameState.footfallMods (critic reviews, scandals, burnout). */
  pendingFootfall: { mult: number; days: number }[];
  /** The persistent footfall multiplier (star bump × prepaid × signatures × rival) to keep in GameState.footfallMods. */
  persistentMult: number;
  /** The persistent multiplier applyStarsEffects last pushed (for the UI). */
  pushedMult?: number;
}

export interface StarsState {
  version: typeof STARS_VERSION;
  rngState: number[];
  /** Day the Stars path began, and the last day stepStarsDay processed. */
  startDay: number;
  lastDay: number;
  guides: {
    michelin: {
      stars: StarCount;
      /** Revealed visits from past years and HIDDEN visits from this year (revealed = false). */
      inspectorVisits: InspectorVisit[];
      /** HIDDEN: days inspectors will come this assessment year. */
      scheduled: number[];
      nextGuideDay: number;
      /** Consecutive guide days with three stars (win at WIN_YEARS). */
      threeStarStreak: number;
      history: GuideResult[];
      /** After HAND_BACK_STARS: the guide stops assessing until this day. */
      excludedUntil?: number;
    };
    fiftyBest: { rank?: number; hallOfFame: boolean; nextListDay: number; bestRank?: number };
    gaultMillau: { points: number; nextDay: number };
    /** Good Food Guide score 0 (not listed) … 10. */
    goodFood: { tier: number; nextDay: number };
    localCritic: { lastReview?: Review; nextVisit: number; reviews: Review[] };
  };
  headChef: {
    staffId?: StaffId;
    stress: number;            // 0-100
    reputation: number;        // 0-100
    tenureStart: number;
    wantsOwnPlace: boolean;
    /** Smyth arc: decide (BACK_HEAD_CHEF / LET_HEAD_CHEF_GO) before this day or they leave for a rival. */
    decisionDeadline?: number;
    /** Kitchen disrupted (burnout, or the head chef just left): consistency penalty until this day. */
    disruptedUntil?: number;
    burnouts: number;
    /** Head chefs who have left (the game may not have fired them yet); never re-picked as head chef. */
    former: StaffId[];
  };
  testKitchen: {
    unlocked: boolean;
    researched: DishId[];
    inProgress?: { dishId: DishId; daysLeft: number };
  };
  sourcing: SourcingRelationship[];
  satellites: Satellite[];
  ticketing: { unlocked: boolean; prepaid: boolean; dynamicPricing: boolean };
  /** `sinceDay`: when the current unpaid policy started (the scandal risk ages with it). */
  stagiaires: { paid: boolean; count: number; scandals: number; sinceDay: number };
  /** Last ≤ 60 open days' mean plate quality, oldest first. */
  consistencyWindow: number[];
  /** The sim day of each `consistencyWindow` entry (same length; older saves may lack it). */
  consistencyDays?: number[];
  /** HIDDEN: this assessment year's accumulators. */
  assessment: Assessment;
  /** Cosy "someone was taking notes" hints this assessment year. Unreliable by design (real visits AND decoys). */
  hints: { day: number; text: string }[];
  /** EMA of the daily total score (drives the non-Michelin tracks). */
  dailyScoreEma: number;
  /** Most recent day's criteria (HIDDEN: debug only). */
  lastCriteria?: Criteria;
  /** Restaurant shut for a refit/relaunch until this day (the game must not run service before it). */
  refitUntil?: number;
  /** Relaunch: personality boost until this day. */
  relaunchUntil?: number;
  /** Backed a former head chef: alumni personality bonus until this day. */
  loyaltyUntil?: number;
  rival?: Rival;
  /** Star bump afterglow: after losing a star the old footfall multiplier fades from `mult` over STAR_AFTERGLOW_DAYS. */
  afterglow?: { mult: number; day: number };
  /** Most stars ever held (CLOSE_AT_PEAK needs stars === peakStars ≥ 2). */
  peakStars: StarCount;
  ending?: Ending;
  ledger: StarsLedger;
  /** Id counter for satellites. */
  nextId: number;
}

// ───────────────────────── commands ─────────────────────────
export type StarsCommand =
  | { type: "UNLOCK_TEST_KITCHEN" }
  | { type: "RESEARCH_DISH"; dishId: DishId }
  | { type: "OPEN_SATELLITE"; kind: "bar" | "bistro" | "ticketed"; name?: string }
  | { type: "TRAIN_SATELLITE_CHEF"; satelliteId: string }
  | { type: "CLOSE_SATELLITE"; satelliteId: string }
  | { type: "UNLOCK_TICKETING" }
  | { type: "SET_TICKETING"; prepaid: boolean; dynamicPricing: boolean }
  | { type: "SET_STAGIAIRE_POLICY"; paid: boolean; count: number }
  | { type: "SIGN_SOURCING"; supplierId: string }
  | { type: "DROP_SOURCING"; supplierId: string }
  /** Smyth arc: fund the head chef's own place → a friendly "backed" satellite + loyalty bonus. */
  | { type: "BACK_HEAD_CHEF" }
  /** Smyth arc: let them go now (they open a rival). */
  | { type: "LET_HEAD_CHEF_GO" }
  | { type: "CLOSE_FOR_REFIT"; days: number }
  /** Give the stars back. `retire: true` ends the run (a valid, non-winning ending); otherwise cook on outside the guide. */
  | { type: "HAND_BACK_STARS"; retire?: boolean }
  | { type: "RELAUNCH_CONCEPT" }
  | { type: "CLOSE_AT_PEAK" };

// ───────────────────────── events ─────────────────────────
export type StarsEvent =
  | { type: "INSPECTOR_HINT"; day: number; text: string }
  | { type: "INSPECTION_SEASON"; day: number; daysToGuide: number }
  | { type: "GUIDE_DAY"; result: GuideResult; visits: InspectorVisit[] }
  | { type: "FIFTY_BEST"; day: number; rank?: number; before?: number; hallOfFame: boolean }
  | { type: "GAULT_MILLAU"; day: number; points: number; before: number }
  | { type: "GOOD_FOOD"; day: number; tier: number; before: number }
  | { type: "CRITIC_REVIEW"; review: Review }
  | { type: "STRESS_WARNING"; day: number; stress: number }
  | { type: "BURNOUT"; day: number; staffId?: StaffId }
  | { type: "STAGIAIRE_SCANDAL"; day: number }
  | { type: "RESEARCH_DONE"; day: number; dishId: DishId }
  | { type: "SMYTH_ARC_STARTED"; day: number; staffId?: StaffId; deadline: number }
  /** The game should FIRE `staffId` (they have left) and hire a replacement. */
  | { type: "HEAD_CHEF_LEFT"; day: number; staffId?: StaffId; backed: boolean; rival?: string }
  | { type: "HEAD_CHEF_CHANGED"; day: number; staffId?: StaffId }
  | { type: "SATELLITE_OPENED"; satellite: Satellite }
  | { type: "SATELLITE_CHEF_TRAINED"; satelliteId: string }
  | { type: "REFIT_STARTED"; day: number; until: number }
  | { type: "ENDING"; ending: Ending }
  | { type: "REJECTED"; reason: string }
  | { type: "LOG"; day: number; text: string; tone: "good" | "bad" | "info" | "money" };

export interface StarsStepResult {
  stars: StarsState;
  events: StarsEvent[];
}
