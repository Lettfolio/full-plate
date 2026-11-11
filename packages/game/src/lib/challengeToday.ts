/**
 * Round 14 (D): the small, sim-free part of the daily challenge — which day it is, which challenge that day has, and the
 * player's bests. The title screen reads it (today's challenge's name and her best) without fetching the challenge's
 * lazy chunk; `lib/challenge.ts` builds on it and re-exports it.
 */
import { prefsStorage } from "./storage";

export type TemplateId = "rescue" | "rush" | "inspector" | "walkout" | "rival" | "festival";
export const TEMPLATE_ORDER: readonly TemplateId[] = ["rescue", "rush", "inspector", "walkout", "rival", "festival"];
export const TEMPLATE_TITLES: Record<TemplateId, string> = {
  rescue: "Rescue the café",
  rush: "Rush week",
  inspector: "Inspector due",
  walkout: "Staff walked out",
  rival: "New rival opened",
  festival: "Festival weekend",
};
/** Round 14: the scenarios changed (library pack, footfall, scoring); runs, bests and score codes carry this. */
export const CHALLENGE_VERSION = 2;
/** The highest score a code can carry (17 bits). */
export const MAX_SCORE = 0x1ffff;

// ── dates ──
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Days since 1970-01-01 (UTC) for a YYYY-MM-DD key. */
export function dayNumber(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / 86_400_000);
}
export const dateOfDayNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * Today's challenge date (UTC, so a family in one house shares it). Dev builds take `?challengeDate=YYYY-MM-DD` for
 * tests; the shipped game ignores it, so yesterday's and tomorrow's challenges can't be played.
 */
export function todayKey(now: Date = new Date(), search: string = typeof location !== "undefined" ? location.search : ""): string {
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(search).get("challengeDate");
    if (forced && DATE_RE.test(forced)) return forced;
  }
  return now.toISOString().slice(0, 10);
}

/** The date's own template (the six rotate, one a day). */
export const templateForDate = (date: string): TemplateId => TEMPLATE_ORDER[((dayNumber(date) % 6) + 6) % 6]!;

// ── bests ──
/** `v`: the scenario version it was played on (absent: Round 12–13, a different scale). `fp`: its fingerprint (for its code). */
export interface Best { date: string; score: number; template: TemplateId; met: boolean; v?: number; fp?: number }
export const BEST_KEY = "full-plate:challenge:v1:best";
export const MIRROR = "full-plate:onboard:v1:challenge:";

export function readBests(): Record<string, Best> {
  try {
    const raw = JSON.parse(prefsStorage().getItem(BEST_KEY) ?? "{}") as Record<string, Best>;
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

/**
 * Every best this device knows: its own list, plus the ones mirrored through the account's prefs (onboarding-flag keys
 * `…:challenge:<date>:<score>[:<version>]`, which follow the account to other devices; prefsSync.ts).
 */
export function allBests(): Best[] {
  const out = readBests();
  try {
    const ls = prefsStorage();
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      const m = k?.startsWith(MIRROR) ? /^(\d{4}-\d{2}-\d{2}):(\d+)(?::(\d+))?$/.exec(k.slice(MIRROR.length)) : null;
      if (!m) continue;
      const date = m[1]!, score = Math.min(MAX_SCORE, +m[2]!), v = m[3] ? +m[3] : undefined;
      const have = out[date];
      const newer = (v ?? 1) > (have?.v ?? 1);
      if (!have || newer || ((v ?? 1) === (have.v ?? 1) && have.score < score)) {
        out[date] = { date, score, template: templateForDate(date), met: have?.met ?? false, ...(v ? { v } : {}) };
      }
    }
  } catch { /* blocked */ }
  return Object.values(out).filter((b) => b && typeof b.score === "number" && DATE_RE.test(b.date));
}

/** This date's best on the current scenarios (a best from before Round 14 was a different restaurant and scale). */
export const bestFor = (date: string): Best | undefined => allBests().find((b) => b.date === date && b.v === CHALLENGE_VERSION);
export const topBests = (n = 10): Best[] => [...allBests()].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, n);

/** What the title shows beside "Today's challenge": today's name, and her best today if she has one. */
export function todayLine(date: string = todayKey()): { title: string; best?: number } {
  const best = bestFor(date);
  return { title: TEMPLATE_TITLES[templateForDate(date)], ...(best ? { best: best.score } : {}) };
}
