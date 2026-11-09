/**
 * Round 5: the commis station in sim time (REVIEW R4 P1, "a commis shift costs ~15% of covers"). Over 10 seeds a
 * half-speed child's played shift serves ≥ 95% of a day off's covers with ≤ 2 extra walked-out covers a shift, and
 * so does a full-speed one. `PARITY_SEEDS=30` prints a wider table.
 */
import { describe, expect, it } from "vitest";
import { serialize } from "@full-plate/sim-core";
import { careerChefStart, parityRun, playBotShift, type BotSpec, type ParityRow } from "./handsOnHarness";

const seeds = Array.from({ length: Number(process.env.PARITY_SEEDS ?? 10) }, (_, i) => i + 1);
const mean = (rows: ParityRow[], f: (r: ParityRow) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;

function check(bot: BotSpec, label: string) {
  const rows = parityRun(seeds, bot);
  const skipCovers = mean(rows, (r) => r.skip.covers);
  const playedCovers = mean(rows, (r) => r.played.covers);
  const extraWalkouts = mean(rows, (r) => r.played.walkouts - r.skip.walkouts);
  console.log(`${label}: day off ${skipCovers.toFixed(1)} covers / ${mean(rows, (r) => r.skip.walkouts).toFixed(1)} walked out; played ${playedCovers.toFixed(1)} / ${mean(rows, (r) => r.played.walkouts).toFixed(1)} (${((playedCovers / skipCovers) * 100).toFixed(1)}%), own plates ${mean(rows, (r) => r.played.plates).toFixed(1)}, sent by the sous chef ${mean(rows, (r) => r.played.covered).toFixed(1)}, ${mean(rows, (r) => r.played.seconds).toFixed(0)} s`);
  expect(playedCovers / skipCovers).toBeGreaterThanOrEqual(0.95);
  expect(extraWalkouts).toBeLessThanOrEqual(2);
  return rows;
}

describe("playing never costs the restaurant (round 5)", () => {
  it("a half-speed child (skill 0.55, pace 0.5)", () => {
    const rows = check({ skill: 0.55, pace: 0.5 }, "half speed");
    expect(mean(rows, (r) => r.played.plates)).toBeGreaterThanOrEqual(7); // and still cooks plenty of her own
  }, 300_000);

  it("a full-speed bot (skill 0.55) and a child who never touches the controls", () => {
    check({ skill: 0.55, pace: 1 }, "full speed");
    check({ idle: true }, "idle");
  }, 300_000);

  it("is deterministic: the same seed played twice is byte-identical", () => {
    const a = playBotShift(careerChefStart(3), { skill: 0.55, pace: 0.5 });
    const b = playBotShift(careerChefStart(3), { skill: 0.55, pace: 0.5 });
    expect(serialize(b.app.game!)).toBe(serialize(a.app.game!));
    expect(b.summary).toEqual(a.summary);
  }, 120_000);
});
