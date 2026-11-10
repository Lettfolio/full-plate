/**
 * Inspectors — HIDDEN state. Visits are drawn from the Stars RNG at the start of each assessment window, on days the
 * player never sees; each visit scores that day's five criteria (plus a little per-inspector palate noise); on guide
 * day every visit of the year is revealed and the stars are decided from all of them together.
 */
import { DAYS_PER_MONTH, monthOf } from "@full-plate/sim-core";
import {
  DOUBLE_JUMP_MARGIN,
  DOUBLE_JUMP_MIN_VISITS,
  GUIDE_MONTH,
  INSPECTOR_NAMES,
  INSPECTOR_NOISE_SD,
  MIN_FIRST_WINDOW_DAYS,
  MIN_OPEN_DAYS_ASSESSED,
  MIN_VISITS_ASSESSED,
  SEASON_DAYS,
  SEASON_VISIT_SHARE,
  STAR_KEEP_MARGIN,
  STAR_THRESHOLDS,
  VISIT_CUTOFF_DAYS,
  VISITS_MAX,
  VISITS_MIN,
  YEAR_CONSISTENCY_WEIGHT,
} from "./constants";
import { CRITERIA_KEYS, clamp, criteriaTotal, r2, seriesConsistency, windowConsistency, zeroCriteria } from "./proxies";
import type { Rng } from "./rng";
import type { Assessment, Criteria, InspectorVisit, StarCount, StarsState } from "./types";

// ── calendar ──
/** First day ≥ `from` that is the 1st of `month` (1-12) in sim-core's calendar. */
export function nextMonthStart(from: number, month: number): number {
  let d = Math.ceil(from / DAYS_PER_MONTH) * DAYS_PER_MONTH;
  while (monthOf(d) !== month) d += DAYS_PER_MONTH;
  return d;
}

/** The first guide day for a Stars run starting on `startDay` (needs ≥ MIN_FIRST_WINDOW_DAYS of assessment). */
export function firstGuideDay(startDay: number): number {
  return nextMonthStart(startDay + MIN_FIRST_WINDOW_DAYS, GUIDE_MONTH);
}

export function inSeason(stars: Pick<StarsState, "guides">, day: number): boolean {
  const g = stars.guides.michelin.nextGuideDay;
  return day < g && day >= g - SEASON_DAYS;
}

export function emptyAssessment(windowStart: number): Assessment {
  return { windowStart, openDays: 0, criteriaSum: zeroCriteria(), qN: 0, qSum: 0, qSumSq: 0, qOff: 0 };
}

/**
 * Draws this window's visit days: VISITS_MIN..VISITS_MAX of them, about half inside inspection season, none in the
 * last VISIT_CUTOFF_DAYS before guide day, all distinct. Returned sorted.
 */
export function scheduleVisits(rng: Rng, windowStart: number, guideDay: number): number[] {
  const last = guideDay - VISIT_CUTOFF_DAYS - 1;
  if (last <= windowStart) return [];
  const n = rng.int(VISITS_MIN, VISITS_MAX);
  const seasonStart = Math.max(windowStart, guideDay - SEASON_DAYS);
  const days = new Set<number>();
  let guard = 0;
  while (days.size < Math.min(n, last - windowStart + 1) && guard++ < 1000) {
    const season = seasonStart < last && rng.chance(SEASON_VISIT_SHARE);
    const lo = season ? seasonStart : windowStart;
    days.add(rng.int(lo, last));
  }
  return [...days].sort((a, b) => a - b);
}

/** One inspector's meal: the day's criteria through their palate. Hidden until guide day. */
export function makeVisit(rng: Rng, day: number, criteria: Criteria, index: number): InspectorVisit {
  const scores = { ...criteria };
  for (const k of CRITERIA_KEYS) scores[k] = r2(clamp(criteria[k] + rng.gaussian(0, INSPECTOR_NOISE_SD), 0, 100));
  const inspector = INSPECTOR_NAMES[(index + rng.int(0, INSPECTOR_NAMES.length - 1)) % INSPECTOR_NAMES.length]!;
  return { day, inspector, scores, total: criteriaTotal(scores), revealed: false };
}

/** Whole-year consistency: half the mean daily consistency criterion, half the year's own quality spread. */
export function yearConsistency(a: Assessment): number {
  if (a.openDays === 0) return 0;
  const mean = a.qN ? a.qSum / a.qN : 0;
  const sd = a.qN ? Math.sqrt(Math.max(0, a.qSumSq / a.qN - mean * mean)) : 0;
  const series = seriesConsistency({ n: a.qN, mean, sd, offShare: a.qN ? a.qOff / a.qN : 0 });
  return r2(0.5 * (a.criteriaSum.consistency / a.openDays) + 0.5 * series);
}

/** The guide's score: mean visit total, each visit's consistency blended with the whole year's consistency. */
export function guideScore(visits: readonly InspectorVisit[], yearC: number): number {
  if (visits.length === 0) return 0;
  const totals = visits.map((v) =>
    criteriaTotal({ ...v.scores, consistency: (1 - YEAR_CONSISTENCY_WEIGHT) * v.scores.consistency + YEAR_CONSISTENCY_WEIGHT * yearC }),
  );
  return r2(totals.reduce((a, b) => a + b, 0) / totals.length);
}

export function starsForScore(score: number): StarCount {
  let s = 0;
  for (const t of STAR_THRESHOLDS) if (score >= t) s++;
  return s as StarCount;
}

export interface GuideDecision { after: StarCount; assessed: boolean; score?: number; reason: string }

/**
 * Guide day. Fat Duck rule first (closed too long / too few visits ⇒ not assessed ⇒ stars lapse to 0). Otherwise the
 * guide is conservative both ways: up by one star a year (two if the score clears the higher bar by
 * DOUBLE_JUMP_MARGIN over ≥ DOUBLE_JUMP_MIN_VISITS visits), down by one at most — and (round 11) only when the score
 * falls more than STAR_KEEP_MARGIN below the bar for the stars already held.
 */
export function decideGuide(before: StarCount, visits: readonly InspectorVisit[], a: Assessment, excluded: boolean): GuideDecision {
  if (excluded) return { after: 0, assessed: false, reason: "You asked the guide to leave you out." };
  if (a.openDays < MIN_OPEN_DAYS_ASSESSED || visits.length < MIN_VISITS_ASSESSED) {
    return {
      after: 0,
      assessed: false,
      reason: `Closed for too much of the year to be assessed (${a.openDays} open days, ${visits.length} visits) — any stars lapse.`,
    };
  }
  const score = guideScore(visits, yearConsistency(a));
  const target = starsForScore(score);
  let after: StarCount = before;
  if (target > before) {
    const two = before + 2 <= target && visits.length >= DOUBLE_JUMP_MIN_VISITS && score >= STAR_THRESHOLDS[before + 1]! + DOUBLE_JUMP_MARGIN;
    after = Math.min(target, before + (two ? 2 : 1)) as StarCount;
  } else if (target < before && score < STAR_THRESHOLDS[before - 1]! - STAR_KEEP_MARGIN) after = (before - 1) as StarCount;
  const reason =
    after > before ? `The inspectors were impressed (score ${score.toFixed(1)}).`
    : after < before ? `The inspectors found the cooking slipping (score ${score.toFixed(1)}).`
    : `The guide holds you where you are (score ${score.toFixed(1)}).`;
  return { after, assessed: true, score, reason };
}

/**
 * DEBUG / COSY HINT ONLY. Predicts what the guide would say from the visits so far and the rolling quality window.
 * The UI must never show visit details or this prediction as fact before guide day; at most a fuzzy cosy-mode hint
 * (see `cosyHint`). `confidence` 0-1 grows with the number of visits and falls with their spread.
 */
export function inspectorModel(visits: readonly InspectorVisit[], consistency: readonly number[]): { predictedStars: StarCount; confidence: number; score: number } {
  if (visits.length === 0) return { predictedStars: 0, confidence: 0, score: 0 };
  const score = guideScore(visits, windowConsistency(consistency));
  const totals = visits.map((v) => v.total);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const sd = Math.sqrt(totals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / totals.length);
  const confidence = r2(clamp((Math.min(visits.length, 4) / 4) * (1 - sd / 15), 0, 1));
  return { predictedStars: starsForScore(score), confidence, score };
}

/** A fuzzy, never-numeric line a Cosy-mode UI may show. Built on inspectorModel over this year's (hidden) visits. */
export function cosyHint(stars: StarsState): string {
  const hidden = stars.guides.michelin.inspectorVisits.filter((v) => !v.revealed);
  const m = inspectorModel(hidden, stars.consistencyWindow);
  if (m.confidence < 0.3) return "Nobody knows what the guide thinks yet. Keep every service steady.";
  const cur = stars.guides.michelin.stars;
  if (m.predictedStars > cur) return "There's a buzz in the trade: people say the guide has noticed you.";
  if (m.predictedStars < cur) return "Whispers say the guide's people weren't thrilled. Tighten up.";
  return "The word is that you're holding steady.";
}
