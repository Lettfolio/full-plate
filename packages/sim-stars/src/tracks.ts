/**
 * The other prestige tracks. Each has its own cadence and its own formula on the hidden daily-score EMA
 * (`dailyScoreEma`, the mean of the five criteria smoothed over ~50 open days), the stars and the game's prestige.
 *
 *  World's 50 Best  every June 1st   worldScore = EMA + 4·stars + 0.15·prestige + N(0, 2)
 *                                    rank = round(1 + (110 − worldScore)·6); listed when ≤ 50.
 *                                    Reaching No. 1 moves you to the hall of fame: out of the running for good.
 *  Gault&Millau     every Nov 1st    points = clamp(round½((EMA − 40)/3 + stars), 0, 19.5) — never 20.
 *  Good Food Guide  every Sept 1st   score  = clamp(round((EMA − 55)/4 + stars), 0, 10); 0 = not listed.
 *  Local critic     every 45–120 d   rating on today's criteria mean + N(0, 3): ≥85 ★5, ≥75 ★4, ≥62 ★3, ≥50 ★2, else ★1.
 *                                    ★5 doubles-ish bookings for a fortnight (footfall ×1.6 for 14 days), ★1 ×0.7.
 */
import {
  CRITIC_BANDS,
  CRITIC_FOOTFALL,
  CRITIC_INTERVAL,
  CRITIC_NAMES,
  CRITIC_NOISE_SD,
  CRITIC_PRESTIGE_PER_STAR,
  FIFTY_BEST_MONTH,
  FIFTY_BEST_NOISE_SD,
  FIFTY_BEST_RANK_SLOPE,
  FIFTY_BEST_TOP,
  GAULT_MILLAU_MAX,
  GAULT_MILLAU_MONTH,
  GOOD_FOOD_MAX,
  GOOD_FOOD_MONTH,
  PRESTIGE_TARGET,
} from "./constants";
import { nextMonthStart } from "./inspector";
import { clamp, r2 } from "./proxies";
import type { Rng } from "./rng";
import type { Review, StarCount, StarsEvent, StarsState } from "./types";

export function fiftyBestRank(rng: Rng, ema: number, stars: StarCount, prestige: number): number | undefined {
  const score = ema + 4 * stars + 0.15 * prestige + rng.gaussian(0, FIFTY_BEST_NOISE_SD);
  const rank = Math.max(1, Math.round(1 + (FIFTY_BEST_TOP - score) * FIFTY_BEST_RANK_SLOPE));
  return rank <= 50 ? rank : undefined;
}

export function gaultMillauPoints(ema: number, stars: StarCount): number {
  return clamp(Math.round(((ema - 40) / 3 + stars) * 2) / 2, 0, GAULT_MILLAU_MAX);
}

export function goodFoodTier(ema: number, stars: StarCount): number {
  return clamp(Math.round((ema - 55) / 4 + stars), 0, GOOD_FOOD_MAX);
}

export function criticRating(score: number): 1 | 2 | 3 | 4 | 5 {
  const [a, b, c, d] = CRITIC_BANDS;
  return score >= a ? 5 : score >= b ? 4 : score >= c ? 3 : score >= d ? 2 : 1;
}

const CRITIC_TEXT: Record<number, string> = {
  5: "An evening of real distinction. Book now, and book again.",
  4: "Confident, generous cooking with a clear voice.",
  3: "Pleasant enough, though the kitchen plays it safe.",
  2: "Ambition outstrips execution on too many plates.",
  1: "A disappointing night. The kitchen seemed somewhere else.",
};

export interface TrackOutcome { stars: StarsState; events: StarsEvent[] }

/** Runs any track whose publication day is today (open or closed — the lists come out regardless). */
export function stepTracks(rng: Rng, s: StarsState, day: number, prestige: number): TrackOutcome {
  const events: StarsEvent[] = [];
  let g = s.guides;
  const stars = g.michelin.stars;
  const ema = s.dailyScoreEma;
  if (day >= g.fiftyBest.nextListDay) {
    const prev = g.fiftyBest;
    const rank = prev.hallOfFame ? undefined : fiftyBestRank(rng, ema, stars, prestige);
    const bestRank = rank !== undefined && (prev.bestRank === undefined || rank < prev.bestRank) ? rank : prev.bestRank;
    const fb: StarsState["guides"]["fiftyBest"] = {
      nextListDay: nextMonthStart(day + 1, FIFTY_BEST_MONTH),
      hallOfFame: prev.hallOfFame || rank === 1,
      ...(rank !== undefined ? { rank } : {}),
      ...(bestRank !== undefined ? { bestRank } : {}),
    };
    g = { ...g, fiftyBest: fb };
    events.push({ type: "FIFTY_BEST", day, ...(rank !== undefined ? { rank } : {}), ...(prev.rank !== undefined ? { before: prev.rank } : {}), hallOfFame: fb.hallOfFame });
  }
  if (day >= g.gaultMillau.nextDay) {
    const before = g.gaultMillau.points;
    const points = gaultMillauPoints(ema, stars);
    g = { ...g, gaultMillau: { points, nextDay: nextMonthStart(day + 1, GAULT_MILLAU_MONTH) } };
    events.push({ type: "GAULT_MILLAU", day, points, before });
  }
  if (day >= g.goodFood.nextDay) {
    const before = g.goodFood.tier;
    const tier = goodFoodTier(ema, stars);
    g = { ...g, goodFood: { tier, nextDay: nextMonthStart(day + 1, GOOD_FOOD_MONTH) } };
    events.push({ type: "GOOD_FOOD", day, tier, before });
  }
  return { stars: { ...s, guides: g }, events };
}

/** The local critic eats on an open day at or after `nextVisit` (a closed day postpones them to the next open day). */
export function criticVisit(rng: Rng, s: StarsState, day: number, todayScore: number): TrackOutcome {
  const lc = s.guides.localCritic;
  const rating = criticRating(todayScore + rng.gaussian(0, CRITIC_NOISE_SD));
  const review: Review = { day, critic: rng.pick(CRITIC_NAMES), rating, text: CRITIC_TEXT[rating]! };
  const foot = CRITIC_FOOTFALL[rating];
  const ledger = {
    ...s.ledger,
    pendingPrestige: s.ledger.pendingPrestige + (rating - 3) * CRITIC_PRESTIGE_PER_STAR,
    pendingFootfall: foot ? [...s.ledger.pendingFootfall, foot] : s.ledger.pendingFootfall,
  };
  const next = day + rng.int(CRITIC_INTERVAL[0], CRITIC_INTERVAL[1]);
  return {
    stars: { ...s, ledger, guides: { ...s.guides, localCritic: { lastReview: review, nextVisit: next, reviews: [...lc.reviews, review].slice(-12) } } },
    events: [{ type: "CRITIC_REVIEW", review }],
  };
}

/** The prestige level all the tracks together point at (0-100); the game's prestige is pulled toward it daily. */
export function prestigeTarget(s: StarsState): number {
  const g = s.guides;
  const fb = g.fiftyBest.hallOfFame ? PRESTIGE_TARGET.fiftyBestMax : g.fiftyBest.rank !== undefined ? (PRESTIGE_TARGET.fiftyBestMax * (51 - g.fiftyBest.rank)) / 50 : 0;
  const rivalDrag = s.rival && s.rival.stars >= g.michelin.stars && s.rival.stars > 0 ? 5 : 0;
  return r2(
    clamp(
      PRESTIGE_TARGET.base + PRESTIGE_TARGET.perStar * g.michelin.stars + PRESTIGE_TARGET.perGmPoint * g.gaultMillau.points + PRESTIGE_TARGET.perGoodFoodTier * g.goodFood.tier + fb - rivalDrag,
      0,
      100,
    ),
  );
}
