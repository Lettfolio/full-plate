/**
 * Round 7 (C): pure selectors for the Stars hero. They read the player's own kitchen record (the consistency window
 * sim-stars keeps for the steadiness bar), never the inspectors' secrets.
 */
export type NightTone = "steady" | "wobbly" | "off";
export interface NightCell { day: number | undefined; quality: number; tone: NightTone }
export interface NightStrip { cells: NightCell[]; mean: number; steady: number; wobbly: number; off: number }

/**
 * The last `size` nights as cells. "off" is the sim's own off night (more than `drop` points below the window's mean,
 * which counts against steadiness); "wobbly" is more than half that; the rest are steady.
 */
export function nightStrip(window: readonly number[], days: readonly number[] | undefined, drop: number, size = 60): NightStrip {
  const n = window.length;
  const mean = n ? window.reduce((a, b) => a + b, 0) / n : 0;
  const from = Math.max(0, n - size);
  const cells: NightCell[] = [];
  for (let i = from; i < n; i++) {
    const q = window[i]!;
    const tone: NightTone = q < mean - drop ? "off" : q < mean - drop / 2 ? "wobbly" : "steady";
    cells.push({ day: days && days.length === n ? days[i] : undefined, quality: q, tone });
  }
  const count = (t: NightTone) => cells.filter((c) => c.tone === t).length;
  return { cells, mean, steady: count("steady"), wobbly: count("wobbly"), off: count("off") };
}

/** Where today sits between the last guide day (or the fork) and the next one, and where inspection season starts. */
export function guideYear(today: number, nextGuideDay: number, lastGuideDay: number | undefined, seasonDays: number) {
  const start = Math.min(today, lastGuideDay ?? nextGuideDay - 365);
  const span = Math.max(1, nextGuideDay - start);
  const at = (d: number) => Math.min(100, Math.max(0, ((d - start) / span) * 100));
  return { todayPct: at(today), seasonPct: at(nextGuideDay - seasonDays), inSeason: today >= nextGuideDay - seasonDays && today < nextGuideDay };
}
