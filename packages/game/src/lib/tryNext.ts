import { useSyncExternalStore } from "react";
import type { GameState } from "@full-plate/sim-core";
import { prefsStorage } from "./storage";

/**
 * Round 14 (E, discoverability): "New thing to try" — one card on the planning screen pointing at one thing the game
 * has that she hasn't found (the R14 review measured brand kit 3.1 screens down, invent a dish 1.9, today's challenge
 * four taps away via Settings, and nothing on screen pointing to most of them).
 *
 * Rules (so it never nags): never before Day 2; at most one item a day (once a day has shown an item, that day shows
 * that item or nothing — dismissing it doesn't bring on the next); an item dismissed or used is gone for good on this
 * device; Settings › "New things to try" turns the card off. Preferences, not the save: `full-plate:try-next:v1`
 * through lib/storage (memory only when storage is blocked).
 */
export type TryId = "cook" | "brand" | "invent" | "challenge" | "postcard" | "regulars" | "rival" | "share";

export interface TryFacts {
  /** 0-based sim day (Day 2 = 1). */
  day: number;
  /** Dishes on today's menu (the hands-on shortcut opens service). */
  activeDishes: number;
  /** A night with a profit has happened. */
  profitableNight: boolean;
  /** A regular has joined. */
  regularJoined: boolean;
  /** The rival has posted (the Restaurant tab's "Across the road"). */
  rivalPosted: boolean;
  /** Sharing works here (claude.ai's db is reachable and signed in). */
  canShare: boolean;
}

/** In the order she meets them. `due` says whether the item is on offer yet. */
export const TRY_ITEMS: readonly { id: TryId; due: (f: TryFacts) => boolean }[] = [
  { id: "cook", due: (f) => f.day >= 1 && f.activeDishes > 0 },
  { id: "brand", due: (f) => f.day >= 1 },
  { id: "invent", due: (f) => f.day >= 2 },
  { id: "challenge", due: (f) => f.day >= 2 },
  { id: "postcard", due: (f) => f.day >= 1 && f.profitableNight },
  { id: "regulars", due: (f) => f.day >= 1 && f.regularJoined },
  { id: "rival", due: (f) => f.day >= 1 && f.rivalPosted },
  { id: "share", due: (f) => f.day >= 4 && f.canShare },
];

export interface TryState {
  off: boolean;
  dismissed: TryId[];
  /** The day that last showed an item: which game (seed) and day, and the item. */
  today?: { key: string; id: TryId | null };
}

export const TRY_KEY = "full-plate:try-next:v1";
const IDS = new Set<string>(TRY_ITEMS.map((i) => i.id));

export function readTry(): TryState {
  try {
    const raw = prefsStorage().getItem(TRY_KEY);
    if (!raw) return { off: false, dismissed: [] };
    const p = JSON.parse(raw) as Partial<TryState>;
    const dismissed = Array.isArray(p.dismissed) ? p.dismissed.filter((x): x is TryId => typeof x === "string" && IDS.has(x)) : [];
    const t = p.today;
    const today = t && typeof t.key === "string" && (t.id === null || (typeof t.id === "string" && IDS.has(t.id))) ? { key: t.key, id: t.id as TryId | null } : undefined;
    return { off: p.off === true, dismissed, ...(today ? { today } : {}) };
  } catch { return { off: false, dismissed: [] }; }
}

let current: TryState | null = null;
const subs = new Set<() => void>();
function state(): TryState { return (current ??= readTry()); }
function write(next: TryState): void {
  current = next;
  try { prefsStorage().setItem(TRY_KEY, JSON.stringify(next)); } catch { /* full: memory for this visit */ }
  for (const f of subs) f();
}
/** For tests. */
export function resetTryCache(): void { current = null; }

export function useTryState(): TryState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, state, state);
}
export function setTryOff(off: boolean): void { write({ ...state(), off }); }
export function dismissTry(id: TryId): void {
  const s = state();
  if (!s.dismissed.includes(id)) write({ ...s, dismissed: [...s.dismissed, id] });
}

/**
 * Today's item (or null). Pure: given the stored state and today's facts, returns the item to show and the state to
 * store (the day's pick is remembered so it stays the same item all day, and a dismissed one isn't replaced).
 */
export function pickTry(s: TryState, key: string, f: TryFacts): { id: TryId | null; next: TryState } {
  if (s.off || f.day < 1) return { id: null, next: s };
  if (s.today?.key === key) {
    const id = s.today.id && !s.dismissed.includes(s.today.id) ? s.today.id : null;
    return { id, next: s };
  }
  const item = TRY_ITEMS.find((i) => !s.dismissed.includes(i.id) && i.due(f));
  if (!item) return { id: null, next: s }; // nothing due: don't use up the day
  return { id: item.id, next: { ...s, today: { key, id: item.id } } };
}

/** The day key: this game (seed + name) and its day. */
export const tryKey = (game: Pick<GameState, "seed" | "restaurantName" | "day">): string => `${game.seed}:${game.restaurantName}:${game.day}`;

/** Remembers today's pick (called by the card once it shows). */
export function noteTryShown(key: string, id: TryId): void {
  const s = state();
  if (s.today?.key !== key) write({ ...s, today: { key, id } });
}
