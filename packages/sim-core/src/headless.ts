/**
 * Headless balance runner.
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
import { applyCommand, candidates, newGame, runDay } from "./index";
import { stockQty } from "./stock";
import type { Candidate, Command, ContentPack, Difficulty, GameState, StaffRole } from "./types";

// ── strategies ──
export type StrategyName = "balanced" | "cheap" | "premium";

export interface Strategy {
  name: StrategyName;
  /** Menu price as a multiple of suggested price. */
  priceMult: number;
  /** Max dishes on the menu (best-appeal first). */
  menuSize: number;
  /** Cash above which a second chef / server is hired. */
  secondHireCash: number;
  /** Cash above which a table is bought (if below max). */
  tableCash: number;
  /** Days of expected usage to keep in stock. */
  stockDays: number;
  /** Pick candidates by skill (premium) or by wage (cheap). */
  hireBy: "value" | "skill" | "wage";
}

export const STRATEGIES: Record<StrategyName, Strategy> = {
  balanced: { name: "balanced", priceMult: 1, menuSize: 6, secondHireCash: 1_500_000, tableCash: 2_000_000, stockDays: 1.3, hireBy: "value" },
  cheap: { name: "cheap", priceMult: 0.85, menuSize: 5, secondHireCash: 2_500_000, tableCash: 3_000_000, stockDays: 1.1, hireBy: "wage" },
  premium: { name: "premium", priceMult: 1.25, menuSize: 6, secondHireCash: 1_000_000, tableCash: 1_500_000, stockDays: 1.5, hireBy: "skill" },
};

type Step = (s: GameState, cmd: Command) => GameState;

function setUpMenu(content: ContentPack, state: GameState, strat: Strategy, step: Step): GameState {
  const district = content.districts.find((d) => d.id === state.districtId)!;
  const appeal = (id: string) => {
    const dish = content.dishes.find((d) => d.id === id)!;
    return Object.entries(district.segmentMix).reduce((a, [seg, w]) => a + w * (dish.baseAppeal[seg] ?? 0), 0);
  };
  const mains = content.dishes.filter((d) => d.course === "main").sort((a, b) => appeal(b.id) - appeal(a.id));
  const others = content.dishes.filter((d) => d.course !== "main").sort((a, b) => appeal(b.id) - appeal(a.id));
  const nMains = Math.max(1, Math.ceil(strat.menuSize / 2));
  const picks = [...mains.slice(0, nMains), ...others].slice(0, strat.menuSize);
  let s = state;
  for (const d of picks) s = step(s, { type: "ADD_MENU_ITEM", dishId: d.id, price: Math.round((d.suggestedPrice * strat.priceMult) / 10) * 10 });
  return s;
}

function scoreCandidate(c: Candidate, strat: Strategy): number {
  if (strat.hireBy === "skill") return c.skill + (c.role === "server" ? c.charm : c.speed) / 2;
  if (strat.hireBy === "wage") return -c.wage;
  return (c.skill + (c.role === "server" ? c.charm : c.speed)) / (c.wage / 1000);
}

function hireRole(content: ContentPack, s: GameState, role: StaffRole, strat: Strategy, step: Step): GameState {
  const pool = candidates(content, s)
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.role === role && !x.c.hired)
    .sort((a, b) => scoreCandidate(b.c, strat) - scoreCandidate(a.c, strat));
  const best = pool[0];
  return best ? step(s, { type: "HIRE", candidateIndex: best.i }) : s;
}

function staffing(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  let cur = s;
  for (const role of ["chef", "server"] as const) {
    const have = cur.staff.filter((x) => x.role === role).length;
    const want = cur.cash > strat.secondHireCash ? 2 : 1;
    if (have < want) cur = hireRole(content, cur, role, strat, step);
  }
  return cur;
}

/** Second staff of a role works the days the first has off plus the weekend, so all 7 days are covered. */
function rotas(s: GameState, step: Step): GameState {
  let cur = s;
  for (const role of ["chef", "server"] as const) {
    const team = cur.staff.filter((x) => x.role === role);
    if (team.length < 2) continue;
    const second = team[1]!;
    const rota = [true, true, false, false, true, true, true];
    if (second.rota.join() !== rota.join()) cur = step(cur, { type: "SET_ROTA", staffId: second.id, rota });
  }
  return cur;
}

/** Plates per cover the scripted owner plans for (one main plus some extras). */
const PLATES_PER_COVER = 1.8;

/** In the evening, orders tomorrow's needs from the busiest recent day (deliveries arrive next morning). */
function restock(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  const recent = s.history.slice(-7).map((h) => h.covers + h.walkouts / 2);
  const covers = Math.max(30, ...recent);
  const active = s.menu.filter((m) => m.active).map((m) => content.dishes.find((d) => d.id === m.dishId)!);
  const platesPerDish = PLATES_PER_COVER / Math.max(1, active.length);
  const perCover: Record<string, number> = {};
  for (const d of active) for (const ing of d.ingredients) perCover[ing.id] = (perCover[ing.id] ?? 0) + ing.qty * platesPerDish;
  let cur = s;
  for (const [id, need] of Object.entries(perCover)) {
    const target = Math.ceil(need * covers * strat.stockDays);
    const pending = cur.orders.filter((o) => o.ingredientId === id).reduce((a, o) => a + o.qty, 0);
    const have = stockQty(cur.stock, id) + pending;
    if (have < target) cur = step(cur, { type: "ORDER_STOCK", ingredientId: id, qty: target - Math.floor(have) });
  }
  return cur;
}

function buyTables(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  const recent = s.history.slice(-7);
  const busy = recent.length >= 7 && recent.reduce((a, h) => a + h.walkouts, 0) / 7 > 4;
  if (busy && s.cash > strat.tableCash && s.tables.length < content.balance.maxTables) return step(s, { type: "BUY_TABLE" });
  return s;
}

/** First choice that does not cost cash we don't have; otherwise the last (usually the cheap option). */
function resolveEvent(content: ContentPack, s: GameState, step: Step): GameState {
  const ev = content.events.find((e) => e.id === s.activeEvent?.eventId);
  if (!ev) return s;
  const affordable = ev.choices.find((c) => (c.effects.cash ?? 0) >= 0 || s.cash + (c.effects.cash ?? 0) > 500_000);
  return step(s, { type: "RESOLVE_EVENT", choiceId: (affordable ?? ev.choices.at(-1)!).id });
}

export interface RunResult {
  seed: number;
  survived: boolean;
  daysPlayed: number;
  monthEndCash: number[];
  covers: number[];
  ratings: number[];
  finalPopularity: number;
  /** Final state (dropped when results cross a worker boundary). */
  final?: GameState;
}

export function playOne(content: ContentPack, seed: number, days: number, strat: Strategy, difficulty: Difficulty): RunResult {
  const step: Step = (s, cmd) => applyCommand(content, s, cmd).state;
  const districtId = content.districts[seed % content.districts.length]!.id;
  let s = newGame(content, { type: "NEW_GAME", seed, districtId, restaurantName: "Headless", difficulty });
  s = setUpMenu(content, s, strat, step);
  const monthEndCash: number[] = [];
  const covers: number[] = [];
  const ratings: number[] = [];
  while (s.day < days && s.phase !== "gameover") {
    s = staffing(content, s, strat, step);
    s = rotas(s, step);
    s = buyTables(content, s, strat, step);
    s = runDay(content, s).state;
    if (s.phase === "evening" || s.phase === "event") s = restock(content, s, strat, step);
    const h = s.history.at(-1);
    if (h) {
      covers.push(h.covers);
      if (h.covers) ratings.push(h.averageRating);
    }
    if ((s.day + 1) % DAYS_PER_MONTH === 0 && s.phase !== "gameover") monthEndCash.push(s.cash);
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") s = resolveEvent(content, s, step);
  }
  return { seed, survived: s.phase !== "gameover", daysPlayed: s.day, monthEndCash, covers, ratings, finalPopularity: s.reputation.popularity, final: s };
}

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
  lines.push(`avg covers/day: ${mean(results.flatMap((r) => r.covers)).toFixed(1)}   avg rating: ${mean(results.flatMap((r) => r.ratings)).toFixed(2)}   avg final popularity: ${mean(results.map((r) => r.finalPopularity)).toFixed(1)}`);
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
