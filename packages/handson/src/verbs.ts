/**
 * Verb tuning and the pure judging functions behind each timing action. Kept separate from the session state
 * machine so the mappings are easy to read, tune and test. All return 0..1 unless noted.
 */
import type { CookMethod } from "./types";

export const TUNING = {
  /** Movement, tiles per second (and per second² for acceleration). */
  walkSpeed: 4.6,
  accel: 32,
  decel: 40,
  /** How close (tiles, from the player's centre to a station's edge) counts as "at" it. */
  reach: 0.95,
  grabSecs: 0.5,
  chopSecs: 2.0,
  chopMarks: [0.28, 0.52, 0.76] as readonly number[],
  chopJitter: 0.04,
  /** ± cursor distance that counts as a hit. */
  chopWindow: 0.07,
  /** Seconds for the needle to sweep 0 → 1 while E is held, per method. */
  cookSecs: { stove: 2.4, oven: 2.8, fryer: 2.0 } as Record<"stove" | "oven" | "fryer", number>,
  /** Half-width of the green band, per method (a slightly wider band in the oven, tighter in the fryer). */
  cookHalfBand: { stove: 0.085, oven: 0.095, fryer: 0.075 } as Record<"stove" | "oven" | "fryer", number>,
  cookBandCentre: [0.62, 0.74] as const,
  /** Releasing before this many seconds is treated as a slip of the finger: nothing happens. */
  holdGrace: 0.12,
  plateSecs: 1.0,
  pickupSecs: 0.5,
  serveSecs: 0.8,
  clearTaps: 3,
  dropoffSecs: 0.4,
  paymentSecs: 1.2,
  pourSecs: 1.8,
  pourLine: [0.7, 0.86] as const,
  /** Prep counts for 35% of a cooked plate; the cook for 65%. Cold dishes are all prep. */
  prepWeight: 0.35,
  /**
   * Wobble added by a full-speed bump while carrying plates (base + per plate beyond the first); 1 drops the lot.
   * One bump with three plates drops them; with one plate it takes three bumps in quick succession.
   */
  wobbleBase: 0.45,
  wobblePerPlate: 0.28,
  wobbleDecay: 0.45,
  /** Bumps slower than this (tiles/s into the obstacle) don't wobble the stack. */
  bumpSpeed: 2.4,
  binConfirmSecs: 1.6,
  /** Fallback food cost of a dropped plate when the dish's cost is unknown (pence). */
  fallbackCost: 150,
} as const;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Cook quality from where the needle stopped. Inside the green band: 0.9 at the edge → 1.0 dead centre. Under:
 * falls gently (pale but edible). Over: falls faster (burnt tastes worse than pale). The floor is soft — a plate is
 * never worthless — and a needle that hits the end (left on too long) is "burnt" at 0.25.
 */
export function cookQuality(needle: number, band: readonly [number, number]): { quality: number; result: "perfect" | "under" | "over" | "burnt" } {
  const [lo, hi] = band;
  if (needle >= 1) return { quality: 0.25, result: "burnt" };
  if (needle >= lo && needle <= hi) {
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2 || 1;
    return { quality: r4(0.9 + 0.1 * (1 - Math.min(1, Math.abs(needle - mid) / half))), result: "perfect" };
  }
  if (needle < lo) return { quality: r4(Math.max(0.35, 0.9 - (lo - needle) * 1.6)), result: "under" };
  return { quality: r4(Math.max(0.25, 0.9 - (needle - hi) * 2.4)), result: "over" };
}

/** One chop: 1 for dead on, 0.7 at the edge of the window, 0 outside it. */
export function chopHit(cursor: number, mark: number, window: number = TUNING.chopWindow): number {
  const err = Math.abs(cursor - mark);
  if (err > window + 1e-9) return 0;
  return r4(1 - 0.3 * Math.min(1, err / window));
}

/** Pour quality: 1 on the line, −4 per unit of fill away from it, floor 0.3. Overflow (≥ 1) is handled as a spill. */
export function pourQuality(level: number, line: number): number {
  return Math.max(0.3, 1 - Math.abs(level - line) * 4);
}

/** Plate execution 0..1 from the prep and cook scores. */
export function plateExecution(method: CookMethod, prep: number, cook: number): number {
  if (method === "none" || method === "pour") return clamp01(prep);
  return clamp01(TUNING.prepWeight * prep + (1 - TUNING.prepWeight) * cook);
}

/**
 * Speed bonus for a chef: full marks for a plate up within 30 s of the ticket landing, nothing after 90 s.
 * (One sim tick ≈ 1.5 s in the 3-minute demo shift, so 30 s ≈ 20 ticks ≈ 1h40 of service — generous on purpose.)
 */
export function chefSpeedBonus(ageSecs: number): number {
  return clamp01(1 - (ageSecs - 30) / 60);
}

/** Speed bonus for a server: full marks within 8 s of the plate hitting the pass, nothing after 40 s. */
export function serveSpeedBonus(waitSecs: number): number {
  return clamp01(1 - (waitSecs - 8) / 32);
}

/** Points table for the shift score. */
export const POINTS = {
  platePerQuality: 0.6, // × quality (0-100) → up to 60
  plateSpeed: 30,       // × speed bonus
  serve: 30,
  serveSpeed: 20,
  clear: 15,
  payment: 20,
  drop: -25,
} as const;

export function cookBand(centre: number, method: "stove" | "oven" | "fryer"): [number, number] {
  const h = TUNING.cookHalfBand[method];
  return [centre - h, centre + h];
}
