/**
 * Headless Stars run: a scripted, quality-focused restaurant on the real content pack (see script.ts).
 *
 *   pnpm --filter @full-plate/sim-stars headless [--years 6] [--seed 1] [--seeds 1] [--refit-year 0] [--profile stars|bistro] [--quiet]
 *
 * Prints, per year: stars after guide day, the year's (now revealed) inspector visits, stress, the prestige tracks
 * and cash; then whether the five-year three-star win triggered.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { content as realContent } from "@full-plate/content";
import { report, runHeadless, type HeadlessRun, type Profile } from "./script";

export * from "./script";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
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
  const t0 = performance.now();
  const runs: HeadlessRun[] = [];
  for (let k = 0; k < seeds; k++) {
    const run = runHeadless(realContent, { years, seed: seed + k, refitYear, districtId: "high_street", profile });
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
