/**
 * Weekly reviews: a 1-5 score and a few plain-English notes from the owner (or your mentor), built from the week's
 * DayResults on your shifts and your staff record (skill growth, mood, fatigue, incidents, reliability).
 * Pure and deterministic: the wording is picked with a seeded Rng from (career.seed, day).
 */
import type { DayResult } from "@full-plate/sim-core";
import { OWNERS } from "./constants";
import { clamp, pounds, rungDef, trackStatName } from "./ladder";
import { hashSeed, Rng } from "./rng";
import type { CareerState, ReviewBreakdown, WeeklyReview, WeekTally } from "./types";

const REVIEW_SALT = 0x2e71e3;

export interface ReviewContext {
  /** Name of whoever writes the review. */
  reviewer: string;
  reviewerRole: "owner" | "mentor";
  /** Current track stat (after this week's growth). */
  statNow: number;
  /** Is the player in a management rung (business = profit rather than covers)? */
  management: boolean;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The days in the week's results the player was on the floor. */
export function workedResults(week: WeekTally): DayResult[] {
  const set = new Set(week.workedSimDays);
  return week.results.filter((r) => set.has(r.day));
}

/** Each component on a 1-5 scale. */
export function reviewBreakdown(career: CareerState, week: WeekTally, ctx: ReviewContext): ReviewBreakdown {
  const worked = workedResults(week);
  const rated = worked.filter((r) => r.covers > 0);
  // Most services rate 4-4.5★; the review spreads that band out (4.0★ ⇒ 3, 4.4★ ⇒ 4, 4.8★ ⇒ 5).
  const rating = rated.length ? clamp(3 + (mean(rated.map((r) => r.averageRating)) - 4) * 2.5, 1, 5) : 3;
  const offered = week.contractShifts + week.contractDeclined;
  const reliability = offered ? clamp(1 + (4 * week.contractShifts) / offered + 0.25 * week.weekendShifts, 1, 5) : 3 + Math.min(1, 0.25 * week.weekendShifts);
  const gain = ctx.statNow - week.statStart;
  const growth = clamp(2 + gain * 3, 1, 5);
  let business: number;
  if (ctx.management) {
    business = clamp(3 + week.profit / 150_000, 1, 5);
  } else {
    const covers = worked.reduce((a, r) => a + r.covers, 0);
    const walk = worked.reduce((a, r) => a + r.walkouts, 0);
    business = worked.length ? clamp(5 - (walk / Math.max(1, covers + walk)) * 25, 1, 5) : 3;
  }
  const incidents = clamp(week.incidentsHandled * 0.1 - week.incidentsIgnored * 0.15, -0.5, 0.5);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { rating: r1(rating), reliability: r1(reliability), growth: r1(growth), business: r1(business), incidents: r1(incidents) };
}

/** A week of unexcused no-shows is judged on reliability alone. */
export function reviewScoreForWeek(career: CareerState, week: WeekTally, b: ReviewBreakdown): number {
  if (week.workedDays.length === 0 && week.contractDeclined > 0) return Math.round(clamp(b.reliability, 1, 5) * 10) / 10;
  return reviewScore(career, b);
}

export function reviewScore(career: CareerState, b: ReviewBreakdown): number {
  const w = OWNERS[career.owner.strategy].reviewWeights;
  const raw = w.rating * b.rating + w.reliability * b.reliability + w.growth * b.growth + w.business * b.business + b.incidents;
  return Math.round(clamp(raw, 1, 5) * 10) / 10;
}

const PRAISE: Record<keyof Omit<ReviewBreakdown, "incidents">, string[]> = {
  rating: ["Guests loved the food on your shifts.", "The plates going out on your shifts were a credit to us.", "Lovely ratings when you're on: keep it up."],
  reliability: ["Always here when you said you would be. That matters.", "Rock solid on the rota this week.", "You turned up every shift, ready to go."],
  growth: ["You're picking things up fast.", "Real progress this week: I can see it.", "You learn something every service."],
  business: ["We turned tables smoothly when you were on.", "Nobody walked out on your watch.", "A tidy, well-run week."],
};
const ADVICE: Record<keyof Omit<ReviewBreakdown, "incidents">, string[]> = {
  rating: ["Ratings dipped on your shifts: slow down and get it right.", "Taste everything before it leaves.", "A few unhappy tables this week; let's talk about why."],
  reliability: ["I need you on the shifts you're contracted for.", "Missing shifts leaves the team short. Please don't make it a habit.", "The rota only works if you're on it."],
  growth: ["Push yourself a bit more: ask questions, try the harder jobs.", "You've plateaued a little. Watch the best people closely.", "Let's find you something new to learn."],
  business: ["Too many walk-outs: keep an eye on the door.", "Service dragged this week. Speed up the simple things.", "We lost tables we should have kept."],
};
const MANAGER_BUSINESS = { good: "The numbers were good this week.", bad: "We lost money this week. Look at costs and the rota." };

/** Builds a WeeklyReview from the week tally. Pure. */
export function generateReview(career: CareerState, week: WeekTally, ctx: ReviewContext): WeeklyReview {
  const rng = Rng.fromSeed(hashSeed(career.seed, career.day, REVIEW_SALT));
  const breakdown = reviewBreakdown(career, week, ctx);
  const score = reviewScoreForWeek(career, week, breakdown);
  const shifts = week.workedDays.length;
  const notes: string[] = [];
  const keys = (["rating", "reliability", "growth", "business"] as const).filter((k) => shifts > 0 || k === "reliability");
  const sorted = [...keys].sort((a, b) => breakdown[b] - breakdown[a] || a.localeCompare(b));
  const best = sorted[0];
  const worst = sorted.at(-1);
  if (shifts === 0) {
    notes.push(week.excused ? "You were off this week. Rest up, we'll see you soon." : "I didn't see you on a single shift this week.");
  } else {
    if (best && breakdown[best] >= 3.5) notes.push(ctx.management && best === "business" ? MANAGER_BUSINESS.good : rng.pick(PRAISE[best]));
    if (worst && worst !== best && breakdown[worst] < 3) notes.push(ctx.management && worst === "business" ? MANAGER_BUSINESS.bad : rng.pick(ADVICE[worst]));
  }
  const gain = ctx.statNow - week.statStart;
  if (gain >= 0.05) notes.push(`${trackStatName(career.track)} up ${gain.toFixed(1)} this week (now ${Math.round(ctx.statNow)}).`);
  if (week.incidentsHandled) notes.push(`${week.incidentsHandled} problem${week.incidentsHandled === 1 ? "" : "s"} sorted on your shifts.`);
  if (week.incidentsIgnored) notes.push(`${week.incidentsIgnored} problem${week.incidentsIgnored === 1 ? "" : "s"} left to fester. Speak up next time.`);
  if (career.fatigue > 60) notes.push("You look shattered. Take a day off when you can.");
  else if (career.mood < 35) notes.push("You don't seem happy. Is something up?");
  if (ctx.reviewerRole === "mentor" && week.mentorShifts) notes.push(`(${ctx.reviewer} worked ${week.mentorShifts} shift${week.mentorShifts === 1 ? "" : "s"} with you.)`);
  if (week.tips) notes.push(`Your share of the tronc: ${pounds(week.tips)}.`);
  if (notes.length === 0) notes.push(`A steady week as ${rungDef(career.track, career.rung).title.toLowerCase()}.`);
  return {
    day: career.day,
    week: Math.floor(career.day / 7) + 1,
    score,
    reviewer: ctx.reviewer,
    reviewerRole: ctx.reviewerRole,
    notes,
    breakdown,
    shifts,
    contractShifts: week.contractShifts,
    statGain: Math.round(gain * 100) / 100,
    tips: week.tips,
    mood: Math.round(career.mood),
    fatigue: Math.round(career.fatigue),
    incidentsHandled: week.incidentsHandled,
  };
}
