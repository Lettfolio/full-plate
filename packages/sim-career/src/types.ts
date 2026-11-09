/**
 * @full-plate/sim-career — the "start as an employee" contract.
 *
 * An AI owner runs an ordinary sim-core GameState; the player is one of its Staff (id PLAYER_ID) with a career
 * track and a rung. Everything here is plain serialisable data; money is integer pence (wages: pence per hour).
 */
import type { DayResult, Difficulty, DistrictId, GameState, Pence, Staff, StaffId, StaffRole } from "@full-plate/sim-core";

/** The four employee starts (the fifth start, "owner", is plain sim-core). */
export type CareerTrack = "chef" | "bar" | "waiter" | "manager";
export type OwnerStrategy = "balanced" | "cheap" | "premium";

/** Visible requirements to reach a rung. `stat` is the track stat (see trackStat). */
export interface PromotionCriteria {
  stat: number;
  /** Shifts worked since the last promotion (or since joining at this rung). */
  shiftsAtRung: number;
  /** Mean score of the last REVIEWS_FOR_AVG weekly reviews (1-5). */
  reviewAvg: number;
  /** Owner mood 0-100. */
  ownerMood: number;
  /** Industry reputation 0-100 (top rungs only). */
  reputation?: number;
}

export interface RungDef {
  id: string;
  title: string;
  /** The sim-core role the player plays at this rung (waiter → restaurant manager switches server → manager). */
  simRole: StaffRole;
  /** Pence per hour before the owner's wage multiplier; never below NLW. */
  wage: Pence;
  /** Tronc points (the written tips policy: seniority earns a bigger share; kitchen points are scaled down). */
  troncPoints: number;
  /** Share of the week's positive restaurant profit paid as a bonus (manager rungs). */
  bonusPct?: number;
  /** Equity share of the week's positive profit (the "offered equity" top manager rung). */
  equityPct?: number;
  criteria?: PromotionCriteria;
}

export interface PlayerStats {
  skill: number;
  speed: number;
  charm: number;
}

/** A co-worker, current or former. `snapshot` is their sim-core Staff record (kept so a former colleague can be hired later). */
export interface Relationship {
  staffId: StaffId;
  name: string;
  role: StaffRole;
  /** -100..100. */
  bond: number;
  tag?: "mentor" | "rival";
  /** Restaurant where you worked together. */
  employer: string;
  current: boolean;
  sharedShifts: number;
  snapshot: Staff;
  /** True for the colleague who was head chef when you worked there (the handover perk looks for them). */
  wasHeadChef?: boolean;
}

export interface ReviewBreakdown {
  rating: number;
  reliability: number;
  growth: number;
  /** Covers turned without walk-outs (staff) or the week's profit against target (manager rungs). */
  business: number;
  /** Additive adjustment from incidents handled/ignored on your shifts. */
  incidents: number;
}

export interface WeeklyReview {
  day: number;
  week: number;
  /** 1-5, one decimal. */
  score: number;
  reviewer: string;
  reviewerRole: "owner" | "mentor";
  notes: string[];
  breakdown: ReviewBreakdown;
  shifts: number;
  contractShifts: number;
  statGain: number;
  tips: Pence;
  mood: number;
  fatigue: number;
  incidentsHandled: number;
}

export interface Offer {
  id: string;
  restaurantName: string;
  ownerName: string;
  strategy: OwnerStrategy;
  districtId: DistrictId;
  track: CareerTrack;
  rung: number;
  /** Pence per hour. */
  wage: Pence;
  madeDay: number;
  expiresDay: number;
  seed: number;
  /** Why they want you (one line). */
  pitch: string;
}

export interface Payslip {
  day: number;
  wages: Pence;
  tips: Pence;
  bonus: Pence;
  tax: Pence;
  ni: Pence;
  living: Pence;
  /** wages + tips + bonus − tax − ni − living (may be negative). */
  saved: Pence;
}

/** Running tallies for the current review week (reset at each review). */
export interface WeekTally {
  startDay: number;
  statStart: number;
  /** Career days worked this week. */
  workedDays: number[];
  /** This week's DayResults (written reviews dropped to keep saves small). */
  results: DayResult[];
  /** Sim-core days (DayResult.day) the player was on the floor. */
  workedSimDays: number[];
  contractShifts: number;
  contractDeclined: number;
  excused: number;
  weekendShifts: number;
  wagesGross: Pence;
  tips: Pence;
  profit: Pence;
  incidentsHandled: number;
  incidentsIgnored: number;
  /** Shifts worked alongside the mentor. */
  mentorShifts: number;
  /** Highest stress this week. */
  peakStress: number;
}

export interface CareerLogEntry {
  day: number;
  text: string;
  kind: "info" | "good" | "bad" | "money";
}

export interface Job {
  restaurantName: string;
  ownerName: string;
  strategy: OwnerStrategy;
  districtId: DistrictId;
  fromDay: number;
  toDay?: number;
  fromRung: number;
  toRung?: number;
  leftBecause?: "offer" | "closed" | "fired" | "opened_own";
}

export interface CareerState {
  version: 1;
  seed: number;
  track: CareerTrack;
  /** Current sim-core role (LADDER[track][rung].simRole). */
  role: StaffRole;
  rung: number;
  playerStaffId: StaffId;
  playerName: string;
  /** Career day counter (0-based), independent of the employer GameState's day. */
  day: number;
  stats: PlayerStats;
  /** Job satisfaction 0-100 (the sim-core mood of the player's Staff record is this, floored). */
  mood: number;
  /** 0-100; rises with fatigue, busy shifts, a cheap or unhappy owner. */
  stress: number;
  /** Mirror of the player's sim-core fatigue after the last shift. */
  fatigue: number;
  savings: Pence;
  /** Pence per hour. */
  wage: Pence;
  /** Industry reputation 0-100 (offers, top-rung criteria, opening-day popularity). */
  reputation: number;
  relationships: Relationship[];
  mentor?: StaffId | "owner";
  rival?: StaffId;
  weeklyReview: WeeklyReview[];
  payslips: Payslip[];
  offers: Offer[];
  shiftsWorked: number;
  shiftsAtRung: number;
  promotionsEarned: number;
  promotionsLost: number;
  /** Shifts the player says yes to, indexed by sim weekday (0 = Monday). Mon-Thu are contract days; Fri-Sun optional. */
  shiftPlan: boolean[];
  /** Burnout: no shifts until this career day (exclusive). */
  burnoutUntil?: number;
  canOpenOwn: boolean;
  /** First career day canOpenOwn became true. */
  canOpenSinceDay?: number;
  owner: { name: string; strategy: OwnerStrategy; mood: number };
  employer: { restaurantName: string; districtId: DistrictId; seed: number; difficulty: Difficulty; status: "employed" | "closed" | "fired" | "left" };
  week: WeekTally;
  cooldowns: { promotionAsk?: number; raise?: number; mentorSession?: number; poach?: number };
  lastTrainedDay?: number;
  /** Set by beginCareerDay when the owner sent the player on a paid course today (sim day). */
  trainingSimDay?: number;
  jobs: Job[];
  lifetime: { wages: Pence; tips: Pence; bonus: Pence; tax: Pence; ni: Pence; living: Pence; incidentsHandled: number; weekendShifts: number; declinedShifts: number; trainingDays: number; mentorSessions: number };
  log: CareerLogEntry[];
  /** Set once OPEN_OWN_PLACE succeeds; the career is then over and CareerGame.state is the player's own restaurant. */
  handover?: HandoverSummary;
  /** Perk state for the new owner game (applyWithPerks). */
  ownerPerks?: OwnerPerks;
}

export type CareerCommand =
  | { type: "TAKE_SHIFT"; weekday: number; take: boolean }
  | { type: "REQUEST_PROMOTION" }
  | { type: "ACCEPT_OFFER"; offerId: string }
  | { type: "DECLINE_OFFER"; offerId: string }
  | { type: "ASK_FOR_RAISE" }
  | { type: "MENTOR_SESSION" }
  | { type: "OPEN_OWN_PLACE"; districtId?: DistrictId; restaurantName?: string; difficulty?: Difficulty };

export type CareerEvent =
  | { type: "LOG"; entry: CareerLogEntry }
  | { type: "REVIEW"; review: WeeklyReview }
  | { type: "PAYSLIP"; payslip: Payslip }
  | { type: "PROMOTED"; rung: number; title: string; wage: Pence }
  | { type: "PROMOTION_DENIED"; missing: string[] }
  | { type: "POACHED"; rivalId: StaffId; rivalName: string; title: string }
  | { type: "RAISE"; granted: boolean; wage: Pence }
  | { type: "OFFER_RECEIVED"; offer: Offer }
  | { type: "OFFER_EXPIRED"; offerId: string }
  | { type: "JOB_CHANGED"; restaurantName: string; strategy: OwnerStrategy; rung: number }
  | { type: "MENTOR_CHANGED"; mentor?: StaffId | "owner"; name?: string }
  | { type: "RIVAL_CHANGED"; rival?: StaffId; name?: string }
  | { type: "MENTOR_SESSION"; gain: number }
  | { type: "TRAINED"; gain: number }
  | { type: "BURNOUT"; untilDay: number }
  | { type: "CAN_OPEN_OWN" }
  | { type: "EMPLOYER_CLOSED"; reason: string }
  | { type: "FIRED" }
  | { type: "OPENED_OWN_PLACE"; summary: HandoverSummary };

/** One line on the promotion checklist. */
export interface ChecklistItem {
  key: keyof PromotionCriteria;
  label: string;
  current: number;
  target: number;
  met: boolean;
}

export interface PromotionChecklist {
  /** The rung being worked toward (undefined at the top of the ladder). */
  nextRung?: number;
  nextTitle?: string;
  items: ChecklistItem[];
  ready: boolean;
  /** Plain-English reason when there is no next rung or a cooldown is running. */
  note?: string;
}

/** What it costs to open your own place in a district, and whether savings cover it. */
export interface OpeningBudget {
  districtId: DistrictId;
  fitOut: Pence;
  deposit: Pence;
  /** Working capital the bank wants to see. */
  reserve: Pence;
  /** The bank's standard small-business loan (content.balance.loanPrincipal). */
  loan: Pence;
  /** fitOut + deposit + reserve − loan. */
  savingsNeeded: Pence;
  shortfall: Pence;
  rungOk: boolean;
  /** The rung title from which opening is allowed. */
  rungNeeded: string;
}

/**
 * A handover perk. `via` says how it reaches sim-core: "command" (public sim-core commands), "state" (a direct edit
 * of existing GameState fields), "wrapper" (applyWithPerks wraps applyCommand) or "needs_hook" (documented only).
 */
export interface HandoverPerk {
  id: "colleague" | "drinks_menu" | "hire_rebate" | "regulars" | "reputation" | "savings" | "owner_skills";
  label: string;
  detail: string;
  via: "command" | "state" | "wrapper" | "needs_hook";
}

export interface HandoverSummary {
  day: number;
  restaurantName: string;
  districtId: DistrictId;
  track: CareerTrack;
  rungTitle: string;
  savingsIn: Pence;
  loan: Pence;
  cashAtOpening: Pence;
  perks: HandoverPerk[];
  colleague?: { staffId: StaffId; name: string; role: StaffRole; wage: Pence; discountPct: number };
  /** Manager start: hires left that get part of the recruitment fee back (applyWithPerks). */
  hireRebates: number;
  hireRebateEach: Pence;
}

/** Perk state the game keeps beside the new owner GameState (only the hire rebate needs it). */
export interface OwnerPerks {
  hireRebatesLeft: number;
  hireRebateEach: Pence;
}

/** The employee game: the career plus the employer's restaurant. */
export interface CareerGame {
  career: CareerState;
  state: GameState;
}
