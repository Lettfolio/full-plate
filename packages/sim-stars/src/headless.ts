/**
 * Headless Stars run: a scripted, quality-focused restaurant on the real content pack, driven day by day through
 * sim-core's public API (newGame / applyCommand / runDay-equivalent ticks) with the Stars layer mounted exactly as
 * docs/STARS-NOTES.md describes.
 *
 *   pnpm --filter @full-plate/sim-stars headless [--years 6] [--seed 1] [--seeds 1] [--refit-year 0] [--quiet]
 *
 * Prints, per year: stars after guide day, the year's (now revealed) inspector visits, stress, the prestige tracks
 * and cash; then whether the five-year three-star win triggered.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { applyCommand, candidates, newGame, tick } from "@full-plate/sim-core";
import type { Command, ContentPack, DayResult, GameState } from "@full-plate/sim-core";
import { content as realContent } from "@full-plate/content";
import { applyStarsCommand } from "./commands";
import { YEAR_DAYS } from "./constants";
import { applyStarsEffects, prepareService } from "./effects";
import { withSignatures } from "./signatures";
import { newStarsState, starsView } from "./state";
import { closedDay, stepStarsDay } from "./step";
import type { StarsCommand, StarsEvent, StarsState } from "./types";

export interface HeadlessOptions { years: number; seed: number; refitYear: number; districtId: string }

export interface YearRow {
  year: number;
  guideDay?: number;
  starsBefore: number;
  starsAfter: number;
  assessed: boolean;
  score?: number;
  visits: { day: number; total: number }[];
  stressEnd: number;
  stressMax: number;
  prestige: number;
  fiftyBest?: number;
  hallOfFame: boolean;
  gaultMillau: number;
  goodFood: number;
  critic?: number;
  cash: number;
  covers: number;
  quality: number;
  notes: string[];
}

export interface HeadlessRun { seed: number; rows: YearRow[]; final: { state: GameState; stars: StarsState }; win: boolean; ending?: string; events: StarsEvent[] }

/**
 * Quality menu: the most technically demanding food with a quality ceiling ≥ 88 (3 mains, a starter, a dessert)
 * plus the best drink, at 1.2× suggested. Ambition is what the technique criterion rewards.
 */
export function qualityMenu(content: ContentPack): { dishId: string; price: number }[] {
  const pool = content.dishes.filter((d) => d.qualityCeiling >= 88).sort((a, b) => b.skillRequired - a.skillRequired || (a.id < b.id ? -1 : 1));
  const pick = (course: string, n: number) => pool.filter((d) => d.course === course).slice(0, n);
  return [...pick("main", 3), ...pick("starter", 1), ...pick("dessert", 1), ...pick("drink", 1)].map((d) => ({ dishId: d.id, price: Math.round((d.suggestedPrice * 1.2) / 10) * 10 }));
}

const POLICY: Record<string, readonly string[]> = {
  sent_back: ["remake", "apologise"],
  spill: ["mop"],
  big_party: ["push", "decline"],
  rush: ["ride", "simplify"],
  supplier_short: ["shop", "pull"],
  equipment: ["fix", "engineer"],
  vip: ["best"],
  staff_wobble: ["break"],
};

function play(content: ContentPack, s0: GameState): GameState {
  let s = applyCommand(content, s0, { type: "START_SERVICE" }).state;
  while (s.phase === "service") {
    for (const inc of s.incidents ?? []) {
      if (inc.resolution) continue;
      for (const id of POLICY[inc.kind] ?? []) {
        const opt = inc.options.find((o) => o.id === id && !o.disabled);
        if (!opt || (opt.cost ?? 0) > s.cash - 100_000) continue;
        const r = applyCommand(content, s, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: opt.id });
        if ((r.state.incidents ?? []).find((i) => i.id === inc.id)?.resolution) {
          s = r.state;
          break;
        }
      }
    }
    s = tick(content, s).state;
  }
  return s;
}

/** First of a role: Wed-Sun (sim-core default). Second: Mon, Tue + the weekend (cover and the busy nights). */
const COVER_PLUS_WEEKEND = [true, true, false, false, true, true, true];
const COVER_ONLY = [true, true, false, false, false, false, false];
const MAIN_ROTA = [false, false, true, true, true, true, true];

/** Mean daily profit over the last 30 days. */
export function profit30(s: GameState): number {
  const h = s.history.slice(-30);
  return h.length ? h.reduce((a, d) => a + d.profit, 0) / h.length : 0;
}
const COVER_ROTA = [false, false, false, false, false, false, true];

function staffUp(content: ContentPack, s0: GameState, step: (s: GameState, c: Command) => GameState): GameState {
  let s = s0;
  for (const role of ["chef", "server"] as const) {
    const want = s.cash > 150_000 ? 2 : 1;
    if (s.staff.filter((x) => x.role === role).length >= want) continue;
    const pool = candidates(content, s)
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.role === role && !x.c.hired)
      .sort((a, b) => b.c.skill + (role === "server" ? b.c.charm : b.c.speed) / 2 - (a.c.skill + (role === "server" ? a.c.charm : a.c.speed) / 2));
    const best = pool[0];
    if (best) s = step(s, { type: "HIRE", candidateIndex: best.i });
  }
  // Consistency needs two strong chefs: swap the weakest for a candidate 15+ points better when cash allows.
  const chefs = s.staff.filter((x) => x.role === "chef").sort((a, b) => a.skill - b.skill);
  const weakest = chefs[0];
  if (chefs.length >= 2 && weakest && s.cash > 600_000) {
    const better = candidates(content, s).map((c, i) => ({ c, i })).filter((x) => x.c.role === "chef" && !x.c.hired && x.c.skill >= weakest.skill + 15).sort((a, b) => b.c.skill - a.c.skill)[0];
    if (better) {
      const hired = step(s, { type: "HIRE", candidateIndex: better.i });
      if (hired.staff.length > s.staff.length) s = step(hired, { type: "FIRE", staffId: weakest.id });
    }
  }
  for (const role of ["chef", "server"] as const) {
    const team = s.staff.filter((x) => x.role === role).sort((a, b) => b.skill - a.skill || (a.id < b.id ? -1 : 1));
    const first = team[0];
    if (first && first.rota.join() !== MAIN_ROTA.join()) s = step(s, { type: "SET_ROTA", staffId: first.id, rota: MAIN_ROTA });
    const second = team[1];
    const rota = s.cash > 1_000_000 && profit30(s) >= 0 ? COVER_PLUS_WEEKEND : COVER_ONLY;
    if (second && second.rota.join() !== rota.join()) s = step(s, { type: "SET_ROTA", staffId: second.id, rota });
  }
  // Courses for a chef on their day off, when the business can afford it.
  if (s.cash > 800_000 && profit30(s) > 0) {
    const off = s.staff.find((x) => x.role === "chef" && x.skill < x.potential && !x.rota[(s.day + 2) % 7]);
    if (off) s = step(s, { type: "TRAIN", staffId: off.id });
  }
  return s;
}

/** Orders tomorrow's needs from the busiest recent day × 1.5 (sim-core's premium owner), so the pass never runs dry. */
function restock(content: ContentPack, s0: GameState, step: (s: GameState, c: Command) => GameState): GameState {
  const recent = s0.history.slice(-7).map((h) => h.covers + h.walkouts / 2);
  const covers = Math.max(30, ...recent);
  const active = s0.menu.filter((m) => m.active).map((m) => content.dishes.find((d) => d.id === m.dishId)!);
  const perDish = 1.8 / Math.max(1, active.length);
  const need: Record<string, number> = {};
  for (const d of active) for (const ing of d.ingredients) need[ing.id] = (need[ing.id] ?? 0) + ing.qty * perDish;
  let s = s0;
  for (const [id, per] of Object.entries(need)) {
    const target = Math.ceil(per * covers * 1.5);
    const have = (s.stock.find((x) => x.ingredientId === id)?.qty ?? 0) + s.orders.filter((o) => o.ingredientId === id).reduce((a, o) => a + o.qty, 0);
    if (have < target) s = step(s, { type: "ORDER_STOCK", ingredientId: id, qty: target - Math.floor(have) });
  }
  return s;
}

/** The scripted Stars decisions a careful perfectionist makes. */
function decide(content: ContentPack, stars: StarsState, s: GameState, opts: HeadlessOptions): StarsCommand[] {
  const out: StarsCommand[] = [];
  const day = s.day;
  const year = Math.floor(day / YEAR_DAYS) + 1;
  const owed = -stars.ledger.pendingCash;
  const spare = s.cash - owed;
  const m = stars.guides.michelin;
  const healthy = profit30(s) > 5_000;
  const thriving = profit30(s) > 15_000;
  const nextSupplier = ["hollow_lane", "day_boats", "foragers"].find((id) => !stars.sourcing.some((x) => x.supplierId === id));
  if (nextSupplier && healthy && spare > 1_500_000 && day > 60) out.push({ type: "SIGN_SOURCING", supplierId: nextSupplier });
  if (!stars.testKitchen.unlocked && thriving && spare > 2_500_000) out.push({ type: "UNLOCK_TEST_KITCHEN" });
  if (stars.testKitchen.unlocked && !stars.testKitchen.inProgress && healthy && spare > 1_000_000) {
    const next = s.menu.map((x) => content.dishes.find((d) => d.id === x.dishId)!).filter((d) => d.course === "main" || d.course === "starter").find((d) => !stars.testKitchen.researched.includes(d.id));
    if (next) out.push({ type: "RESEARCH_DISH", dishId: next.id });
  }
  if (!stars.ticketing.unlocked && m.stars >= 1 && healthy && spare > 2_000_000) out.push({ type: "UNLOCK_TICKETING" });
  if (m.stars >= 2 && stars.stagiaires.count === 0 && thriving && spare > 3_000_000 && stars.stagiaires.scandals === 0) out.push({ type: "SET_STAGIAIRE_POLICY", paid: true, count: 1 });
  // Thin margins: let the stagiaire go again when the month turns red.
  if (stars.stagiaires.count > 0 && profit30(s) < 0 && s.cash < 1_000_000) out.push({ type: "SET_STAGIAIRE_POLICY", paid: true, count: 0 });
  if (m.stars >= 2 && stars.satellites.filter((x) => x.kind !== "backed").length === 0 && spare > 5_000_000) out.push({ type: "OPEN_SATELLITE", kind: "bar", name: "The Counter" });
  for (const sat of stars.satellites) if (!sat.headChefTrained && sat.trainingDaysLeft === undefined && spare > 2_500_000) out.push({ type: "TRAIN_SATELLITE_CHEF", satelliteId: sat.id });
  if (stars.headChef.wantsOwnPlace) out.push(spare > 3_500_000 ? { type: "BACK_HEAD_CHEF" } : { type: "LET_HEAD_CHEF_GO" });
  if (opts.refitYear > 0 && year === opts.refitYear && day % YEAR_DAYS === 200 && !(stars.refitUntil && stars.refitUntil > day)) out.push({ type: "CLOSE_FOR_REFIT", days: 260 });
  return out;
}

export function runHeadless(content: ContentPack, opts: HeadlessOptions): HeadlessRun {
  const step = (st: GameState, c: Command) => applyCommand(content, st, c).state;
  let s = newGame(content, { type: "NEW_GAME", seed: opts.seed, districtId: opts.districtId, restaurantName: "The Larder", difficulty: "normal" });
  for (const item of qualityMenu(content)) s = step(s, { type: "ADD_MENU_ITEM", dishId: item.dishId, price: item.price });
  let stars = newStarsState(content, s);
  const rows: YearRow[] = [];
  const allEvents: StarsEvent[] = [];
  let row: YearRow | undefined;
  const newRow = (year: number): YearRow => ({ year, starsBefore: stars.guides.michelin.stars, starsAfter: stars.guides.michelin.stars, assessed: false, visits: [], stressEnd: 0, stressMax: 0, prestige: 0, hallOfFame: false, gaultMillau: 0, goodFood: 0, cash: 0, covers: 0, quality: 0, notes: [] });
  let qSum = 0;
  let qN = 0;
  const days = opts.years * YEAR_DAYS;
  while (s.day < days && s.phase !== "gameover" && !stars.ending) {
    const year = Math.floor(s.day / YEAR_DAYS) + 1;
    if (!row || row.year !== year) {
      if (row) rows.push(row);
      row = newRow(year);
      qSum = 0;
      qN = 0;
    }
    // ── morning ──
    s = staffUp(content, s, step);
    for (const cmd of decide(content, stars, s, opts)) {
      const r = applyStarsCommand(content, stars, cmd, { day: s.day, cash: s.cash, state: s });
      stars = r.stars;
      for (const e of r.events) if (e.type === "REJECTED") row.notes.push(`d${s.day} ${cmd.type} rejected: ${e.reason}`);
      allEvents.push(...r.events);
      // A head chef who left must be fired in the sim-core game.
      for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId) s = step(s, { type: "FIRE", staffId: e.staffId });
    }
    // ── service (on signature-aware content; nobody comes while shut) ──
    const cooking = withSignatures(content, stars);
    s = prepareService(s, stars);
    s = play(cooking, s);
    if (s.phase === "gameover") break;
    // ── evening: Stars step on today's result, then fold its effects back ──
    const result: DayResult = s.history.at(-1)!;
    const r = stepStarsDay(cooking, stars, result.covers > 0 ? result : closedDay(result.day), s);
    stars = r.stars;
    allEvents.push(...r.events);
    for (const e of r.events) {
      if (e.type === "HEAD_CHEF_LEFT" && e.staffId) row.notes.push(`d${s.day} head chef left (${e.backed ? "backed" : `rival ${e.rival}`})`);
      if (e.type === "BURNOUT") row.notes.push(`d${s.day} BURNOUT`);
      if (e.type === "SMYTH_ARC_STARTED") row.notes.push(`d${s.day} head chef wants their own place`);
      if (e.type === "STAGIAIRE_SCANDAL") row.notes.push(`d${s.day} stagiaire scandal`);
      if (e.type === "RESEARCH_DONE") row.notes.push(`d${s.day} signature: ${e.dishId}`);
      if (e.type === "SATELLITE_OPENED") row.notes.push(`d${s.day} opened ${e.satellite.name}`);
      if (e.type === "CRITIC_REVIEW") row.critic = e.review.rating;
      if (e.type === "GUIDE_DAY") {
        row.guideDay = e.result.day;
        row.starsBefore = e.result.before;
        row.starsAfter = e.result.after;
        row.assessed = e.result.assessed;
        if (e.result.score !== undefined) row.score = e.result.score;
        row.visits = e.visits.map((v) => ({ day: v.day, total: v.total }));
        if (!e.result.assessed) row.notes.push(e.result.reason);
      }
    }
    const fx = applyStarsEffects(s, stars);
    s = fx.state;
    stars = fx.stars;
    for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId && s.staff.some((x) => x.id === e.staffId)) s = step(s, { type: "FIRE", staffId: e.staffId });
    if (result.covers > 0 && stars.consistencyWindow.length) {
      qSum += stars.consistencyWindow.at(-1)!;
      qN++;
    }
    row.covers += result.covers;
    row.quality = qN ? Math.round((qSum / qN) * 10) / 10 : 0;
    row.stressMax = Math.max(row.stressMax, stars.headChef.stress);
    row.stressEnd = stars.headChef.stress;
    row.prestige = s.reputation.prestige;
    row.fiftyBest = stars.guides.fiftyBest.rank;
    row.hallOfFame = stars.guides.fiftyBest.hallOfFame;
    row.gaultMillau = stars.guides.gaultMillau.points;
    row.goodFood = stars.guides.goodFood.tier;
    row.cash = s.cash;
    if (s.phase === "evening") s = restock(content, s, step);
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") {
      const ev = content.events.find((e) => e.id === s.activeEvent?.eventId);
      const choice = ev?.choices.find((c) => (c.effects.cash ?? 0) >= 0 || s.cash + (c.effects.cash ?? 0) > 1_000_000) ?? ev?.choices.at(-1);
      s = step(s, { type: "RESOLVE_EVENT", choiceId: choice?.id ?? "x" });
    }
  }
  if (row) rows.push(row);
  return {
    seed: opts.seed,
    rows,
    final: { state: s, stars },
    win: !!stars.ending?.win,
    ...(stars.ending ? { ending: stars.ending.kind } : s.phase === "gameover" ? { ending: `gameover: ${s.gameOverReason ?? ""}` } : {}),
    events: allEvents,
  };
}

const gbp = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;
const starStr = (n: number) => (n ? "★".repeat(n) : "—");

export function report(run: HeadlessRun): string {
  const lines: string[] = [];
  lines.push(`seed ${run.seed}`);
  lines.push("yr  guide  stars    score  visits (day:total)                         stress end/max  prestige  50Best  G&M   GFG  critic  quality  covers   cash");
  for (const r of run.rows) {
    const visits = r.visits.map((v) => `${v.day}:${v.total.toFixed(0)}`).join(" ");
    lines.push(
      [
        String(r.year).padStart(2),
        String(r.guideDay ?? "").padStart(6),
        `${starStr(r.starsBefore)}→${starStr(r.starsAfter)}`.padEnd(8),
        (r.score !== undefined ? r.score.toFixed(1) : r.guideDay !== undefined ? "n/a" : "").padStart(6),
        ` ${visits}`.padEnd(42),
        `${r.stressEnd.toFixed(0)}/${r.stressMax.toFixed(0)}`.padStart(14),
        r.prestige.toFixed(0).padStart(9),
        (r.hallOfFame ? "HoF" : r.fiftyBest !== undefined ? `#${r.fiftyBest}` : "—").padStart(7),
        r.gaultMillau.toFixed(1).padStart(5),
        String(r.goodFood).padStart(5),
        (r.critic ? `★${r.critic}` : "—").padStart(7),
        r.quality.toFixed(1).padStart(8),
        String(r.covers).padStart(7),
        gbp(r.cash).padStart(10),
      ].join(" "),
    );
    for (const n of r.notes) lines.push(`      · ${n}`);
  }
  const st = run.final.stars;
  const view = starsView(st, run.final.state.day);
  lines.push(`three-star streak: ${view.threeStarStreak}   win (3★ × 5 guides): ${run.win ? "YES" : "no"}   ending: ${run.ending ?? "—"}`);
  lines.push(`signatures: ${st.testKitchen.researched.join(", ") || "—"}   sourcing: ${st.sourcing.map((x) => `${x.name} ${x.relationship.toFixed(0)}`).join(", ") || "—"}   satellites: ${st.satellites.map((x) => `${x.name}${x.headChefTrained ? " (trained)" : ""} ${gbp(x.earned)}`).join(", ") || "—"}`);
  return lines.join("\n");
}

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
  const t0 = performance.now();
  const runs: HeadlessRun[] = [];
  for (let k = 0; k < seeds; k++) {
    const run = runHeadless(realContent, { years, seed: seed + k, refitYear, districtId: "high_street" });
    runs.push(run);
    if (!quiet || k === 0) console.log(report(run) + "\n");
  }
  if (seeds > 1) {
    const peak = runs.map((r) => Math.max(0, ...r.rows.map((x) => x.starsAfter)));
    const hist = [0, 1, 2, 3].map((n) => `${n}★ ${peak.filter((p) => p === n).length}`).join("  ");
    console.log(`peak stars over ${seeds} seeds: ${hist}   wins: ${runs.filter((r) => r.win).length}   bust: ${runs.filter((r) => r.ending?.startsWith("gameover")).length}`);
  }
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}
