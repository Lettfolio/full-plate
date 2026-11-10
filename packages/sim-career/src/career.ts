/**
 * The career loop. A day at work, in the order the game runs it:
 *
 *   beginCareerDay(content, game)        planning: sync the player's Staff record; the AI owner plans (menu, hiring,
 *                                         rota incl. the player's shifts, training, tables) — returns its commands
 *   …service…                            the game ticks sim-core as usual (the owner answers incidents via
 *                                         ownerIncidentResponses; the hands-on layer may later let the player act)
 *   stepCareerDay(content, career, state, result)
 *                                         evening: wages, tronc, growth, stress, bonds, owner mood, offers and (every
 *                                         7th day) the weekly review, payslip and promotion; returns the owner's
 *                                         evening commands (stock, then END_DAY or the event answer)
 *   finishCareerDay(content, game, …)    applies those commands → next morning's planning
 *
 * advanceCareerDay does all four (headless / fast-forward). Pure: no Math.random, no Date.
 */
import type { Command, ContentPack, DayResult, GameState, StaffRole } from "@full-plate/sim-core";
import { applyCommand, weekdayOf } from "@full-plate/sim-core";
import {
  BURNOUT_DAYS,
  BURNOUT_MOOD,
  CAREER_SAVE_VERSION,
  CONTRACT_DAYS,
  DEFAULT_SHIFT_PLAN,
  FIRE_OWNER_MOOD,
  FIRE_REVIEW,
  GROWTH_PER_SHIFT,
  GROWTH_SOFT_CAP,
  HANDS_ON_GROWTH,
  LIVING_COSTS_WEEK,
  LOG_MAX,
  MAX_SHIFTS_PER_WEEK,
  MIN_TENURE_DAYS,
  MENTOR_GROWTH_MULT,
  MENTOR_SESSION_BOND,
  MENTOR_SESSION_COOLDOWN,
  MENTOR_SESSION_FATIGUE,
  MENTOR_SESSION_GAIN,
  OWNER_MOOD_DRIFT,
  OWNER_MOOD_PROFIT_DAY,
  OWNER_MOOD_RATING_WEIGHT,
  OWNER_MOOD_REVIEW_WEIGHT,
  OWNER_MOOD_START,
  OWNER_NAMES,
  OWNERS,
  POACH_BASE,
  POACH_COOLDOWN_DAYS,
  POACHED_MOOD,
  PROMOTED_MOOD,
  PROMOTION_DENIED_MOOD,
  RAISE_BAND_CAP,
  RAISE_COOLDOWN_DAYS,
  RAISE_GRANTED_MOOD,
  RAISE_REFUSED_MOOD,
  REPUTATION_DECAY,
  REPUTATION_DECAY_TARGET,
  REPUTATION_PROMOTION,
  REPUTATION_REVIEW_WEIGHT,
  RESTAURANT_NAMES,
  SECONDARY_GROWTH_SHARE,
  SHIFT_HOURS,
  START_STATS,
  STRESS_BUSY_FREE,
  STRESS_BUSY_W,
  STRESS_FATIGUE_W,
  STRESS_GROWTH_DIV,
  STRESS_MOOD_DIV,
  STRESS_MOOD_THRESHOLD,
  STRESS_OWNER_W,
  WEEKEND_MOOD_COST,
} from "./constants";
import { canOpenOwn, handoverToOwner, openingBudget } from "./handover";
import { canAskPromotion, clamp, coworkerStat, perHour, pounds, promotionChecklist, reviewAverage, round2, rungDef, rungWage, trackStat } from "./ladder";
import { payslip, PLAYER_ID, troncShare, workedOn } from "./money";
import { offerIsBetter, rollOffers, TRACK_SALT } from "./offers";
import { closingCommand, newEmployer, ownerEveningCommands, ownerPlanning, runService, syncPlayer } from "./owner";
import { findMentor, findRival, headChefOf, relationshipName, syncRelationships, tagRelationships, updateBonds } from "./relationships";
import { generateReview } from "./review";
import { hashSeed, Rng } from "./rng";
import type {
  CareerCommand,
  CareerEvent,
  CareerGame,
  CareerLogEntry,
  CareerState,
  CareerTrack,
  HandsOnShiftScore,
  Offer,
  OwnerStrategy,
  PlayerStats,
  WeekTally,
} from "./types";

const NAME_SALT = 0x4a3e;
const RAISE_SALT = 0x2a15e;
const POACH_SALT = 0x90ac;

// ── helpers ──
function log(career: CareerState, text: string, kind: CareerLogEntry["kind"], events: CareerEvent[]): CareerState {
  const entry = { day: career.day, text, kind };
  events.push({ type: "LOG", entry });
  const l = [...career.log, entry];
  return { ...career, log: l.length > LOG_MAX ? l.slice(-LOG_MAX) : l };
}

export function emptyWeek(day: number, statStart: number): WeekTally {
  return {
    startDay: day,
    statStart: round2(statStart),
    workedDays: [],
    results: [],
    workedSimDays: [],
    contractShifts: 0,
    contractDeclined: 0,
    excused: 0,
    weekendShifts: 0,
    wagesGross: 0,
    tips: 0,
    profit: 0,
    incidentsHandled: 0,
    incidentsIgnored: 0,
    mentorShifts: 0,
    peakStress: 0,
  };
}

/** Adds `gain` to the track stat (chef: skill, waiter: charm, bar/manager: both) and a share to speed. */
export function applyGain(track: CareerTrack, s: PlayerStats, gain: number): PlayerStats {
  const cap = (x: number) => round2(clamp(x, 0, 100));
  const side = gain * SECONDARY_GROWTH_SHARE;
  if (track === "chef") return { skill: cap(s.skill + gain), charm: cap(s.charm + side * 0.5), speed: cap(s.speed + side) };
  if (track === "waiter") return { charm: cap(s.charm + gain), skill: cap(s.skill + side * 0.5), speed: cap(s.speed + side) };
  return { skill: cap(s.skill + gain), charm: cap(s.charm + gain), speed: cap(s.speed + side) };
}

/** Growth from one shift (before rounding), with the mentor / stress / owner multipliers. */
export function shiftGrowth(career: CareerState, mentorOnShift: boolean): number {
  const stat = trackStat(career.track, career.stats);
  const base = GROWTH_PER_SHIFT[career.rung] ?? GROWTH_PER_SHIFT.at(-1)!;
  const owner = OWNERS[career.owner.strategy].growthMult;
  const mentor = mentorOnShift ? MENTOR_GROWTH_MULT : 1;
  const stress = 1 - career.stress / STRESS_GROWTH_DIV;
  return Math.max(0, base * owner * mentor * stress * (1 - stat / GROWTH_SOFT_CAP));
}

/** Round 4: extra growth from a shift played hands-on (HANDS_ON_GROWTH). */
export function handsOnGrowth(career: CareerState, h: HandsOnShiftScore): number {
  const stat = trackStat(career.track, career.stats);
  const raw = HANDS_ON_GROWTH.perStar * clamp(h.stars, 0, 3) + HANDS_ON_GROWTH.perPlate * clamp(h.plates ?? 0, 0, HANDS_ON_GROWTH.maxPlates);
  return Math.max(0, raw * OWNERS[career.owner.strategy].growthMult * (1 - stat / GROWTH_SOFT_CAP));
}

/** Stress after a shift (or a rest day: fatigue-only). */
export function stressAfter(career: CareerState, fatigue: number, coversPerHead: number, worked: boolean): number {
  const p = OWNERS[career.owner.strategy];
  const raw = worked
    ? p.baseStress + STRESS_FATIGUE_W * fatigue + STRESS_BUSY_W * Math.max(0, coversPerHead - STRESS_BUSY_FREE) + STRESS_OWNER_W * Math.max(0, 60 - career.owner.mood)
    : STRESS_FATIGUE_W * fatigue;
  // Stress moves halfway toward today's level (it lingers).
  return round2(clamp(career.stress + (raw - career.stress) * 0.5, 0, 100));
}

const isManagement = (career: CareerState) => career.role === "manager";

// ── creation ──
export interface NewCareerOptions {
  seed: number;
  track: CareerTrack;
  playerName?: string;
  /** The first employer's owner personality (default: balanced). */
  strategy?: OwnerStrategy;
  districtId?: string;
  difficulty?: GameState["difficulty"];
  restaurantName?: string;
  ownerName?: string;
  /** [round 10] The player's portrait: one of sim-core PLAYER_LOOKS (0-5). Omitted = no look stored (shown as look 0). */
  look?: number;
}

/** A fresh career at rung 0 in an established AI-run restaurant. */
export function newCareer(content: ContentPack, opts: NewCareerOptions): CareerGame {
  const seed = opts.seed >>> 0;
  const rng = Rng.fromSeed(hashSeed(seed, NAME_SALT, TRACK_SALT[opts.track]));
  const strategy = opts.strategy ?? "balanced";
  const districtId = opts.districtId ?? rng.pick(content.districts).id;
  const restaurantName = opts.restaurantName ?? rng.pick(RESTAURANT_NAMES);
  const ownerName = opts.ownerName ?? rng.pick(OWNER_NAMES);
  const difficulty = opts.difficulty ?? "normal";
  const employerSeed = hashSeed(seed, 1, TRACK_SALT[opts.track]);
  const state = newEmployer(content, { seed: employerSeed, districtId, strategy, restaurantName, difficulty, track: opts.track, rung: 0 });
  const st = START_STATS[opts.track];
  const role: StaffRole = rungDef(opts.track, 0).simRole;
  const stats = { skill: st.skill, speed: st.speed, charm: st.charm };
  let career: CareerState = {
    version: CAREER_SAVE_VERSION,
    seed,
    track: opts.track,
    role,
    rung: 0,
    playerStaffId: PLAYER_ID,
    playerName: opts.playerName?.trim() || "You",
    ...(Number.isInteger(opts.look) && opts.look! >= 0 && opts.look! < 6 ? { look: opts.look } : {}),
    day: 0,
    stats,
    mood: 70,
    stress: 0,
    fatigue: 0,
    savings: 0,
    wage: rungWage(opts.track, 0, strategy),
    reputation: st.reputation,
    relationships: [],
    weeklyReview: [],
    payslips: [],
    offers: [],
    shiftsWorked: 0,
    shiftsAtRung: 0,
    promotionsEarned: 0,
    promotionsLost: 0,
    shiftPlan: DEFAULT_SHIFT_PLAN.slice(),
    canOpenOwn: false,
    owner: { name: ownerName, strategy, mood: OWNER_MOOD_START },
    employer: { restaurantName: state.restaurantName, districtId: state.districtId, seed: employerSeed, difficulty, status: "employed" },
    week: emptyWeek(0, trackStat(opts.track, stats)),
    cooldowns: {},
    jobs: [{ restaurantName: state.restaurantName, ownerName, strategy, districtId: state.districtId, fromDay: 0, fromRung: 0 }],
    lifetime: { wages: 0, tips: 0, bonus: 0, tax: 0, ni: 0, living: 0, incidentsHandled: 0, weekendShifts: 0, declinedShifts: 0, trainingDays: 0, mentorSessions: 0 },
    log: [],
  };
  const events: CareerEvent[] = [];
  career = log(career, `First day at ${state.restaurantName} as ${rungDef(opts.track, 0).title.toLowerCase()} on ${perHour(career.wage)}.`, "good", events);
  const synced = syncPlayer(career, state);
  career = refreshTeam(career, synced);
  return { career, state: synced };
}

/** Relationship sync + head-chef flag + mentor/rival tags. */
function refreshTeam(career: CareerState, state: GameState, events?: CareerEvent[]): CareerState {
  let rels = syncRelationships(career, state);
  const head = headChefOf(state);
  if (head) rels = rels.map((r) => (r.current && r.staffId === head.id && !r.wasHeadChef ? { ...r, wasHeadChef: true } : r));
  let c: CareerState = { ...career, relationships: rels };
  const mentor = findMentor(c);
  const rival = findRival({ ...c, ...(mentor ? { mentor } : {}) });
  if (events && mentor !== career.mentor) {
    events.push({ type: "MENTOR_CHANGED", ...(mentor ? { mentor, name: relationshipName(c, mentor)! } : {}) });
    if (mentor) c = log(c, `${relationshipName(c, mentor)} has taken you under their wing. You'll learn faster on shifts together.`, "good", events);
  }
  if (events && rival !== career.rival) {
    events.push({ type: "RIVAL_CHANGED", ...(rival ? { rival, name: relationshipName(c, rival)! } : {}) });
    if (rival) c = log(c, `${relationshipName(c, rival)} is after the same promotion as you.`, "bad", events);
  }
  const { mentor: _m, rival: _r, ...rest } = c;
  return { ...rest, ...(mentor ? { mentor } : {}), ...(rival ? { rival } : {}), relationships: tagRelationships(c.relationships, mentor, rival) };
}

// ── the day ──
export interface BeginDayResult {
  game: CareerGame;
  /** The owner's planning commands that took effect. */
  ownerCommands: Command[];
  /** Is the player rostered today (and not on a course)? */
  playerWorks: boolean;
  trained: boolean;
}

/** Planning phase: sync the player's record and let the owner plan. No-op unless employed and in planning. */
export function beginCareerDay(content: ContentPack, game: CareerGame): BeginDayResult {
  const { career, state } = game;
  if (career.employer.status !== "employed" || career.handover || state.phase !== "planning") {
    return { game, ownerCommands: [], playerWorks: false, trained: false };
  }
  const synced = syncPlayer(career, state);
  const r = ownerPlanning(content, career.owner.strategy, synced, career);
  const me = r.state.staff.find((s) => s.id === PLAYER_ID);
  const playerWorks = !!me && me.rota[weekdayOf(r.state.day)] === true && !r.trained;
  const { trainingSimDay: _t, ...rest } = career;
  const next: CareerState = r.trained ? { ...rest, trainingSimDay: r.state.day, lastTrainedDay: career.day } : rest;
  return { game: { career: next, state: r.state }, ownerCommands: r.commands, playerWorks, trained: r.trained };
}

export interface StepCareerResult {
  career: CareerState;
  events: CareerEvent[];
  /** The owner's evening commands to apply to `state`: stock orders, then END_DAY or the event answer. */
  nextOwnerCommands: Command[];
}

/** The employer went bust (sim-core gameover). */
function employerClosed(career: CareerState, state: GameState, events: CareerEvent[]): CareerState {
  const reason = state.gameOverReason ?? "The restaurant has closed.";
  events.push({ type: "EMPLOYER_CLOSED", reason });
  let c = endJob(career, "closed");
  c = { ...c, employer: { ...c.employer, status: "closed" } };
  return log(c, `${career.employer.restaurantName} has closed for good. Time to find a new job.`, "bad", events);
}

function endJob(career: CareerState, why: NonNullable<CareerState["jobs"][number]["leftBecause"]>): CareerState {
  const jobs = career.jobs.map((j, i) => (i === career.jobs.length - 1 && j.toDay === undefined ? { ...j, toDay: career.day, toRung: career.rung, leftBecause: why } : j));
  const relationships = career.relationships.map((r) => (r.current ? (({ tag: _t, ...x }) => ({ ...x, current: false }))(r) : r));
  const { mentor: _m, rival: _r, ...rest } = career;
  return { ...rest, jobs, relationships };
}

/**
 * Evening: the career consequences of today's service. `result` is today's DayResult (state.history's last entry,
 * or the SERVICE_ENDED event's result). Does not modify `state`; returns the owner's evening commands for it.
 */
/**
 * The evening step. `handsOn` (optional) is the score of a shift the player played hands-on today: it is tallied into
 * the week, and the weekly review gives up to ±0.3 and a note for it (CAREER-NOTES "your plates averaged 82").
 */
export function stepCareerDay(content: ContentPack, career0: CareerState, state: GameState, result: DayResult, handsOn?: HandsOnShiftScore): StepCareerResult {
  const events: CareerEvent[] = [];
  if (career0.handover) return { career: career0, events, nextOwnerCommands: [] };
  if (career0.employer.status !== "employed") return idleDay(content, career0, events);
  let c = career0;
  const p = OWNERS[c.owner.strategy];
  const wd = weekdayOf(result.day);
  const me = state.staff.find((s) => s.id === PLAYER_ID);
  const rostered = !!me && me.rota[wd] === true;
  const training = c.trainingSimDay === result.day;
  const worked = rostered && !training;
  const contractDay = CONTRACT_DAYS.includes(wd);
  const burnout = c.burnoutUntil !== undefined && c.day < c.burnoutUntil;
  const week = { ...c.week, results: [...c.week.results, { ...result, reviews: [] }], profit: c.week.profit + result.profit };

  // Shifts and pay
  let moodExtra = 0;
  let ownerMood = c.owner.mood + (OWNER_MOOD_START - c.owner.mood) * OWNER_MOOD_DRIFT + Math.sign(result.profit) * OWNER_MOOD_PROFIT_DAY;
  if (rostered) {
    week.wagesGross += c.wage * SHIFT_HOURS;
    if (contractDay) week.contractShifts += 1;
  } else if (contractDay) {
    if (burnout) week.excused += 1;
    else {
      week.contractDeclined += 1;
      ownerMood -= p.declinePenalty;
      c = { ...c, lifetime: { ...c.lifetime, declinedShifts: c.lifetime.declinedShifts + 1 } };
    }
  }
  if (worked) {
    week.workedDays = [...week.workedDays, c.day];
    week.workedSimDays = [...week.workedSimDays, result.day];
    if (!contractDay) {
      week.weekendShifts += 1;
      moodExtra -= WEEKEND_MOOD_COST;
      ownerMood += p.weekendBonus;
    }
    if (result.covers > 0) ownerMood += (result.averageRating - 3.5) * OWNER_MOOD_RATING_WEIGHT;
    const tips = troncShare(c, state, result);
    week.tips += tips;
    const handled = (state.incidents ?? []).filter((i) => i.resolution && i.resolution !== "ignored").length;
    const ignored = (state.incidents ?? []).filter((i) => i.resolution === "ignored").length;
    week.incidentsHandled += handled;
    if (handsOn) {
      const h = week.handsOn ?? { shifts: 0, stars: 0, quality: 0 };
      week.handsOn = { shifts: h.shifts + 1, stars: h.stars + clamp(handsOn.stars, 0, 3), quality: round2(h.quality + clamp(handsOn.meanQuality, 0, 100)) };
    }
    week.incidentsIgnored += ignored;
    c = { ...c, lifetime: { ...c.lifetime, incidentsHandled: c.lifetime.incidentsHandled + handled, weekendShifts: c.lifetime.weekendShifts + (contractDay ? 0 : 1) } };
  }

  // Growth (from the start-of-day stats)
  const mentorOnShift =
    worked && (c.mentor === "owner" || (!!c.mentor && workedOn(state, result.day).some((s) => s.id === c.mentor)));
  if (mentorOnShift) week.mentorShifts += 1;
  let stats = c.stats;
  if (worked) {
    const play = handsOn ? handsOnGrowth(c, handsOn) : 0;
    const gain = shiftGrowth(c, mentorOnShift) + play;
    stats = applyGain(c.track, stats, gain);
    events.push({ type: "GREW", gain: round2(gain), handsOn: round2(play), stat: round2(trackStat(c.track, stats)) });
  }
  if (training && me) {
    const gain = Math.max(0, me.skill - c.stats.skill);
    stats = applyGain(c.track, stats, gain);
    events.push({ type: "TRAINED", gain: round2(gain) });
    c = { ...c, lifetime: { ...c.lifetime, trainingDays: c.lifetime.trainingDays + 1 } };
    c = log(c, `${c.owner.name} paid for a training day: +${gain.toFixed(1)}.`, "good", events);
  }

  // Fatigue, stress, mood (sim-core computed fatigue and its own mood change for the player's record)
  const fatigue = me ? me.fatigue : c.fatigue;
  const headcount = Math.max(1, workedOn(state, result.day).length);
  const stress = stressAfter(c, fatigue, result.covers / headcount, worked);
  week.peakStress = Math.max(week.peakStress, stress);
  const simMood = me ? result.staffMoodDelta[PLAYER_ID] ?? 0 : 0;
  if (stress > STRESS_MOOD_THRESHOLD) moodExtra -= (stress - STRESS_MOOD_THRESHOLD) / STRESS_MOOD_DIV;
  const mood = round2(clamp(c.mood + simMood + moodExtra, 0, 100));

  c = {
    ...c,
    stats,
    fatigue: round2(fatigue),
    stress,
    mood,
    week,
    owner: { ...c.owner, mood: round2(clamp(ownerMood, 0, 100)) },
    shiftsWorked: c.shiftsWorked + (worked ? 1 : 0),
    shiftsAtRung: c.shiftsAtRung + (worked ? 1 : 0),
  };
  if (c.trainingSimDay !== undefined) {
    const { trainingSimDay: _t, ...rest } = c;
    c = rest;
  }

  // Burnout
  if (c.mood <= BURNOUT_MOOD && !burnout) {
    c = { ...c, burnoutUntil: c.day + 1 + BURNOUT_DAYS };
    events.push({ type: "BURNOUT", untilDay: c.burnoutUntil! });
    c = log(c, `You're burnt out. You'll be off for the next ${BURNOUT_DAYS} days.`, "bad", events);
  }

  // Co-workers
  const reviewDay = c.day % 7 === 6;
  c = { ...c, relationships: updateBonds({ ...c, relationships: syncRelationships(c, state) }, state, result, worked, reviewDay) };
  c = refreshTeam(c, state, events);

  // Employer closed?
  if (state.phase === "gameover") {
    c = employerClosed(c, state, events);
    if (reviewDay) c = weeklyReview(content, c, events, state);
    return finishDay(content, c, events, state, []);
  }

  if (reviewDay) c = weeklyReview(content, c, events, state);
  const nextOwnerCommands = c.employer.status === "employed" ? [...ownerEveningCommands(content, c.owner.strategy, state), ...closingFor(content, state)] : [];
  return finishDay(content, c, events, state, nextOwnerCommands);
}

function closingFor(content: ContentPack, state: GameState): Command[] {
  const cmd = closingCommand(content, state);
  return cmd ? [cmd] : [];
}

/** Offers, canOpenOwn, and the day counter (shared by worked and idle days). */
function finishDay(content: ContentPack, career: CareerState, events: CareerEvent[], _state: GameState | undefined, cmds: Command[]): StepCareerResult {
  let c = career;
  const lastJob = c.jobs.at(-1);
  const idle = c.employer.status === "employed" ? 0 : c.day - (lastJob?.toDay ?? c.day);
  const r = rollOffers(content, c, idle);
  c = { ...c, offers: r.offers };
  for (const o of r.expired) events.push({ type: "OFFER_EXPIRED", offerId: o.id });
  if (r.made) {
    events.push({ type: "OFFER_RECEIVED", offer: r.made });
    c = log(c, `${r.made.ownerName} at ${r.made.restaurantName} offers you ${rungDef(c.track, r.made.rung).title.toLowerCase()} on ${perHour(r.made.wage)}.`, "info", events);
  }
  const can = canOpenOwn(content, c);
  if (can && !c.canOpenOwn) {
    events.push({ type: "CAN_OPEN_OWN" });
    c = log(c, "You could open your own place now: savings plus a bank loan cover the fit-out.", "good", events);
  }
  c = { ...c, canOpenOwn: can, ...(can && c.canOpenSinceDay === undefined ? { canOpenSinceDay: c.day } : {}), day: c.day + 1 };
  return { career: c, events, nextOwnerCommands: cmds };
}

/** A day out of work: living costs still land on the weekly payslip; offers come thick and fast. */
function idleDay(content: ContentPack, career: CareerState, events: CareerEvent[]): StepCareerResult {
  let c: CareerState = { ...career, fatigue: round2(Math.max(0, career.fatigue - 30)), stress: round2(career.stress * 0.7), mood: round2(clamp(career.mood + 0.5, 0, 100)) };
  if (c.day % 7 === 6) c = payWeek(c, events, 0);
  return finishDay(content, c, events, undefined, []);
}

/** Payslip for the week: wages + tronc + bonus − PAYE − NI − living costs → savings. Resets the week tally. */
function payWeek(career: CareerState, events: CareerEvent[], bonus: number): CareerState {
  const w = career.week;
  const slip = payslip(career.day, w.wagesGross, w.tips, bonus, LIVING_COSTS_WEEK);
  events.push({ type: "PAYSLIP", payslip: slip });
  const lt = career.lifetime;
  return {
    ...career,
    savings: career.savings + slip.saved,
    payslips: [...career.payslips, slip].slice(-60),
    lifetime: { ...lt, wages: lt.wages + slip.wages, tips: lt.tips + slip.tips, bonus: lt.bonus + slip.bonus, tax: lt.tax + slip.tax, ni: lt.ni + slip.ni, living: lt.living + slip.living },
    week: emptyWeek(career.day + 1, trackStat(career.track, career.stats)),
  };
}

/** Day 7 of each week: review, pay, reputation, firing, and the owner's promotion decision. */
function weeklyReview(content: ContentPack, career: CareerState, events: CareerEvent[], state: GameState): CareerState {
  let c = career;
  const employed = c.employer.status === "employed" || c.week.workedDays.length > 0;
  if (employed) {
    const mentorName = c.mentor && c.mentor !== "owner" ? relationshipName(c, c.mentor) : undefined;
    const review = generateReview(c, c.week, {
      reviewer: mentorName ?? c.owner.name,
      reviewerRole: mentorName ? "mentor" : "owner",
      statNow: trackStat(c.track, c.stats),
      management: isManagement(c),
    });
    events.push({ type: "REVIEW", review });
    const ownerMood = round2(clamp(c.owner.mood + (review.score - 3) * OWNER_MOOD_REVIEW_WEIGHT, 0, 100));
    const reputation = round2(clamp(c.reputation + (review.score - 3) * REPUTATION_REVIEW_WEIGHT + (REPUTATION_DECAY_TARGET - c.reputation) * REPUTATION_DECAY, 0, 100));
    c = { ...c, weeklyReview: [...c.weeklyReview, review].slice(-104), owner: { ...c.owner, mood: ownerMood }, reputation };
  }
  const def = rungDef(c.track, c.rung);
  const profit = Math.max(0, c.week.profit);
  const bonus = c.employer.status === "employed" ? Math.round(profit * ((def.bonusPct ?? 0) + (def.equityPct ?? 0))) : 0;
  c = payWeek(c, events, bonus);
  if (c.employer.status !== "employed") return c;

  // Fired?
  const last2 = c.weeklyReview.slice(-2);
  if (c.owner.mood < FIRE_OWNER_MOOD && last2.length === 2 && last2.every((r) => r.score < FIRE_REVIEW)) {
    events.push({ type: "FIRED" });
    c = endJob(c, "fired");
    c = { ...c, employer: { ...c.employer, status: "fired" } };
    return log(c, `${c.owner.name} has let you go. Find somewhere that suits you better.`, "bad", events);
  }
  // The owner promotes at the review when you meet every criterion (or a rival gets it).
  if (promotionChecklist(c).ready) c = decidePromotion(c, events, state);
  void content;
  return c;
}

/** Chance a rival takes your promotion: their standing against yours, less your review record. */
export function poachChance(theirs: number, mine: number, reviewAvg: number): number {
  return clamp(POACH_BASE * (theirs / Math.max(1, mine)) - (reviewAvg - 4) * 0.15, 0.05, 0.6);
}

/** Promotes the player, unless a rival poaches it. Assumes the checklist is ready. */
function decidePromotion(career: CareerState, events: CareerEvent[], state: GameState): CareerState {
  let c = career;
  const rival = c.relationships.find((r) => r.current && r.staffId === c.rival);
  if (rival) {
    const live = state.staff.find((s) => s.id === rival.staffId) ?? rival.snapshot;
    const theirs = coworkerStat(c.track, live);
    const mine = Math.max(1, trackStat(c.track, c.stats));
    const chance = poachChance(theirs, mine, reviewAverage(c));
    const rng = Rng.fromSeed(hashSeed(c.seed, c.day, POACH_SALT));
    if (rng.chance(chance)) {
      const title = rungDef(c.track, c.rung + 1).title;
      events.push({ type: "POACHED", rivalId: rival.staffId, rivalName: rival.name, title });
      c = {
        ...c,
        promotionsLost: c.promotionsLost + 1,
        mood: round2(clamp(c.mood - POACHED_MOOD, 0, 100)),
        cooldowns: { ...c.cooldowns, poach: c.day + POACH_COOLDOWN_DAYS },
        relationships: c.relationships.map((r) => (r.staffId === rival.staffId && r.current ? { ...r, bond: round2(clamp(r.bond - 10, -100, 100)) } : r)),
      };
      return log(c, `${rival.name} got the ${title.toLowerCase()} job you were up for. The owner will look again in four weeks.`, "bad", events);
    }
  }
  return promote(c, events);
}

function promote(career: CareerState, events: CareerEvent[]): CareerState {
  const rung = career.rung + 1;
  const def = rungDef(career.track, rung);
  const wage = Math.max(career.wage, rungWage(career.track, rung, career.owner.strategy));
  events.push({ type: "PROMOTED", rung, title: def.title, wage });
  const { poach: _p, ...cooldowns } = career.cooldowns;
  const c: CareerState = {
    ...career,
    rung,
    role: def.simRole,
    wage,
    shiftsAtRung: 0,
    promotionsEarned: career.promotionsEarned + 1,
    reputation: round2(clamp(career.reputation + REPUTATION_PROMOTION, 0, 100)),
    mood: round2(clamp(career.mood + PROMOTED_MOOD, 0, 100)),
    cooldowns,
  };
  return log(c, `Promoted to ${def.title.toLowerCase()} on ${perHour(wage)}!`, "good", events);
}

/** Applies the owner's evening commands → the next planning phase (or gameover). */
export function finishCareerDay(content: ContentPack, game: CareerGame, commands: readonly Command[]): CareerGame {
  if (game.career.employer.status !== "employed" || game.career.handover) return game;
  let s = game.state;
  for (const cmd of commands) s = applyCommand(content, s, cmd).state;
  return { ...game, state: s };
}

/** Policy for auto-play (headless, demo fast-forward). */
export interface AutoPolicy {
  /** Weekend shifts to pick up (0-3). */
  weekendShifts: number;
  acceptOffers: boolean;
  askRaises: boolean;
  mentorSessions: boolean;
  /** Request a promotion as soon as the checklist is ready (instead of waiting for the review). */
  askPromotion: boolean;
}

export const DEFAULT_POLICY: AutoPolicy = { weekendShifts: 1, acceptOffers: true, askRaises: true, mentorSessions: true, askPromotion: true };

/** Shift plan for a policy: the contract days plus the first N weekend days (Sat, Fri, Sun). */
export function planFor(weekendShifts: number): boolean[] {
  const plan = [true, true, true, true, false, false, false];
  for (const d of [5, 4, 6].slice(0, clamp(weekendShifts, 0, 3))) plan[d] = true;
  return plan;
}

/** The player's choices for a morning under a policy (before beginCareerDay). */
export function autoCommands(career: CareerState, policy: AutoPolicy = DEFAULT_POLICY): CareerCommand[] {
  const cmds: CareerCommand[] = [];
  if (career.handover) return cmds;
  if (policy.acceptOffers) {
    const since = career.jobs.at(-1)?.fromDay ?? 0;
    const settled = career.employer.status !== "employed" || career.day - since >= MIN_TENURE_DAYS;
    const best = [...career.offers]
      .filter((o) => offerIsBetter(career, o) && (settled || o.rung > career.rung))
      .sort((a, b) => b.rung - a.rung || b.wage - a.wage)[0];
    if (best) cmds.push({ type: "ACCEPT_OFFER", offerId: best.id });
  }
  if (career.employer.status !== "employed") return cmds;
  const plan = planFor(career.mood < 40 || career.fatigue > 70 ? 0 : policy.weekendShifts);
  plan.forEach((on, wd) => {
    if (career.shiftPlan[wd] !== on) cmds.push({ type: "TAKE_SHIFT", weekday: wd, take: on });
  });
  if (policy.askPromotion && promotionChecklist(career).ready && canAskPromotion(career)) cmds.push({ type: "REQUEST_PROMOTION" });
  if (policy.askRaises && raiseAvailable(career) && reviewAverage(career) >= 3.6 && career.owner.mood >= 60) cmds.push({ type: "ASK_FOR_RAISE" });
  if (policy.mentorSessions && career.mentor && mentorSessionAvailable(career) && career.fatigue < 50) cmds.push({ type: "MENTOR_SESSION" });
  return cmds;
}

/**
 * One whole day: morning commands, owner planning, service, career evening, owner close. `handsOn` (round 4) stands in
 * for a shift played hands-on (headless "a child playing ★★ shifts"); it only counts on days the player works.
 */
export function advanceCareerDay(content: ContentPack, game: CareerGame, policy?: AutoPolicy, handsOn?: HandsOnShiftScore): { game: CareerGame; events: CareerEvent[] } {
  const events: CareerEvent[] = [];
  let g = game;
  if (policy) {
    for (const cmd of autoCommands(g.career, policy)) {
      const r = applyCareerCommand(content, g, cmd);
      g = r.game;
      events.push(...r.events);
    }
  }
  if (g.career.handover) return { game: g, events };
  if (g.career.employer.status !== "employed") {
    const r = stepCareerDay(content, g.career, g.state, g.state.history.at(-1)!);
    return { game: { ...g, career: r.career }, events: [...events, ...r.events] };
  }
  const begun = beginCareerDay(content, g);
  g = begun.game;
  const served = runService(content, g.career.owner.strategy, g.state);
  const result = served.history.at(-1)!;
  const r = stepCareerDay(content, g.career, served, result, begun.playerWorks ? handsOn : undefined);
  events.push(...r.events);
  g = finishCareerDay(content, { career: r.career, state: served }, r.nextOwnerCommands);
  return { game: g, events };
}

// ── commands ──
export const raiseAvailable = (c: CareerState): boolean => c.cooldowns.raise === undefined || c.day >= c.cooldowns.raise + RAISE_COOLDOWN_DAYS;
export const mentorSessionAvailable = (c: CareerState): boolean =>
  c.cooldowns.mentorSession === undefined || c.day >= c.cooldowns.mentorSession + MENTOR_SESSION_COOLDOWN;

export interface CommandResult {
  game: CareerGame;
  events: CareerEvent[];
  /** Set when the command was refused (state unchanged apart from the log). */
  rejected?: string;
}

function refuse(game: CareerGame, reason: string, events: CareerEvent[] = []): CommandResult {
  return { game: { ...game, career: log(game.career, reason, "bad", events) }, events, rejected: reason };
}

/** Applies a player career command. Best called in the planning phase (before beginCareerDay). */
export function applyCareerCommand(content: ContentPack, game: CareerGame, cmd: CareerCommand): CommandResult {
  const events: CareerEvent[] = [];
  const c = game.career;
  if (c.handover) return refuse(game, "You run your own place now.");
  switch (cmd.type) {
    case "TAKE_SHIFT": {
      if (!Number.isInteger(cmd.weekday) || cmd.weekday < 0 || cmd.weekday > 6) return refuse(game, "No such day.");
      const plan = c.shiftPlan.slice();
      plan[cmd.weekday] = !!cmd.take;
      if (plan.filter(Boolean).length > MAX_SHIFTS_PER_WEEK) return refuse(game, `That's more than ${MAX_SHIFTS_PER_WEEK} shifts: the Working Time rules (48 hours a week) say no.`);
      const career = { ...c, shiftPlan: plan };
      // Mid-planning: the owner re-rosters the player straight away.
      let state = game.state;
      const me = state.staff.find((s) => s.id === PLAYER_ID);
      if (state.phase === "planning" && me && c.employer.status === "employed") {
        state = applyCommand(content, state, { type: "SET_ROTA", staffId: PLAYER_ID, rota: plan }).state;
      }
      return { game: { career, state }, events };
    }
    case "REQUEST_PROMOTION": {
      if (c.employer.status !== "employed") return refuse(game, "You need a job to be promoted.");
      if (!canAskPromotion(c)) return refuse(game, "You asked recently. Give it a week.");
      const list = promotionChecklist(c);
      if (list.nextRung === undefined) return refuse(game, list.note ?? "There's no higher rung here.");
      let career: CareerState = { ...c, cooldowns: { ...c.cooldowns, promotionAsk: c.day } };
      if (!list.ready) {
        const missing = list.items.filter((i) => !i.met).map((i) => `${i.label} ${Math.floor(i.current)}/${i.target}`);
        events.push({ type: "PROMOTION_DENIED", missing: list.note ? [list.note] : missing });
        career = { ...career, mood: round2(clamp(career.mood - PROMOTION_DENIED_MOOD, 0, 100)) };
        career = log(career, `Not yet. ${list.note ?? `Still to do: ${missing.join(", ")}.`}`, "bad", events);
        return { game: { ...game, career }, events };
      }
      career = decidePromotion(career, events, game.state);
      return { game: { career, state: syncPlayer(career, game.state) }, events };
    }
    case "ASK_FOR_RAISE": {
      if (c.employer.status !== "employed") return refuse(game, "You need a job to ask for a raise.");
      if (!raiseAvailable(c)) return refuse(game, "You asked for a raise recently. Wait a few weeks.");
      const p = OWNERS[c.owner.strategy];
      const cap = Math.round(rungWage(c.track, c.rung, c.owner.strategy) * RAISE_BAND_CAP);
      let career: CareerState = { ...c, cooldowns: { ...c.cooldowns, raise: c.day } };
      if (c.wage >= cap) {
        events.push({ type: "RAISE", granted: false, wage: c.wage });
        career = log(career, `${c.owner.name}: "You're at the top of the band for your job. Earn the next rung."`, "info", events);
        return { game: { ...game, career }, events };
      }
      const chance = clamp(p.raiseChance * (c.owner.mood / 60) * (Math.max(1, reviewAverage(c)) / 3.5), 0, 0.9);
      const granted = Rng.fromSeed(hashSeed(c.seed, c.day, RAISE_SALT)).chance(chance);
      if (granted) {
        const wage = Math.min(cap, Math.round(c.wage * (1 + p.raisePct)));
        events.push({ type: "RAISE", granted: true, wage });
        career = { ...career, wage, mood: round2(clamp(c.mood + RAISE_GRANTED_MOOD, 0, 100)), owner: { ...c.owner, mood: round2(clamp(c.owner.mood - 1, 0, 100)) } };
        career = log(career, `Raise agreed: ${perHour(c.wage)} → ${perHour(wage)}.`, "money", events);
      } else {
        events.push({ type: "RAISE", granted: false, wage: c.wage });
        career = { ...career, mood: round2(clamp(c.mood - RAISE_REFUSED_MOOD, 0, 100)), owner: { ...c.owner, mood: round2(clamp(c.owner.mood - 2, 0, 100)) } };
        career = log(career, `${c.owner.name} says no to a raise for now.`, "bad", events);
      }
      return { game: { career, state: syncPlayer(career, game.state) }, events };
    }
    case "MENTOR_SESSION": {
      if (!c.mentor) return refuse(game, "You don't have a mentor yet. Work well with someone better than you.");
      if (!mentorSessionAvailable(c)) return refuse(game, "Your mentor is busy: one session a week.");
      const gain = round2(MENTOR_SESSION_GAIN * OWNERS[c.owner.strategy].growthMult * (1 - trackStat(c.track, c.stats) / GROWTH_SOFT_CAP));
      events.push({ type: "MENTOR_SESSION", gain });
      let career: CareerState = {
        ...c,
        stats: applyGain(c.track, c.stats, gain),
        fatigue: round2(clamp(c.fatigue + MENTOR_SESSION_FATIGUE, 0, 100)),
        cooldowns: { ...c.cooldowns, mentorSession: c.day },
        relationships: c.relationships.map((r) => (r.staffId === c.mentor && r.current ? { ...r, bond: round2(clamp(r.bond + MENTOR_SESSION_BOND, -100, 100)) } : r)),
        lifetime: { ...c.lifetime, mentorSessions: c.lifetime.mentorSessions + 1 },
      };
      career = log(career, `An hour with ${relationshipName(c, c.mentor)} before service: +${gain.toFixed(1)}.`, "good", events);
      return { game: { career, state: syncPlayer(career, game.state) }, events };
    }
    case "ACCEPT_OFFER": {
      const offer = c.offers.find((o) => o.id === cmd.offerId);
      if (!offer) return refuse(game, "That offer isn't open any more.");
      if (c.employer.status === "employed" && game.state.phase !== "planning") return refuse(game, "Hand in your notice in the morning, not mid-shift.");
      return acceptOffer(content, game, offer, events);
    }
    case "DECLINE_OFFER": {
      if (!c.offers.some((o) => o.id === cmd.offerId)) return refuse(game, "That offer isn't open any more.");
      return { game: { ...game, career: { ...c, offers: c.offers.filter((o) => o.id !== cmd.offerId) } }, events };
    }
    case "OPEN_OWN_PLACE": {
      const budget = openingBudget(content, c, cmd.districtId);
      if (!budget.rungOk) return refuse(game, `Banks want to see you've been a ${budget.rungNeeded.toLowerCase()} first.`);
      if (budget.shortfall > 0) return refuse(game, `You're ${pounds(budget.shortfall)} short of the fit-out, deposit and reserve.`);
      const h = handoverToOwner(content, c, game.state, { ...cmd, day: c.day });
      events.push({ type: "OPENED_OWN_PLACE", summary: h.summary });
      let career = endJob(c, "opened_own");
      career = { ...career, employer: { ...career.employer, status: "left" }, handover: h.summary, ownerPerks: h.ownerPerks, canOpenOwn: false, offers: [] };
      career = log(career, `You've opened ${h.summary.restaurantName}!`, "good", events);
      return { game: { career, state: h.state }, events };
    }
  }
}

/** Takes an offer: a new employer GameState (other owner and district), skills carried over. */
function acceptOffer(content: ContentPack, game: CareerGame, offer: Offer, events: CareerEvent[]): CommandResult {
  let c = endJob(game.career, "offer");
  const state = newEmployer(content, {
    seed: offer.seed,
    districtId: offer.districtId,
    strategy: offer.strategy,
    restaurantName: offer.restaurantName,
    difficulty: c.employer.difficulty,
    track: c.track,
    rung: offer.rung,
  });
  const rungUp = offer.rung > c.rung;
  const def = rungDef(c.track, offer.rung);
  c = {
    ...c,
    rung: offer.rung,
    role: def.simRole,
    wage: offer.wage,
    shiftsAtRung: rungUp ? 0 : c.shiftsAtRung,
    promotionsEarned: c.promotionsEarned + (rungUp ? 1 : 0),
    owner: { name: offer.ownerName, strategy: offer.strategy, mood: OWNER_MOOD_START },
    employer: { restaurantName: state.restaurantName, districtId: state.districtId, seed: offer.seed, difficulty: c.employer.difficulty, status: "employed" },
    offers: [],
    cooldowns: {},
    jobs: [...c.jobs, { restaurantName: state.restaurantName, ownerName: offer.ownerName, strategy: offer.strategy, districtId: state.districtId, fromDay: c.day, fromRung: offer.rung }],
    // Mid-week moves keep the week's pay and shifts; the new owner reviews you from scratch.
    weeklyReview: c.weeklyReview,
  };
  events.push({ type: "JOB_CHANGED", restaurantName: state.restaurantName, strategy: offer.strategy, rung: offer.rung });
  c = log(c, `New job: ${def.title.toLowerCase()} at ${state.restaurantName} (${offer.strategy}) on ${perHour(offer.wage)}.`, "good", events);
  const synced = syncPlayer(c, state);
  c = refreshTeam(c, synced, events);
  return { game: { career: c, state: synced }, events };
}

// ── serialisation ──
/** JSON with object keys sorted (like sim-core serialize), so equal careers always save byte-identically. */
function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x,
  );
}

export function serializeCareer(career: CareerState): string {
  return stableStringify(career);
}

export function deserializeCareer(json: string): CareerState {
  const raw = JSON.parse(json) as Partial<CareerState>;
  if (raw.version !== CAREER_SAVE_VERSION) throw new Error(`Unsupported career save version ${String(raw.version)}`);
  return raw as CareerState;
}
