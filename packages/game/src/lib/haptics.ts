/**
 * Round 13 (C): a short buzz on a phone that can (`navigator.vibrate`; Android browsers — iPhone Safari has none, so
 * nothing happens there). Only with Settings › Sound and Settings › Buzz both on. Never throws.
 */
import { getSettings } from "./settings";

type Nav = { vibrate?: (p: number | number[]) => boolean };
const nav = (): Nav | undefined => (typeof navigator === "undefined" ? undefined : (navigator as unknown as Nav));

/** This browser can vibrate (Settings shows the switch only then). */
export const canBuzz = (): boolean => typeof nav()?.vibrate === "function";

/** Kept short: a tap (USE), a plate out, a slip. */
export const BUZZ = { tap: 8, done: 18, oops: [24, 40, 24] } as const;

export function buzz(pattern: number | readonly number[]): boolean {
  const s = getSettings();
  if (!s.sound || !s.haptics || !canBuzz()) return false;
  try { return nav()!.vibrate!(typeof pattern === "number" ? pattern : [...pattern]); } catch { return false; }
}
