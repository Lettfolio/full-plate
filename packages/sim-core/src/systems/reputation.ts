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
};

export function reviewText(content: ContentPack, state: GameState, rng: Rng, rating: number, dishId?: string, segmentId?: string): string {
  const pool = content.reviewTemplates?.[String(rating)] ?? FALLBACK_TEMPLATES[String(rating)] ?? ["…"];
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
  for (const p of rng.shuffle(tally.paid).slice(0, count)) {
    reviews.push({
      day: state.day,
      source: rng.weighted(sources, weights) ?? "online",
      rating: p.rating,
      text: reviewText(content, state, rng, p.rating, p.dishId, p.segment),
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

export function nextPopularity(content: ContentPack, rep: Reputation, meanRating: number | undefined, walkoutParties: number): number {
  let p = rep.popularity;
  if (meanRating !== undefined) p += (meanRating * RATING_TO_POPULARITY - p) * POPULARITY_PULL;
  p -= Math.min(WALKOUT_POPULARITY_HIT_CAP, walkoutParties * WALKOUT_POPULARITY_HIT);
  return round2(clamp(decayToward(p, content.balance.reputationDecay), 0, 100));
}

export function nextPrestige(content: ContentPack, rep: Reputation, reviews: readonly Review[]): number {
  let p = rep.prestige;
  for (const r of reviews) {
    if (r.rating >= PRESTIGE_GOOD_MIN_RATING && (r.quality ?? 0) >= PRESTIGE_GOOD_MIN_QUALITY) p += PRESTIGE_GOOD_REVIEW;
    else if (r.rating <= PRESTIGE_BAD_MAX_RATING) p -= PRESTIGE_BAD_REVIEW;
  }
  return round2(clamp(decayToward(p, content.balance.reputationDecay), 0, 100));
}

export function reputationSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  const tally = tallyOf(state);
  const covers = state.todays.covers ?? 0;
  const reviews = writeReviews(content, state, rng, tally, covers);
  const meanRating = tally.ratedCovers > 0 ? tally.ratingSum / tally.ratedCovers : undefined;
  const reputation: Reputation = {
    popularity: nextPopularity(content, state.reputation, meanRating, tally.walkoutParties),
    prestige: nextPrestige(content, state.reputation, reviews),
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
