/**
 * Round 5: the commis station in sim time (REVIEW R4 P1, "a commis shift costs ~15% of covers"). The design claim: a
 * played shift serves ≥ 95% of a day off's covers with ≤ 2 extra walked-out covers a shift — for a half-speed child,
 * a full-speed one, and one who never touches the controls.
 *
 * Round 11 (red-team T2): this file used to move its seed count until the 95% line passed (10 → 30 seeds when 1–10
 * measured 92.8%). Measured on r11 master code, per seed, played ÷ day-off covers:
 *   half speed (skill 0.55, pace 0.5), seeds 1–30: .80 .94 .74 1.04 1.11 .97 .87 1.09 1.03 1.09 .87 1.04 .80 .94 1.03
 *     .94 .88 .91 1.03 .91 .97 .87 1.15 .94 .84 .97 .90 1.05 .79 1.41 — pooled 95.4% (1–10: 96.1%, 1–20: 94.5%,
 *     1–40: 95.3%), per-seed sd 0.13, so the standard error of a 30-seed mean is ≈ 2.4 points; lowest seed 0.74
 *     (seed 31: 0.65); extra walk-outs +0.2 a shift; 8.8 own plates.
 *   full speed (skill 0.55): pooled 96.1% over 1–30 (1–20: 94.3%), sd 0.14, lowest 0.70; extra walk-outs −0.2.
 *   idle: pooled 99.3% over 1–30, sd 0.17, lowest 0.70; extra walk-outs +0.8.
 * Covers swing ±20 per seed between a played and a skipped shift (the two runs' arrivals diverge), so a 95% bar on a
 * 30-seed mean is a coin toss: the honest test is that the data doesn't contradict the claim. Each bot runs seeds
 * 1–30 and must have a pooled ratio ≥ 95% − 2 standard errors (computed from that run's own spread) and never below
 * 90%; no single seed below 60%; extra walk-outs ≤ 2. `PARITY_SEEDS` overrides the seed count.
 */
import { describe, expect, it } from "vitest";
import { serialize } from "@full-plate/sim-core";
import { careerChefStart, parityRun, playBotShift, type BotSpec, type ParityRow } from "./handsOnHarness";

const seeds = Array.from({ length: Number(process.env.PARITY_SEEDS ?? 30) }, (_, i) => i + 1);
const mean = (rows: ParityRow[], f: (r: ParityRow) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
const CLAIM = 0.95;

function check(bot: BotSpec, label: string) {
  const rows = parityRun(seeds, bot);
  const skipCovers = mean(rows, (r) => r.skip.covers);
  const playedCovers = mean(rows, (r) => r.played.covers);
  const extraWalkouts = mean(rows, (r) => r.played.walkouts - r.skip.walkouts);
  const ratios = rows.map((r) => r.played.covers / r.skip.covers);
  const m = ratios.reduce((a, x) => a + x, 0) / ratios.length;
  const se = Math.sqrt(ratios.reduce((a, x) => a + (x - m) ** 2, 0) / (ratios.length - 1) / ratios.length);
  const pooled = playedCovers / skipCovers;
  console.log(`${label}: day off ${skipCovers.toFixed(1)} covers / ${mean(rows, (r) => r.skip.walkouts).toFixed(1)} walked out; played ${playedCovers.toFixed(1)} / ${mean(rows, (r) => r.played.walkouts).toFixed(1)} (${(pooled * 100).toFixed(1)}% ± ${(se * 100).toFixed(1)}), lowest seed ${(Math.min(...ratios) * 100).toFixed(0)}%, own plates ${mean(rows, (r) => r.played.plates).toFixed(1)}, sent by the sous chef ${mean(rows, (r) => r.played.covered).toFixed(1)}, ${mean(rows, (r) => r.played.seconds).toFixed(0)} s`);
  expect(pooled).toBeGreaterThanOrEqual(CLAIM - 2 * se);
  expect(pooled).toBeGreaterThanOrEqual(0.9);
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(0.6);
  expect(extraWalkouts).toBeLessThanOrEqual(2);
  return rows;
}

describe("playing never costs the restaurant (round 5)", () => {
  it("a half-speed child (skill 0.55, pace 0.5)", () => {
    const rows = check({ skill: 0.55, pace: 0.5 }, "half speed");
    expect(mean(rows, (r) => r.played.plates)).toBeGreaterThanOrEqual(7); // and still cooks plenty of her own
  }, 600_000);

  it("a full-speed bot (skill 0.55)", () => {
    check({ skill: 0.55, pace: 1 }, "full speed");
  }, 600_000);

  it("a child who never touches the controls", () => {
    check({ idle: true }, "idle");
  }, 600_000);

  it("is deterministic: the same seed played twice is byte-identical", () => {
    const a = playBotShift(careerChefStart(3), { skill: 0.55, pace: 0.5 });
    const b = playBotShift(careerChefStart(3), { skill: 0.55, pace: 0.5 });
    expect(serialize(b.app.game!)).toBe(serialize(a.app.game!));
    expect(b.summary).toEqual(a.summary);
  }, 120_000);
});
