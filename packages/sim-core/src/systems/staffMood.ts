/**
 * StaffMoodSystem (evening) — worked shifts add fatigue (more on busy days), rest days recover it.
 * Mood falls with high fatigue, overwork (>5 rota days) and low tips; rises with good ratings,
 * rest and a manager on shift; drifts slowly toward a baseline. Skill grows toward hidden potential.
 * Very unhappy staff may quit. A training day counts as neither a shift nor a rest: no fatigue change, a small
 * mood lift (the skill gain was applied by TRAIN). Also updates the owner's own fatigue from covering.
 */
import {
  OWNER_FATIGUE_PER_10_COVERS,
  OWNER_FATIGUE_PER_ROLE,
  OWNER_FATIGUE_RECOVERY,
  OWNER_FATIGUE_WARNING,
  TRAINING_MOOD,
  FATIGUE_MOOD_DIVISOR,
  FATIGUE_MOOD_THRESHOLD,
  FATIGUE_PER_10_COVERS,
  FATIGUE_PER_SHIFT,
  FATIGUE_RECOVERY_PER_REST_DAY,
  GOOD_DAY_MOOD_PER_STAR,
  MANAGER_MOOD_BONUS,
  MOOD_DRIFT_RATE,
  MOOD_DRIFT_TARGET,
  OVERWORK_DAYS,
  OVERWORK_MOOD_PER_DAY,
  QUIT_CHANCE,
  QUIT_MOOD,
  REST_DAY_MOOD,
  SKILL_GROWTH_PER_SHIFT,
  TIP_EXPECTATION_PER_SHIFT,
  TIP_MOOD_MAX,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, GameState, SimEvent, Staff } from "../types";
import { clamp, isWeekend, logEvent, round2, tallyOf, traitMult, weekdayOf, worksToday } from "../util";
import { mainReason, personalityFactors, personalityMood, trackById, type MoodFactor } from "../personality";
import { rosterGaps, type SystemResult } from "./system";

export interface DayContext {
  covers: number;
  meanRating: number | undefined;
  tipsPerFoh: number;
  workingCount: number;
  managerOn: boolean;
  /** [round 3] CLOSE_TODAY: nobody worked; everyone gets a rest day. */
  closed?: boolean;
  /** [round 10] Who was on the floor today (personality: who you worked with). Absent = no relationship effects. */
  working?: readonly Staff[];
}

const isFoh = (s: Staff) => s.role === "server" || s.role === "bar";

export function dayContext(state: GameState): DayContext {
  const working = state.staff.filter((s) => worksToday(s, state.day) && s.trainingDay !== state.day);
  const foh = working.filter(isFoh).length;
  const tally = tallyOf(state);
  return {
    covers: state.todays.covers ?? 0,
    meanRating: tally.ratedCovers ? tally.ratingSum / tally.ratedCovers : undefined,
    tipsPerFoh: foh ? tally.serverTips / foh : 0,
    workingCount: working.length,
    managerOn: working.some((s) => s.role === "manager"),
    working,
    ...(state.todays.closed ? { closed: true } : {}),
  };
}

export function moodChange(content: ContentPack, s: Staff, worked: boolean, ctx: DayContext, fatigue: number): number {
  let delta = 0;
  if (worked) {
    if (ctx.meanRating !== undefined) delta += (ctx.meanRating - 3) * GOOD_DAY_MOOD_PER_STAR;
    if (fatigue > FATIGUE_MOOD_THRESHOLD) delta -= (fatigue - FATIGUE_MOOD_THRESHOLD) / FATIGUE_MOOD_DIVISOR;
    const days = s.rota.filter(Boolean).length;
    if (days > OVERWORK_DAYS) delta -= (days - OVERWORK_DAYS) * OVERWORK_MOOD_PER_DAY;
    if (isFoh(s)) {
      const ratio = ctx.tipsPerFoh / TIP_EXPECTATION_PER_SHIFT - 1;
      delta += clamp(ratio * TIP_MOOD_MAX, -TIP_MOOD_MAX, TIP_MOOD_MAX);
    }
    if (ctx.managerOn && s.role !== "manager") delta += MANAGER_MOOD_BONUS;
  } else {
    delta += REST_DAY_MOOD;
  }
  delta += (MOOD_DRIFT_TARGET - s.mood) * MOOD_DRIFT_RATE;
  return delta * (delta < 0 ? traitMult(content, s.traits, "moodDecay") : 1);
}

export function nextFatigue(worked: boolean, fatigue: number, coversPerHead: number): number {
  const f = worked
    ? fatigue + FATIGUE_PER_SHIFT + (coversPerHead / 10) * FATIGUE_PER_10_COVERS
    : fatigue - FATIGUE_RECOVERY_PER_REST_DAY;
  return round2(clamp(f, 0, 100));
}

/**
 * [round 10] The base mood rule's reasons, for the mood note only (moodChange stays the arithmetic of record).
 * Same terms as moodChange, without the drift.
 */
export function baseMoodFactors(s: Staff, worked: boolean, ctx: DayContext, fatigue: number, day: number): MoodFactor[] {
  const out: MoodFactor[] = [];
  if (!worked) {
    out.push({ delta: REST_DAY_MOOD, text: ctx.closed ? "the restaurant was closed: a day off" : `had ${WEEKDAY[weekdayOf(day)]} off` });
    return out;
  }
  if (ctx.meanRating !== undefined) {
    const d = (ctx.meanRating - 3) * GOOD_DAY_MOOD_PER_STAR;
    out.push({ delta: d, text: d >= 0 ? "the guests loved it" : "the guests were unhappy" });
  }
  if (fatigue > FATIGUE_MOOD_THRESHOLD) out.push({ delta: -(fatigue - FATIGUE_MOOD_THRESHOLD) / FATIGUE_MOOD_DIVISOR, text: "worn out" });
  const days = s.rota.filter(Boolean).length;
  if (days > OVERWORK_DAYS) out.push({ delta: -(days - OVERWORK_DAYS) * OVERWORK_MOOD_PER_DAY, text: `${days} shifts this week is too many` });
  if (isFoh(s)) {
    const d = clamp((ctx.tipsPerFoh / TIP_EXPECTATION_PER_SHIFT - 1) * TIP_MOOD_MAX, -TIP_MOOD_MAX, TIP_MOOD_MAX);
    out.push({ delta: d, text: d >= 0 ? "good tips" : "hardly any tips" });
  }
  if (ctx.managerOn && s.role !== "manager") out.push({ delta: MANAGER_MOOD_BONUS, text: "the manager was in" });
  return out;
}
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** [round 10] Personality factors for `s` today (likes, dislikes, who they worked with). */
function personalityToday(content: ContentPack, s: Staff, day: number, ctx: DayContext, worked: boolean, fatigue: number, training: boolean): MoodFactor[] {
  const ratio = isFoh(s) ? ctx.tipsPerFoh / TIP_EXPECTATION_PER_SHIFT - 1 : -1;
  return personalityFactors(content, s, {
    worked,
    training,
    weekday: weekdayOf(day),
    weekend: isWeekend(day),
    coversPerHead: ctx.workingCount ? ctx.covers / ctx.workingCount : 0,
    meanRating: ctx.meanRating,
    tipsRatio: ratio,
    fatigue,
    workedWith: ctx.working ? ctx.working.filter((o) => o.id !== s.id) : [],
  });
}

/**
 * The day's main reason. Personality reasons (a like, a dislike, a friend or a clash) win when they moved mood by at
 * least 1, so the staff room shows who people are ("had Sunday off", "worked with Ellie"), not "the guests loved it"
 * every night; otherwise the biggest reason of all.
 */
const note = (factors: readonly MoodFactor[], delta: number, personal: readonly MoodFactor[] = []): Staff["moodWhy"] => {
  const own = mainReason(personal);
  const main = own && Math.abs(own.delta) >= 1 ? own : mainReason(factors);
  return { text: main?.text ?? (Math.abs(delta) < 0.5 ? "an ordinary day" : delta > 0 ? "a good day" : "a long day"), delta: round2(delta) };
};

export function updateStaffMember(content: ContentPack, s: Staff, day: number, ctx: DayContext): Staff {
  if (s.trainingDay === day) {
    const { trainingDay: _t, trainingTrack: _k, breakUntilTick: _b, ...rest } = s;
    const pf = personalityToday(content, s, day, ctx, false, s.fatigue, true);
    const delta = TRAINING_MOOD + personalityMood(pf);
    const mood = round2(clamp(s.mood + delta, 0, 100));
    const track = s.trainingTrack && trackById(s.trainingTrack);
    const why = [...pf, { delta: TRAINING_MOOD, text: track ? `learning ${track.name.toLowerCase()}` : "a day on a training course" }];
    return { ...rest, mood, moodWhy: note(why, mood - s.mood, pf) };
  }
  const { breakUntilTick: _b, ...rest } = s;
  s = rest;
  const worked = worksToday(s, day) && !ctx.closed;
  const fatigue = nextFatigue(worked, s.fatigue, ctx.workingCount ? ctx.covers / ctx.workingCount : 0);
  const pf = personalityToday(content, s, day, ctx, worked, fatigue, false);
  const mood = round2(clamp(s.mood + moodChange(content, s, worked, ctx, fatigue) + personalityMood(pf), 0, 100));
  const skill = worked ? round2(Math.min(s.potential, s.skill + SKILL_GROWTH_PER_SHIFT)) : s.skill;
  return { ...s, fatigue, mood, skill, moodWhy: note([...baseMoodFactors(s, worked, ctx, fatigue, day), ...pf], mood - s.mood, pf) };
}

/** Owner fatigue after today: up for each role covered (and busier days), down on a day the team ran it. */
export function nextOwnerFatigue(state: GameState): number {
  const covered = state.todays.closed ? 0 : rosterGaps(state).length;
  const f = state.ownerFatigue ?? 0;
  const next = covered
    ? f + covered * OWNER_FATIGUE_PER_ROLE + ((state.todays.covers ?? 0) / 10) * OWNER_FATIGUE_PER_10_COVERS
    : f - OWNER_FATIGUE_RECOVERY;
  return round2(clamp(next, 0, 100));
}

export function staffMoodSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const ctx = dayContext(state);
  const events: SimEvent[] = [];
  const ownerFatigue = nextOwnerFatigue(state);
  if (ownerFatigue >= OWNER_FATIGUE_WARNING && ownerFatigue > (state.ownerFatigue ?? 0)) {
    events.push(logEvent(state, "You're worn out from covering shifts. Tired owners cook and serve worse: hire some help!", "bad"));
  }
  const staffMoodDelta: Record<string, number> = {};
  const staff: Staff[] = [];
  for (const s of state.staff) {
    const next = updateStaffMember(content, s, state.day, ctx);
    const track = s.trainingDay === state.day && s.trainingTrack ? trackById(s.trainingTrack) : undefined;
    if (track) {
      const lvl = next.tracks?.[track.id] ?? 1;
      events.push(logEvent(state, `Level up! ${s.name} finished ${track.name} level ${lvl}${track.stat ? ` (${track.stat} +${track.gain})` : lvl === 1 ? ": they can cover the pass now" : ""}.`, "good"));
    }
    staffMoodDelta[s.id] = round2(next.mood - s.mood);
    if (next.mood < QUIT_MOOD && rng.chance(QUIT_CHANCE)) {
      events.push(logEvent(state, `${s.name} has had enough and quit.`, "bad"));
      continue;
    }
    staff.push(next);
  }
  return { state: { ...state, staff, ownerFatigue, todays: { ...state.todays, staffMoodDelta } }, events };
}
