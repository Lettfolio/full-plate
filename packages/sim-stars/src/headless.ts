/**
 * Headless Stars run: a scripted, quality-focused restaurant on the real content pack (see script.ts).
 *
 *   pnpm --filter @full-plate/sim-stars headless [--years 6] [--seed 1] [--seeds 1] [--refit-year 0] [--profile stars|bistro] [--quiet]
 *                                                [--fork-day 365 --year1 typical|balanced|premium|cheap]
 *
 * With --fork-day, a sim-core scripted owner plays the first N days (the game before the fork), then the Stars
 * script takes that restaurant over, as a player choosing "Be the best" at the fork would.
 *
 * Prints, per year: stars after guide day, the year's (now revealed) inspector visits, stress, the prestige tracks
 * and cash; then whether the five-year three-star win triggered.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { content as realContent } from "@full-plate/content";
import { STRATEGIES, newGame, strategies, type ContentPack, type GameState, type StrategyName } from "@full-plate/sim-core";
import { report, runHeadless, type HeadlessRun, type Profile } from "./script";

export * from "./script";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

/** The first `days` of a game played by a sim-core scripted owner (the game before the fork). */
export function playUntil(content: ContentPack, seed: number, days: number, strat: StrategyName): GameState {
  let s = newGame(content, { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "The Larder", difficulty: "normal" });
  while (s.day < days && s.phase !== "gameover") s = strategies.runStrategyDay(content, s, STRATEGIES[strat]);
  return s;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const years = arg("years", 6);
  const seed = arg("seed", 1);
  const seeds = arg("seeds", 1);
  const refitYear = arg("refit-year", 0);
  const quiet = process.argv.includes("--quiet");
  const pi = process.argv.indexOf("--profile");
  const profile: Profile = pi >= 0 && process.argv[pi + 1] === "bistro" ? "bistro" : "stars";
  const forkDay = arg("fork-day", 0);
  const yi = process.argv.indexOf("--year1");
  const year1 = (yi >= 0 ? process.argv[yi + 1] : "typical") as StrategyName;
  const t0 = performance.now();
  const runs: HeadlessRun[] = [];
  for (let k = 0; k < seeds; k++) {
    const from = forkDay > 0 ? playUntil(realContent, seed + k, forkDay, year1) : undefined;
    if (from && from.phase === "gameover") {
      console.log(`seed ${seed + k}: the ${year1} owner went bust before the fork (day ${from.day})`);
      continue;
    }
    const run = runHeadless(realContent, { years, seed: seed + k, refitYear, districtId: "high_street", profile, ...(from ? { from } : {}) });
    runs.push(run);
    if (!quiet || k === 0) console.log(report(run) + "\n");
    else if (run.ending?.startsWith("gameover")) console.log(`seed ${run.seed}: ${run.ending} on day ${run.final.state.day}`);
  }
  if (seeds > 1) {
    const peak = runs.map((r) => Math.max(0, ...r.rows.map((x) => x.starsAfter)));
    const hist = [0, 1, 2, 3].map((n) => `${n}★ ${peak.filter((p) => p === n).length}`).join("  ");
    console.log(`peak stars over ${seeds} seeds: ${hist}   wins: ${runs.filter((r) => r.win).length}   bust: ${runs.filter((r) => r.ending?.startsWith("gameover")).length}`);
  }
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}
