/**
 * Round 9: the hands-on onboarding's "seen" flags, mirrored to the player's account with the settings (prefsSync.ts).
 * Kept apart from onboarding.ts (the step texts, in the hands-on chunk) so the main chunk only carries this.
 */
import type { HandsOnRole } from "@full-plate/handson";

const PREFIX = "full-plate:onboard:v1:";
export const onboardKey = (seed: number, role: HandsOnRole): string => `${PREFIX}${role}:${seed}`;

/** Flags the account says were seen (on another device, or before localStorage was cleared). */
const accountSeen = new Set<string>();
/** Flags seen this visit (read by the mirror when localStorage is blocked). */
const seenHere = new Set<string>();
let markHook: (() => void) | null = null;

export const accountHas = (k: string): boolean => accountSeen.has(k);
export function onOnboardMark(fn: (() => void) | null): void { markHook = fn; }
export function noteMarked(k: string): void { if (markHook) { seenHere.add(k); markHook(); } }

/** Every flag this device knows (the account's, localStorage keys, then this visit's: newest last, for the account's cap). */
export function knownOnboardKeys(): string[] {
  const out = new Set<string>(accountSeen);
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k?.startsWith(PREFIX) && ls.getItem(k) === "1") out.add(k); }
  } catch { /* blocked */ }
  for (const k of seenHere) { out.delete(k); out.add(k); }
  return [...out];
}

/** Round 11 (S5): the flags cached here were another account's: forget them (this account's arrive with its prefs). */
export function forgetOnboardKeys(): void {
  accountSeen.clear(); seenHere.clear();
  try {
    const ls = window.localStorage, mine: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k?.startsWith(PREFIX)) mine.push(k); }
    for (const k of mine) ls.removeItem(k);
  } catch { /* blocked */ }
}

/** Flags from the account: remembered for this visit and cached in localStorage. */
export function adoptOnboardKeys(keys: readonly string[]): void {
  for (const k of keys) {
    if (typeof k !== "string" || !k.startsWith(PREFIX)) continue;
    accountSeen.add(k);
    try { window.localStorage.setItem(k, "1"); } catch { /* blocked */ }
  }
}
