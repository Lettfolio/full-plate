/**
 * Headless Empire runner: scripted growth from one site over N years under three styles.
 *   pnpm --filter @full-plate/sim-empire headless [--years 10] [--seeds 5] [--style all|franchise|company|innout] [--perf]
 * Prints sites, meals served, HQ cash, franchisee mood, regions won and whether the win condition is reached.
 * The strategies themselves live in strategies.ts (pure, browser-safe).
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ContentPack } from "@full-plate/sim-core";
import { benchmark, formatTable, runStyle, summariseRun, type EmpireStyle, type RunSummary } from "./strategies";

export * from "./strategies";

// ── CLI ──
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const { content } = (await import("@full-plate/content")) as { content: ContentPack };
  if (argv.includes("--perf")) {
    for (const n of [1000, 5000]) {
      const r = benchmark(content, n, 60);
      console.log(`${r.sites} aggregate sites: ${r.msPerDay.toFixed(2)} ms/day`);
    }
    return;
  }
  const years = Number(get("years") ?? 10);
  const seeds = Number(get("seeds") ?? 5);
  const styleArg = get("style") ?? "all";
  const styles: EmpireStyle[] = styleArg === "all" ? ["franchise", "company", "innout"] : [styleArg as EmpireStyle];
  const rows: RunSummary[] = [];
  const t0 = performance.now();
  for (const style of styles) for (let s = 1; s <= seeds; s++) rows.push(summariseRun(runStyle(content, style, s, years)));
  console.log(`Full Plate Empire headless — ${years} years, ${seeds} seeds per style`);
  console.log(formatTable(rows));
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
