/**
 * ReputationSystem (evening) — writes reviews (≈ reviewRatePer10Covers per 10 covers, sampled
 * from paying parties), moves popularity toward the day's mean rating × 20, docks walk-outs,
 * moves prestige on good/bad reviews, and decays both toward 50.
 */
import {
  POPULARITY_PULL,
  PRESTIGE_BAD_MAX_RATING,
  PRESTIGE_BAD_REVIEW,
  PRESTIGE_GOOD_MIN_QUALITY,
  PRESTIGE_GOOD_MIN_RATING,
  PRESTIGE_GOOD_REVIEW,
  RATING_TO_POPULARITY,
  REPUTATION_NEUTRAL,
  REVIEW_SOURCE_WEIGHTS,
  WALKOUT_POPULARITY_HIT,
  WALKOUT_POPULARITY_HIT_CAP,
} from "../constants";
import { decorEffects } from "../decor";
import type { Rng } from "../rng";
import type { ContentPack, GameState, Reputation, Review, ServiceTally } from "../types";
import { clamp, findDish, findSegment, round2, tallyOf } from "../util";
import type { SystemResult } from "./system";

const FALLBACK_TEMPLATES: Record<string, string[]> = {
  "1": ["Avoid. The {dish} was a disaster.", "Never again. Waited ages and left hungry."],
  "2": ["Disappointing {dish}. Expected more from {restaurant}.", "Meh. Slow service, tired food."],
  "3": ["Decent enough. The {dish} was fine.", "Average night out — nothing special, nothing wrong."],
  "4": ["Lovely {dish}! Will be back.", "Really good meal at {restaurant}, friendly staff."],
  "5": ["Best {dish} in town. {restaurant} is a gem!", "Faultless. Book now before everyone finds out."],
  rough: ["Good {dish}, but it was chaos in here tonight.", "Our table was happy. The queue by the door wasn't."],
};

/**
 * Round 11 (U12): a night where more people walked out than were served, or the stars averaged under ROUGH_NIGHT_RATING,
 * is "rough": a 4★/5★ guest's words come from the "rough" pool ("Good pie, but it was chaos in here tonight") instead of
 * "Five stars isn't enough!". The rating is unchanged and `rng.pick` draws once either way, so the stream is the same.
 */
export const ROUGH_NIGHT_RATING = 2.5;
export function roughNight(walkouts: number, covers: number, meanRating: number | undefined): boolean {
  return walkouts > covers || (meanRating !== undefined && meanRating < ROUGH_NIGHT_RATING);
}

export function reviewText(content: ContentPack, state: GameState, rng: Rng, rating: number, dishId?: string, segmentId?: string, rough = false): string {
  const key = rough && rating >= 4 ? "rough" : String(rating);
  const pool = content.reviewTemplates?.[key] ?? FALLBACK_TEMPLATES[key] ?? ["…"];
  const dish = (dishId && findDish(content, dishId)?.name) || "food";
  const segment = (segmentId && findSegment(content, segmentId)?.name) || "guest";
  return rng
    .pick(pool)
    .replaceAll("{dish}", dish)
    .replaceAll("{restaurant}", state.restaurantName)
    .replaceAll("{segment}", segment);
}

export function writeReviews(content: ContentPack, state: GameState, rng: Rng, tally: ServiceTally, covers: number): Review[] {
  if (tally.paid.length === 0) return [];
  const count = Math.min(tally.paid.length, rng.roundStochastic((covers / 10) * content.balance.reviewRatePer10Covers));
  const sources = REVIEW_SOURCE_WEIGHTS.map((s) => s.source);
  const weights = REVIEW_SOURCE_WEIGHTS.map((s) => s.weight);
  const reviews: Review[] = [];
  const rough = roughNight(state.todays.walkouts ?? 0, covers, tally.ratedCovers > 0 ? tally.ratingSum / tally.ratedCovers : undefined);
  for (const p of rng.shuffle(tally.paid).slice(0, count)) {
    reviews.push({
      day: state.day,
      source: rng.weighted(sources, weights) ?? "online",
      rating: p.rating,
      text: reviewText(content, state, rng, p.rating, p.dishId, p.segment, rough),
      ...(p.dishId ? { dishId: p.dishId } : {}),
      quality: p.quality,
    });
  }
  return reviews;
}

/** Decays a 0-100 score toward neutral by `rate` points per day. */
export function decayToward(x: number, rate: number, target = REPUTATION_NEUTRAL): number {
  if (Math.abs(x - target) <= rate) return target;
  return x > target ? x - rate : x + rate;
}

/**
 * `lift` (round 10, decor popularity) moves where popularity settles: the pull is toward rating × 20 + lift and the
 * decay toward 50 + lift, so a room worth +2 settles 2 points higher. 0 = the old formula exactly.
 */
export function nextPopularity(content: ContentPack, rep: Reputation, meanRating: number | undefined, walkoutParties: number, lift = 0): number {
  let p = rep.popularity;
  if (meanRating !== undefined) p += (meanRating * RATING_TO_POPULARITY + lift - p) * POPULARITY_PULL;
  p -= Math.min(WALKOUT_POPULARITY_HIT_CAP, walkoutParties * WALKOUT_POPULARITY_HIT);
  return round2(clamp(decayToward(p, content.balance.reputationDecay, REPUTATION_NEUTRAL + lift), 0, 100));
}

/** `lift` (round 10, decor prestige): prestige decays toward 50 + lift instead of 50 (it settles `lift` higher). */
export function nextPrestige(content: ContentPack, rep: Reputation, reviews: readonly Review[], lift = 0): number {
  let p = rep.prestige;
  for (const r of reviews) {
    if (r.rating >= PRESTIGE_GOOD_MIN_RATING && (r.quality ?? 0) >= PRESTIGE_GOOD_MIN_QUALITY) p += PRESTIGE_GOOD_REVIEW;
    else if (r.rating <= PRESTIGE_BAD_MAX_RATING) p -= PRESTIGE_BAD_REVIEW;
  }
  return round2(clamp(decayToward(p, content.balance.reputationDecay, REPUTATION_NEUTRAL + lift), 0, 100));
}

export function reputationSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const tally = tallyOf(state);
  const covers = state.todays.covers ?? 0;
  const reviews = writeReviews(content, state, rng, tally, covers);
  const meanRating = tally.ratedCovers > 0 ? tally.ratingSum / tally.ratedCovers : undefined;
  // Incidents: critics' verdicts move prestige; turning big parties away costs a little popularity.
  const decor = decorEffects(content, state);
  const reputation: Reputation = {
    popularity: round2(clamp(nextPopularity(content, state.reputation, meanRating, tally.walkoutParties, decor.popularity) + (tally.popularityBonus ?? 0), 0, 100)),
    prestige: round2(clamp(nextPrestige(content, state.reputation, reviews, decor.prestige) + (tally.prestigeBonus ?? 0), 0, 100)),
  };
  return {
    state: {
      ...state,
      reputation,
      todays: {
        ...state.todays,
        reviews: [...state.todays.reviews, ...reviews],
        averageRating: meanRating === undefined ? 0 : round2(meanRating),
        popularityDelta: round2(reputation.popularity - state.reputation.popularity),
        prestigeDelta: round2(reputation.prestige - state.reputation.prestige),
      },
    },
    events: [],
  };
}
