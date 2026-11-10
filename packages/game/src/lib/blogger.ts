/**
 * Round 12 (E): Ruth Lessley of Plate Expectations, the food blogger. "Rude but fair": she eats on a day fixed by the
 * seed (first between days 8 and 12, then every 18–24 days), turns up on the floor as a named guest, and that evening
 * posts a review whose stars are the night's real average, nudged down a little (she is hard to please) and down again
 * if people walked out. Text: criticText.json `blogger`. The sim never knows she was there.
 */
import type { BloggerText } from "@full-plate/content";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { extras } from "../sim";
import { dishLabel, fill, h32, pickBy } from "./voiceKit";

export const blogger = (): BloggerText => extras.criticText.blogger!;

export const FIRST_VISIT = [8, 12] as const;
export const VISIT_GAP = [18, 24] as const;

/** Her visit days from the start up to and including `upTo`. */
export function visitDays(seed: number, upTo: number): number[] {
  const out: number[] = [];
  let d = FIRST_VISIT[0] + (h32(seed, "blogger", 0) % (FIRST_VISIT[1] - FIRST_VISIT[0] + 1));
  for (let n = 1; d <= upTo; n++) {
    out.push(d);
    d += VISIT_GAP[0] + (h32(seed, "blogger", n) % (VISIT_GAP[1] - VISIT_GAP[0] + 1));
  }
  return out;
}

export const visitsOn = (seed: number, day: number): boolean => visitDays(seed, day).at(-1) === day;

export interface BloggerReview {
  day: number;
  /** The doors were shut when she came. */
  closed: boolean;
  rating: number;
  headline: string;
  text: string;
  signoff: string;
}

/** Her stars for a night: the real average less a quarter, less half again if more than 15% (and 3+) walked out. Open but nobody served (no stock): 1. */
export function bloggerRating(d: DayResult): number {
  if (d.covers <= 0) return 1;
  const walkPenalty = d.walkouts >= 3 && d.walkouts > d.covers * 0.15 ? 0.5 : 0;
  return Math.max(1, Math.min(5, Math.round(d.averageRating - 0.25 - walkPenalty)));
}

/** Her review of `d` (a visit day). */
export function reviewOf(game: Pick<GameState, "seed" | "restaurantName">, d: DayResult): BloggerReview {
  const b = blogger();
  const signoff = pickBy(b.signoff, game.seed, "blogger:sign", d.day);
  if (d.closed) {
    const text = fill(pickBy(b.closed, game.seed, "blogger:closed", d.day), { restaurant: game.restaurantName });
    return { day: d.day, closed: true, rating: 0, headline: `${game.restaurantName}: closed`, text, signoff };
  }
  const rating = bloggerRating(d);
  const dish = dishLabel(rating >= 3 ? d.bestDish : (d.worstDish ?? d.bestDish)) ?? dishLabel(d.reviews.find((r) => r.dishId)?.dishId) ?? "food";
  const vars = { restaurant: game.restaurantName, dish };
  const k = String(rating);
  return {
    day: d.day,
    closed: false,
    rating,
    headline: fill(pickBy(b.headlines[k]!, game.seed, "blogger:head", d.day), vars),
    text: fill(pickBy(b.reviews[k]!, game.seed, "blogger:text", d.day), vars),
    signoff,
  };
}

/** The review she wrote on `day`, if that was a visit day already played. */
export function reviewOn(game: GameState, day: number): BloggerReview | undefined {
  if (!visitsOn(game.seed, day)) return undefined;
  const d = game.history.find((x) => x.day === day);
  return d ? reviewOf(game, d) : undefined;
}
