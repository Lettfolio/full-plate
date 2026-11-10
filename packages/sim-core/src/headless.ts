/**
 * Headless balance runner.
 *   Strategies: balanced (near-optimal script), typical (headline "normal" owner), cheap, premium, nohire,
 *   learner (typical + follows every evening tip, advice.ts) and learner-<tip> (rota|overstock|dog|idleChef|underpriced: one tip).
 *   pnpm headless --days 365 --seeds 100 --strategy balanced|cheap|premium --difficulty normal [--content fixture|<module path>]
 * Plays scripted owners and prints survival, cash percentiles by month, covers/day and rating;
 * writes out/balance.csv (one row per seed × month).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { DAYS_PER_MONTH } from "./constants";
import { STRATEGIES, type RunResult, playOne, type StrategyName } from "./strategies";
import type { ContentPack, Difficulty } from "./types";

export * from "./strategies";

// ── reporting ──
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pounds = (p: number) => (Number.isNaN(p) ? "     —" : `£${Math.round(p / 100).toLocaleString("en-GB")}`.padStart(9));

export function summarise(results: readonly RunResult[], months: number): string {
  const lines: string[] = [];
  const survived = results.filter((r) => r.survived).length;
  lines.push(`survival: ${survived}/${results.length} (${((100 * survived) / results.length).toFixed(1)}%)`);
  lines.push(`avg covers/day: ${mean(results.flatMap((r) => r.covers)).toFixed(1)}   avg rating: ${mean(results.flatMap((r) => r.ratings)).toFixed(2)}   avg final popularity: ${mean(results.map((r) => r.finalPopularity)).toFixed(1)}   avg final prestige: ${mean(results.map((r) => r.finalPrestige ?? 0)).toFixed(1)}`);
  lines.push("month   p10 cash   median    p90 cash   alive");
  for (let m = 0; m < months; m++) {
    // Bankrupt runs count with their last cash so the low percentile shows the failures.
    const xs = results.map((r) => r.monthEndCash[m] ?? r.monthEndCash.at(-1) ?? 0);
    const alive = results.filter((r) => r.monthEndCash[m] !== undefined).length;
    lines.push(`${String(m + 1).padStart(5)} ${pounds(percentile(xs, 10))} ${pounds(percentile(xs, 50))} ${pounds(percentile(xs, 90))}   ${alive}`);
  }
  return lines.join("\n");
}

export function toCsv(results: readonly RunResult[], strategy: string, difficulty: string): string {
  const rows = ["seed,strategy,difficulty,survived,days_played,month,month_end_cash_pence,avg_covers,avg_rating"];
  for (const r of results) {
    r.monthEndCash.forEach((cash, m) => {
      const slice = r.covers.slice(m * DAYS_PER_MONTH, (m + 1) * DAYS_PER_MONTH);
      const rs = r.ratings.slice(m * DAYS_PER_MONTH, (m + 1) * DAYS_PER_MONTH);
      rows.push([r.seed, strategy, difficulty, r.survived, r.daysPlayed, m + 1, cash, mean(slice).toFixed(2), mean(rs).toFixed(2)].join(","));
    });
  }
  return rows.join("\n") + "\n";
}

// ── CLI ──
interface Args {
  days: number;
  seeds: number;
  strategy: StrategyName;
  difficulty: Difficulty;
  content: string;
  out: string;
  workers: number;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const strategy = (get("strategy") ?? "balanced") as StrategyName;
  if (!STRATEGIES[strategy]) throw new Error(`Unknown strategy ${strategy}`);
  const difficulty = (get("difficulty") ?? "normal") as Difficulty;
  if (!["cosy", "normal", "hard"].includes(difficulty)) throw new Error(`Unknown difficulty ${difficulty}`);
  return {
    days: Number(get("days") ?? 365),
    seeds: Number(get("seeds") ?? 100),
    strategy,
    difficulty,
    content: get("content") ?? "fixture",
    out: get("out") ?? "out/balance.csv",
    workers: Math.max(1, Number(get("workers") ?? Math.min(8, availableParallelism()))),
  };
}

/** "fixture" uses the test fixture; otherwise a module path exporting `content` (or default). */
async function loadContent(spec: string): Promise<ContentPack> {
  if (spec === "fixture") return (await import("../test/fixtureContent")).fixtureContent;
  const mod = (await import(pathToFileURL(resolve(spec)).href)) as { content?: ContentPack; default?: ContentPack };
  const pack = mod.content ?? mod.default;
  if (!pack) throw new Error(`${spec} does not export a ContentPack as 'content' or default`);
  return pack;
}

interface Job {
  args: Args;
  seeds: number[];
}

async function runJob(job: Job): Promise<RunResult[]> {
  const content = await loadContent(job.args.content);
  const strat = STRATEGIES[job.args.strategy];
  return job.seeds.map((seed) => {
    const { final: _f, ...r } = playOne(content, seed, job.args.days, strat, job.args.difficulty);
    return r;
  });
}

/** Splits seeds round-robin across worker threads (the sim is CPU-bound and pure). */
async function runParallel(args: Args): Promise<RunResult[]> {
  const seeds = Array.from({ length: args.seeds }, (_, i) => i + 1);
  const n = Math.min(args.workers, seeds.length);
  if (n <= 1) return runJob({ args, seeds });
  const self = fileURLToPath(import.meta.url);
  const chunks = Array.from({ length: n }, (_, w) => seeds.filter((_, i) => i % n === w));
  const parts = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<RunResult[]>((ok, fail) => {
          const worker = new Worker(self, { workerData: { args, seeds: chunk } satisfies Job, execArgv: process.execArgv });
          worker.once("message", ok);
          worker.once("error", fail);
        }),
    ),
  );
  return parts.flat().sort((a, b) => a.seed - b.seed);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const results = await runParallel(args);
  const secs = (performance.now() - t0) / 1000;
  console.log(`Full Plate headless — ${args.seeds} seeds × ${args.days} days, strategy=${args.strategy}, difficulty=${args.difficulty}, content=${args.content}`);
  console.log(summarise(results, Math.floor(args.days / DAYS_PER_MONTH)));
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(results, args.strategy, args.difficulty));
  console.log(`wrote ${out} in ${secs.toFixed(1)}s`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (!isMainThread && parentPort && (workerData as Job | undefined)?.seeds) {
  runJob(workerData as Job).then((r) => parentPort!.postMessage(r));
} else if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
