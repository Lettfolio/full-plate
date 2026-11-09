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
import { clamp, logEvent, round2, tallyOf, traitMult, worksToday } from "../util";
import { rosterGaps, type SystemResult } from "./system";

export interface DayContext {
  covers: number;
  meanRating: number | undefined;
  tipsPerFoh: number;
  workingCount: number;
  managerOn: boolean;
  /** [round 3] CLOSE_TODAY: nobody worked; everyone gets a rest day. */
  closed?: boolean;
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

export function updateStaffMember(content: ContentPack, s: Staff, day: number, ctx: DayContext): Staff {
  if (s.trainingDay === day) {
    const { trainingDay: _t, breakUntilTick: _b, ...rest } = s;
    return { ...rest, mood: round2(clamp(s.mood + TRAINING_MOOD, 0, 100)) };
  }
  const { breakUntilTick: _b, ...rest } = s;
  s = rest;
  const worked = worksToday(s, day) && !ctx.closed;
  const fatigue = nextFatigue(worked, s.fatigue, ctx.workingCount ? ctx.covers / ctx.workingCount : 0);
  const mood = round2(clamp(s.mood + moodChange(content, s, worked, ctx, fatigue), 0, 100));
  const skill = worked ? round2(Math.min(s.potential, s.skill + SKILL_GROWTH_PER_SHIFT)) : s.skill;
  return { ...s, fatigue, mood, skill };
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
    staffMoodDelta[s.id] = round2(next.mood - s.mood);
    if (next.mood < QUIT_MOOD && rng.chance(QUIT_CHANCE)) {
      events.push(logEvent(state, `${s.name} has had enough and quit.`, "bad"));
      continue;
    }
    staff.push(next);
  }
  return { state: { ...state, staff, ownerFatigue, todays: { ...state.todays, staffMoodDelta } }, events };
}
