/**
 * Round 12 (E): shared pieces for the game's voices (gossip, rival, blogger, regulars). Everything here is a pure
 * function of the seed, a day number and the sim's own results (history, log, staff), so the same save always says
 * the same thing — on a reload, on another device, in a test. Nothing here is stored and the sim never sees it.
 *
 * Lives in the lazy "voices" chunk with its data (@full-plate/content/voices): never import it from main-chunk code.
 */
import type { DayResult, GameState } from "@full-plate/sim-core";
import { voices } from "@full-plate/content/voices";
import { content } from "../sim";
import { weekdayIndex, WEEKDAY_NAMES } from "./calendar";

export { voices };

/** FNV-1a over a key: the same key always gives the same 32-bit number. */
export function h32(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickBy<T>(xs: readonly T[], ...key: (string | number)[]): T {
  return xs[h32(...key) % xs.length]!;
}

/** Fills {placeholders}; unknown ones are left as they are. */
export function fill(t: string, vars: Record<string, string | number | undefined>): string {
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

export const dishLabel = (id: string | undefined): string | undefined => (id ? content.dishes.find((d) => d.id === id)?.name : undefined);
export const weekdayName = (day: number): string => WEEKDAY_NAMES[weekdayIndex(day)]!;
export const districtName = (id: string): string => content.districts.find((d) => d.id === id)?.name ?? "the high street";
export const station = (districtId: string): string => voices.gossip.stations[districtId] ?? "Local Radio";

/** A day the doors were open and somebody ate. */
export const wasOpen = (d: DayResult | undefined): d is DayResult => !!d && !d.closed && d.covers > 0;

/** The history keyed by day. */
export function byDay(history: readonly DayResult[]): Map<number, DayResult> {
  return new Map(history.map((d) => [d.day, d]));
}

/** The game as the evening sees it: the night just played is in the history even when the reducer hasn't put it there. */
export function withResult(game: GameState, r: DayResult | null | undefined): GameState {
  if (!r || game.history.some((d) => d.day === r.day)) return game;
  return { ...game, history: [...game.history, r] };
}

/** Did this dish sell on that day? (Old saves without per-dish lines: a review or the best dish names it.) */
export function sold(d: DayResult, dishId: string): boolean {
  if (d.perDish) return (d.perDish[dishId]?.sold ?? 0) > 0;
  return d.bestDish === dishId || d.reviews.some((r) => r.dishId === dishId);
}

/** Mean guests over the open days among the `n` before `day`. */
export function meanCovers(history: readonly DayResult[], day: number, n = 7): number | undefined {
  const xs = history.filter((d) => d.day < day && d.day >= day - n && wasOpen(d));
  return xs.length ? xs.reduce((a, d) => a + d.covers, 0) / xs.length : undefined;
}

/** Monday of the week holding `day` (weeks follow the calendar, Monday to Sunday). */
export const weekStart = (day: number): number => day - weekdayIndex(day);
