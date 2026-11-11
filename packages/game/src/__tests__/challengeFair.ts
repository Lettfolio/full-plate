/**
 * Round 14 (D): the daily challenge's fairness sweep, shared by the six round14.challengeFair.<template>.test.ts files
 * (one per template, so vitest runs them side by side). For each of FP_CHALLENGE_DATES consecutive dates (90 by
 * default) the template is built and played by every script in challengePlayers.ts:
 *   (a) five Skips (doing nothing) misses the goal on every date — U8;
 *   (b) each degenerate script (prices at the cap or ×3, never restock, fire everyone, shut all five days, fire and
 *       borrow) scores below the best honest script on every date — G6;
 *   (c) at least one honest script (typical, balanced, or the simple best effort that fixes the stated problem) meets
 *       the goal on every date — G2's "no goal-meeting play found";
 *   (d) the best script stays under half the scenario's ceiling (`ceilingOf`), so a player has room above it.
 */
import { expect } from "vitest";
import { buildChallenge, ceilingOf, dateOfDayNumber, dayNumber, scoreOf, type TemplateId } from "../lib/challenge";
import { bestEffort, DEGENERATE, HONEST, NOTHING } from "./challengePlayers";

export const FAIR_START = "2026-11-11";
export const FAIR_DATES = Number(process.env.FP_CHALLENGE_DATES ?? 90);
/** (d): the best script's share of the ceiling. */
export const HEADROOM = 0.5;

export interface FairRow { date: string; target: number; nothing: number; honest: number; met: string; deg: Record<string, number>; share: number }

export async function sweep(template: TemplateId, n = FAIR_DATES, start = FAIR_START): Promise<FairRow[]> {
  const rows: FairRow[] = [];
  const bad: string[] = [];
  for (let i = 0; i < n; i++) {
    const date = dateOfDayNumber(dayNumber(start) + i);
    const b = await buildChallenge(date, undefined, async () => {}, { template });
    const c = b.meta.challenge!;
    const nothing = scoreOf(NOTHING(b), c);
    const honest: Record<string, ReturnType<typeof scoreOf>> = {};
    for (const [k, p] of Object.entries(HONEST)) honest[k] = scoreOf(p(b), c);
    const be = bestEffort(b);
    const top = Math.max(be.score.total, ...Object.values(honest).map((s) => s.total));
    const met = [...Object.entries(honest).filter(([, s]) => s.goal.met).map(([k]) => k), ...(be.met ? [`best(${be.knobs})`] : [])].join(",");
    const deg: Record<string, number> = {};
    for (const [k, p] of Object.entries(DEGENERATE)) deg[k] = scoreOf(p(b), c).total;
    rows.push({ date, target: c.target, nothing: nothing.goal.met ? -nothing.total : nothing.total, honest: top, met, deg, share: top / ceilingOf(c) });
    // (a) five Skips miss; (b) no degenerate script reaches the best honest one; (c) an honest script meets; (d) headroom.
    if (nothing.goal.met) bad.push(`${date}: five Skips met the goal`);
    for (const [k, v] of Object.entries(deg)) if (v >= top) bad.push(`${date}: ${k} ${v} ≥ honest ${top}`);
    if (!met) bad.push(`${date}: no honest script met the goal (best ${be.score.goal.now})`);
    if (top / ceilingOf(c) >= HEADROOM) bad.push(`${date}: the best script is at ${Math.round((top / ceilingOf(c)) * 100)}% of the ceiling`);
  }
  expect(bad, `${template}`).toEqual([]);
  return rows;
}

/** One line per template for the log: how often each honest script met, the worst degenerate margin, the headroom. */
export function summary(template: TemplateId, rows: readonly FairRow[]): string {
  const margin = Math.min(...rows.map((r) => r.honest - Math.max(...Object.values(r.deg))));
  const share = Math.max(...rows.map((r) => r.share));
  const typical = rows.filter((r) => r.met.split(",").includes("typical")).length;
  return `${template}: ${rows.length} dates · typical meets ${typical} · smallest honest-over-degenerate margin ${margin} · best script at most ${Math.round(share * 100)}% of the ceiling`;
}
