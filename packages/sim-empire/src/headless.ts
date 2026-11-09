/**
 * Headless Empire runner: scripted growth from one site over N years under three styles.
 *   pnpm --filter @full-plate/sim-empire headless [--years 10] [--seeds 5] [--style all|franchise|company|innout] [--board skip|follow|both] [--perf] [--unit]
 * --unit prints the first-year unit economics of one new site (franchise and company, with and without supply deals).
 * Prints sites, meals served, HQ cash, franchisee mood, regions won and whether the win condition is reached.
 * The strategies themselves live in strategies.ts (pure, browser-safe).
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ContentPack } from "@full-plate/sim-core";
import { applyEmpireCommand } from "./engine";
import { benchmark, formatTable, runStyle, startingEmpire, summariseRun, type BoardPolicy, type EmpireStyle, type RunSummary } from "./strategies";
import { formatUnitEconomics, probeUnitEconomics } from "./unitEconomics";

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
  if (argv.includes("--unit")) {
    // One new High Street site in the home city on a locked formula, HQ holding the lease (the franchise style's set-up).
    const e = applyEmpireCommand(content, startingEmpire(content, Number(get("seed") ?? 1)), { type: "SET_FORMULA", locked: true }).empire;
    for (const ownership of ["franchise", "company"] as const)
      for (const supplyDeals of [false, true])
        console.log(formatUnitEconomics(probeUnitEconomics(content, e, { districtId: get("district") ?? "high_street", ownership, supplyDeals }), `${ownership}, ${supplyDeals ? "with" : "without"} supply deals`) + "\n");
    return;
  }
  const years = Number(get("years") ?? 10);
  const seeds = Number(get("seeds") ?? 5);
  const styleArg = get("style") ?? "all";
  const styles: EmpireStyle[] = styleArg === "all" ? ["franchise", "company", "innout"] : [styleArg as EmpireStyle];
  // Round 6: --board skip (never answers the monthly meeting), follow (takes the board's advice) or both.
  const boardArg = get("board") ?? "skip";
  const boards: BoardPolicy[] = boardArg === "both" ? ["skip", "follow"] : [boardArg as BoardPolicy];
  const rows: RunSummary[] = [];
  const t0 = performance.now();
  for (const board of boards) for (const style of styles) for (let s = 1; s <= seeds; s++) rows.push(summariseRun(runStyle(content, style, s, years, undefined, board)));
  console.log(`Full Plate Empire headless — ${years} years, ${seeds} seeds per style`);
  console.log(formatTable(rows));
  if (boards.includes("follow")) {
    // What the board-follower actually decided, per style (counts over all its seeds).
    for (const style of styles) {
      const tally: Record<string, number> = {};
      for (const r of rows) if (r.board === "follow" && r.style === style) for (const [k, n] of Object.entries(r.decisions)) tally[k] = (tally[k] ?? 0) + n;
      console.log(`${style} board decisions over all seeds: ${Object.entries(tally).sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
    }
  }
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
