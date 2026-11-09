/**
 * Every tunable number in the career layer. Money is integer pence; wages are pence per hour.
 * UK anchors (2026/27): National Living Wage £12.71/h (21+, from April 2026); personal allowance £12,570;
 * basic-rate income tax 20% to £50,270, 40% above; employee Class 1 NI 8% between the primary threshold and the
 * upper earnings limit, 2% above. Tips: Employment (Allocation of Tips) Act 2023, in force 1 Oct 2024 — every
 * tip goes to workers, allocated fairly under a written policy. Tips paid through an independent tronc are taxed
 * through PAYE but carry no National Insurance.
 */
import type { CareerTrack, OwnerStrategy, RungDef } from "./types";

export const CAREER_SAVE_VERSION = 1 as const;

// ── wages ──
/** National Living Wage (21+) from April 2026, pence per hour. Every rung pays at least this. */
export const NLW = 1271;
/** A shift is the whole 12:00–22:00 service (matches sim-core SHIFT_HOURS). */
export const SHIFT_HOURS = 10;

// ── the ladder ──
/**
 * Rungs per track. `criteria` are the visible requirements to *reach* that rung (rung 0 has none).
 * `stat` is the track stat (see trackStat): chef = skill, waiter = charm, bar/manager = (skill + charm) / 2.
 * Wages are a realistic UK hourly figure for a 50-hour week (head chef ≈ £47k, GM ≈ £45k a year at 2,600 h).
 */
export const LADDER: Record<CareerTrack, readonly RungDef[]> = {
  chef: [
    { id: "commis", title: "Apprentice chef (commis)", simRole: "chef", wage: NLW, troncPoints: 0.8 },
    { id: "chef_de_partie", title: "Chef de partie", simRole: "chef", wage: 1360, troncPoints: 0.9, criteria: { stat: 30, shiftsAtRung: 10, reviewAvg: 3.2, ownerMood: 50 } },
    { id: "sous_chef", title: "Sous chef", simRole: "chef", wage: 1575, troncPoints: 1.1, criteria: { stat: 46, shiftsAtRung: 36, reviewAvg: 3.4, ownerMood: 55 } },
    { id: "head_chef", title: "Head chef", simRole: "chef", wage: 1825, troncPoints: 1.3, criteria: { stat: 62, shiftsAtRung: 70, reviewAvg: 3.7, ownerMood: 60, reputation: 40 } },
  ],
  bar: [
    { id: "bar_back", title: "Bar back", simRole: "bar", wage: NLW, troncPoints: 0.9 },
    { id: "bartender", title: "Bartender", simRole: "bar", wage: 1320, troncPoints: 1, criteria: { stat: 40, shiftsAtRung: 12, reviewAvg: 3.2, ownerMood: 50 } },
    { id: "bar_manager", title: "Bar manager", simRole: "bar", wage: 1490, troncPoints: 1.2, criteria: { stat: 52, shiftsAtRung: 40, reviewAvg: 3.4, ownerMood: 55 } },
    { id: "general_manager", title: "General manager", simRole: "manager", wage: 1750, troncPoints: 1.3, criteria: { stat: 64, shiftsAtRung: 70, reviewAvg: 3.7, ownerMood: 60, reputation: 40 } },
  ],
  waiter: [
    { id: "waiter", title: "Waiter", simRole: "server", wage: NLW, troncPoints: 1 },
    { id: "head_waiter", title: "Head waiter", simRole: "server", wage: 1375, troncPoints: 1.2, criteria: { stat: 60, shiftsAtRung: 12, reviewAvg: 3.3, ownerMood: 50 } },
    { id: "restaurant_manager", title: "Restaurant manager", simRole: "manager", wage: 1625, troncPoints: 1.3, criteria: { stat: 70, shiftsAtRung: 60, reviewAvg: 3.6, ownerMood: 58, reputation: 35 } },
  ],
  manager: [
    { id: "manager", title: "Restaurant manager", simRole: "manager", wage: 1550, troncPoints: 1.2, bonusPct: 0.03 },
    { id: "general_manager", title: "General manager", simRole: "manager", wage: 1850, troncPoints: 1.3, bonusPct: 0.05, criteria: { stat: 64, shiftsAtRung: 20, reviewAvg: 3.4, ownerMood: 55 } },
    { id: "partner", title: "Partner (equity)", simRole: "manager", wage: 1850, troncPoints: 1.3, equityPct: 0.1, criteria: { stat: 70, shiftsAtRung: 60, reviewAvg: 3.7, ownerMood: 65, reputation: 50 } },
  ],
};

/** The lowest rung from which the bank and the player's own nerve allow opening a place. */
export const OPEN_RUNG: Record<CareerTrack, number> = { chef: 2, bar: 2, waiter: 1, manager: 0 };

/** Starting stats per track (the player's sim-core Staff record is built from these). */
export const START_STATS: Record<CareerTrack, { skill: number; speed: number; charm: number; reputation: number }> = {
  chef: { skill: 22, speed: 45, charm: 40, reputation: 10 },
  bar: { skill: 28, speed: 50, charm: 48, reputation: 12 },
  waiter: { skill: 25, speed: 50, charm: 52, reputation: 12 },
  manager: { skill: 52, speed: 50, charm: 58, reputation: 30 },
};

// ── owners ──
export interface OwnerProfile {
  /** Menu price as a multiple of suggested price. */
  priceMult: number;
  menuSize: number;
  /** Favour high quality-ceiling dishes when building the menu (0 = pure appeal). */
  qualityBias: number;
  /** Highest dish skillRequired the owner puts on the menu (their kitchen must be able to cook it). */
  maxDishSkill: number;
  hireBy: "value" | "skill" | "wage";
  /** Headcount (excluding the player) the owner aims for; extra hands only once cash clears `extraCash`. */
  baseTeam: Partial<Record<"chef" | "server" | "bar" | "porter", number>>;
  extraTeam: Partial<Record<"chef" | "server" | "bar" | "porter", number>>;
  extraCash: number;
  tableCash: number;
  /** Multiplier on sim-core's suggestedOrder. */
  stockMult: number;
  /** Days between paid training courses for the player (0 = never). */
  trainEveryDays: number;
  /** The first co-worker of each role works this many days (6 = overworked team). */
  coreDays: 5 | 6;
  /** Raise: base chance and size. */
  raiseChance: number;
  raisePct: number;
  /** Rung wages × this (never below NLW). */
  wageMult: number;
  /** Skill growth × this (standards, better colleagues, harder dishes). */
  growthMult: number;
  /** Stress the player feels just from working here (0-100 points added to the stress model). */
  baseStress: number;
  /** Owner mood lost when the player declines a contract shift / gained per weekend pick-up. */
  declinePenalty: number;
  weekendBonus: number;
  /** Review weights: rating (food/service quality), reliability, growth, covers (throughput). */
  reviewWeights: { rating: number; reliability: number; growth: number; business: number };
  /** Incident preference per kind (first available option wins). */
  incidentPolicy: Record<string, readonly string[]>;
  /** Wage at which a paid incident option is too dear for this owner (pence). */
  maxIncidentSpend: number;
}

export const OWNERS: Record<OwnerStrategy, OwnerProfile> = {
  balanced: {
    priceMult: 1,
    menuSize: 6,
    qualityBias: 0.3,
    maxDishSkill: 45,
    hireBy: "value",
    baseTeam: { chef: 1, server: 1 },
    extraTeam: { chef: 1, server: 1 },
    extraCash: 600_000,
    tableCash: 2_000_000,
    stockMult: 1,
    trainEveryDays: 84,
    coreDays: 5,
    raiseChance: 0.5,
    raisePct: 0.05,
    wageMult: 1,
    growthMult: 1,
    baseStress: 10,
    declinePenalty: 2,
    weekendBonus: 0.8,
    reviewWeights: { rating: 0.35, reliability: 0.3, growth: 0.2, business: 0.15 },
    incidentPolicy: {
      sent_back: ["remake", "apologise"],
      spill: ["mop"],
      big_party: ["push", "decline"],
      rush: ["simplify", "ride"],
      supplier_short: ["shop", "pull"],
      equipment: ["fix"],
      vip: ["best"],
      staff_wobble: ["break"],
    },
    maxIncidentSpend: 5_000,
  },
  cheap: {
    priceMult: 0.92,
    menuSize: 5,
    qualityBias: 0,
    maxDishSkill: 35,
    hireBy: "wage",
    baseTeam: { chef: 1, server: 1 },
    extraTeam: {},
    extraCash: Infinity,
    tableCash: 2_500_000,
    stockMult: 0.95,
    trainEveryDays: 0,
    coreDays: 6,
    raiseChance: 0.25,
    raisePct: 0.03,
    wageMult: 1,
    growthMult: 0.85,
    baseStress: 25,
    declinePenalty: 4,
    weekendBonus: 1.2,
    reviewWeights: { rating: 0.2, reliability: 0.4, growth: 0.1, business: 0.3 },
    incidentPolicy: {
      sent_back: ["apologise", "remake"],
      spill: ["mop"],
      big_party: ["push", "decline"],
      rush: ["ride"],
      supplier_short: ["pull"],
      equipment: ["fix"],
      vip: ["normal", "best"],
      staff_wobble: ["push"],
    },
    maxIncidentSpend: 0,
  },
  premium: {
    priceMult: 1.2,
    menuSize: 7,
    qualityBias: 1,
    maxDishSkill: 55,
    hireBy: "skill",
    baseTeam: { chef: 1, server: 1 },
    extraTeam: { chef: 1, server: 1 },
    extraCash: 500_000,
    tableCash: 1_500_000,
    stockMult: 1.15,
    trainEveryDays: 49,
    coreDays: 5,
    raiseChance: 0.6,
    raisePct: 0.06,
    wageMult: 1.06,
    growthMult: 1.2,
    baseStress: 18,
    declinePenalty: 2.5,
    weekendBonus: 0.6,
    reviewWeights: { rating: 0.5, reliability: 0.2, growth: 0.25, business: 0.05 },
    incidentPolicy: {
      sent_back: ["remake", "comp"],
      spill: ["mop"],
      big_party: ["push", "decline"],
      rush: ["callin", "simplify"],
      supplier_short: ["shop", "pull"],
      equipment: ["engineer", "fix"],
      vip: ["best", "freebie"],
      staff_wobble: ["break"],
    },
    maxIncidentSpend: 20_000,
  },
};

/**
 * An employer is an established business: fit-out paid off (no loan) and this much cash in the bank at newGame.
 * (Applied through a derived ContentPack passed to sim-core newGame; every other balance value is unchanged.)
 */
export const ESTABLISHED_CASH = 1_500_000;
/** The employer's restaurant runs alone this many days before the player starts (an established place). */
export const WARMUP_DAYS = 14;
/** The owner's own cash floor for any spend the AI chooses (pence). */
export const OWNER_CASH_FLOOR = 200_000;

// ── shifts ──
/** Weekday indices (0 = Monday): Mon–Thu are contract shifts; Fri–Sun (sim-core WEEKEND_DAYS) are optional. */
export const CONTRACT_DAYS: readonly number[] = [0, 1, 2, 3];
export const WEEKEND_DAYS: readonly number[] = [4, 5, 6];
/** Default plan: the four contract days plus Saturday. */
export const DEFAULT_SHIFT_PLAN: readonly boolean[] = [true, true, true, true, false, true, false];
/** Working Time Regulations: 48 h/week average without an opt-out. Six 10-hour shifts needs the opt-out; seven is refused. */
export const MAX_SHIFTS_PER_WEEK = 6;
/** Mood the player loses per weekend shift worked (friends, family, football). */
export const WEEKEND_MOOD_COST = 1.2;

// ── growth ──
/** Track-stat points per shift at each rung before multipliers; diminishing as the stat approaches 100. */
export const GROWTH_PER_SHIFT: readonly number[] = [0.15, 0.12, 0.1, 0.08];
/**
 * Round 4: learning by doing. A shift played hands-on adds `perStar` × stars + `perPlate` × plates (up to `maxPlates`)
 * to the track stat, × the owner's growthMult × (1 − stat / GROWTH_SOFT_CAP). A ★★ shift of 10 plates at a balanced
 * owner is ≈ +0.8 cooking on top of the ≈ 0.12 a watched shift gives, so the first promotion (cooking 22 → 30, 10
 * shifts) takes ~8–12 good hands-on shifts (about an hour of play) and ~65 watched ones.
 */
export const HANDS_ON_GROWTH = { perStar: 0.3, perPlate: 0.04, maxPlates: 15 } as const;
/** Growth × (1 − stat / GROWTH_SOFT_CAP). */
export const GROWTH_SOFT_CAP = 115;
export const MENTOR_GROWTH_MULT = 1.5;
/** Growth × (1 − stress / STRESS_GROWTH_DIV). */
export const STRESS_GROWTH_DIV = 250;
/** Secondary stats grow at this share of the main one (speed always; skill or charm by track). */
export const SECONDARY_GROWTH_SHARE = 0.4;
export const MENTOR_SESSION_GAIN = 0.6;
export const MENTOR_SESSION_FATIGUE = 6;
export const MENTOR_SESSION_BOND = 4;
export const MENTOR_SESSION_COOLDOWN = 7;

// ── relationships ──
export const BOND_PER_SHARED_SHIFT = 0.35;
export const BOND_TRAIT: Record<string, number> = { team_player: 0.4, sunny: 0.25, chatterbox: 0.15, grumpy: -0.5, ambitious: -0.25, showstopper: -0.1, perfectionist: -0.1 };
/** Traits that make a co-worker compete for promotions. */
export const COMPETITIVE_TRAITS: readonly string[] = ["ambitious", "showstopper", "perfectionist", "grumpy"];
export const BOND_RATING_WEIGHT = 0.3;
export const BOND_RIVAL_DRIFT = -0.8;
export const BOND_NOISE = 0.8;
/** A co-worker becomes your mentor when at least this much better at your track and bond ≥ MENTOR_BOND. */
export const MENTOR_SKILL_GAP = 10;
export const MENTOR_BOND = 20;
/** Hysteresis: a mentor stays while bond ≥ MENTOR_BOND − this and they're still ahead by half the gap. */
export const MENTOR_KEEP_SLACK = 10;
export const OWNER_MENTOR_KEEP_MOOD = 55;
/** Owner as mentor (manager track, or nobody better in the building) above this owner mood. */
export const OWNER_MENTOR_MOOD = 65;
/** A rival: same department, within RIVAL_SKILL_BAND of you, ambitious or bond below RIVAL_BOND. */
export const RIVAL_SKILL_BAND = 15;
export const RIVAL_BOND = 0;
/** Chance a rival poaches a promotion = POACH_BASE × (their stat / yours), less your recent review edge. */
export const POACH_BASE = 0.45;
export const POACH_COOLDOWN_DAYS = 28;
/** Former colleagues' bonds fade toward 0 by this share per week. */
export const FORMER_BOND_DECAY = 0.02;

// ── owner mood ──
export const OWNER_MOOD_START = 60;
export const OWNER_MOOD_DRIFT = 0.04;
export const OWNER_MOOD_PROFIT_DAY = 0.25;
export const OWNER_MOOD_REVIEW_WEIGHT = 3;
export const OWNER_MOOD_RATING_WEIGHT = 0.6;
/** Fired when owner mood is below this at a review and the last two reviews averaged below FIRE_REVIEW. */
export const FIRE_OWNER_MOOD = 30;
export const FIRE_REVIEW = 2.5;

// ── promotion / raise ──
export const PROMOTION_ASK_COOLDOWN = 7;
export const PROMOTION_DENIED_MOOD = 2;
export const RAISE_COOLDOWN_DAYS = 28;
export const RAISE_REFUSED_MOOD = 4;
export const RAISE_GRANTED_MOOD = 5;
export const PROMOTED_MOOD = 10;
export const POACHED_MOOD = 8;
/** A raise may lift your wage to at most this × your rung's wage (the next rung is where the money is). */
export const RAISE_BAND_CAP = 1.1;
export const REVIEWS_FOR_AVG = 4;

// ── stress & mood ──
/** stress = base(owner) + FATIGUE_W × fatigue + BUSY_W × max(0, covers per head − BUSY_FREE) + OWNER_W × (60 − ownerMood)+ */
export const STRESS_FATIGUE_W = 0.5;
export const STRESS_BUSY_W = 1.2;
export const STRESS_BUSY_FREE = 15;
export const STRESS_OWNER_W = 0.4;
export const STRESS_MOOD_THRESHOLD = 60;
export const STRESS_MOOD_DIV = 20;
/** The player's sim-core mood is never written below this, so sim-core's quit roll (mood < 12) can't remove them. */
export const SIM_MOOD_FLOOR = 30;
/** Career mood at or below this ⇒ a burnout week: the next 3 shifts are taken off automatically. */
export const BURNOUT_MOOD = 15;
export const BURNOUT_DAYS = 3;

// ── tronc ──
/** Kitchen staff take this share of a front-of-house point in the tronc (a common UK split). */
export const KITCHEN_TRONC_SHARE = 0.7;
export const COWORKER_SENIORITY_POINTS = 0.004; // per skill point

// ── personal finance (weekly) ──
export const PERSONAL_ALLOWANCE_WEEK = Math.round(1_257_000 / 52);
export const BASIC_RATE_LIMIT_WEEK = Math.round(5_027_000 / 52);
export const BASIC_RATE = 0.2;
export const HIGHER_RATE = 0.4;
export const NI_PRIMARY_WEEK = Math.round(1_257_000 / 52);
export const NI_UPPER_WEEK = Math.round(5_027_000 / 52);
export const NI_MAIN = 0.08;
export const NI_UPPER = 0.02;
/** Rent share, bills, food and travel outside London (pence/week). */
export const LIVING_COSTS_WEEK = 30_000;

// ── reputation ──
export const REPUTATION_REVIEW_WEIGHT = 0.8;
export const REPUTATION_PROMOTION = 5;
export const REPUTATION_DECAY_TARGET = 20;
export const REPUTATION_DECAY = 0.03;

// ── offers ──
/** Daily chance of an offer = BASE + reputation / DIV (≈ 6–10 a year); out of work it is JOB_HUNT_CHANCE. */
export const OFFER_BASE_CHANCE = 0.004;
export const OFFER_REPUTATION_DIV = 5000;
export const JOB_HUNT_CHANCE = 0.3;
export const OFFER_TTL_DAYS = 7;
/** Auto-play stays at a job at least this long before moving at the same rung. */
export const MIN_TENURE_DAYS = 90;
export const MAX_OFFERS = 3;
/** An offer is a rung up when reputation is at least this and your stat is within OFFER_STEP_UP_SLACK of the criteria. */
export const OFFER_STEP_UP_REPUTATION = 35;
export const OFFER_STEP_UP_SLACK = 6;

// ── opening your own place ──
/** Working capital the bank wants to see on top of fit-out and deposit (≈ 3 months' rent). */
export const OPENING_RESERVE = 1_200_000;
/** The bank lends up to this × your savings, capped at the content's loanPrincipal. */
export const LOAN_TO_SAVINGS = 3;

// ── handover perks ──
export const COLLEAGUE_DISCOUNT_BASE = 0.05;
export const COLLEAGUE_DISCOUNT_PER_BOND = 0.001;
export const COLLEAGUE_DISCOUNT_MAX = 0.15;
export const COLLEAGUE_MIN_BOND = 10;
/** Manager start: this many hires get this share of sim-core's RECRUITMENT_FEE back. */
export const MANAGER_HIRE_REBATES = 3;
export const MANAGER_HIRE_REBATE_SHARE = 0.5;
/** Bar start: this many best-margin drinks go on the menu, priced up by this (bar knowledge sells them). */
export const BAR_DRINKS = 3;
export const BAR_DRINK_PRICE_MULT = 1.1;
/** Waiter start: regulars follow you (sim-core footfallMods). */
export const WAITER_REGULARS = { mult: 1.08, daysRemaining: 42 };
/** Popularity / prestige head start from your industry reputation (points per reputation point). */
export const REPUTATION_TO_POPULARITY = 0.1;
export const REPUTATION_TO_PRESTIGE = 0.06;

export const LOG_MAX = 120;

export const RESTAURANT_NAMES: readonly string[] = [
  "The Copper Pan", "Marlow's", "The Salt House", "Bramble & Rye", "The Little Larder", "Hollis Kitchen",
  "The Anchor Rooms", "Fern Street Dining", "The Gilded Spoon", "Pepper & Pine", "The Old Bakehouse", "Juniper",
  "The Lantern", "Wren's Table", "Saffron Yard", "The Kettle Club", "Oak & Ember", "The Sunday Room",
];
export const OWNER_NAMES: readonly string[] = [
  "Pat Morgan", "Ravi Mehta", "Siobhan Kerr", "Tony Bianchi", "Helen Ashworth", "Kwame Asante", "Mei Lin",
  "Gordon Pryce", "Fatima Rahman", "Owen Lloyd", "Rosa Delgado", "Bernie Walsh",
];
