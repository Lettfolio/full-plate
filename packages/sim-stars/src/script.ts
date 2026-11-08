/**
 * A scripted, quality-focused restaurant on sim-core's public API with the Stars layer mounted exactly as
 * docs/STARS-NOTES.md describes. Browser-safe (no node imports): the headless CLI (headless.ts) and the demo use it.
 */
import { applyCommand, candidates, newGame, tick } from "@full-plate/sim-core";
import type { Command, ContentPack, DayResult, GameState } from "@full-plate/sim-core";
import { applyStarsCommand } from "./commands";
import { YEAR_DAYS } from "./constants";
import { applyStarsEffects, prepareService } from "./effects";
import { withSignatures } from "./signatures";
import { newStarsState, starsView } from "./state";
import { closedDay, stepStarsDay } from "./step";
import type { StarsCommand, StarsEvent, StarsState } from "./types";

/** "stars": the ambitious perfectionist. "bistro": a good neighbourhood place (popular menu, any decent chef, no Stars investments). */
export type Profile = "stars" | "bistro";
export interface HeadlessOptions { years: number; seed: number; refitYear: number; districtId: string; profile?: Profile }

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

export interface HeadlessRun { seed: number; profile: Profile; rows: YearRow[]; final: { state: GameState; stars: StarsState }; win: boolean; ending?: string; events: StarsEvent[] }

/**
 * Quality menu: the most technically demanding food with a quality ceiling ≥ 88 (3 mains, a starter, a dessert)
 * plus the best drink, at 1.2× suggested. Ambition is what the technique criterion rewards.
 */
export function bistroMenu(content: ContentPack, districtId: string): { dishId: string; price: number }[] {
  const district = content.districts.find((d) => d.id === districtId)!;
  const appeal = (d: (typeof content.dishes)[number]) => Object.entries(district.segmentMix).reduce((a, [seg, w]) => a + w * (d.baseAppeal[seg] ?? 0), 0);
  const pool = [...content.dishes].sort((a, b) => appeal(b) - appeal(a) || (a.id < b.id ? -1 : 1));
  const pick = (course: string, n: number) => pool.filter((d) => d.course === course).slice(0, n);
  return [...pick("main", 3), ...pick("starter", 1), ...pick("dessert", 1), ...pick("drink", 1)].map((d) => ({ dishId: d.id, price: d.suggestedPrice }));
}

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

function staffUp(content: ContentPack, s0: GameState, step: (s: GameState, c: Command) => GameState, profile: Profile): GameState {
  let s = s0;
  for (const role of ["chef", "server"] as const) {
    const want = s.cash > 150_000 ? 2 : 1;
    if (s.staff.filter((x) => x.role === role).length >= want) continue;
    const pool = candidates(content, s)
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.role === role && !x.c.hired)
      .sort((a, b) =>
        profile === "stars"
          ? b.c.skill + (role === "server" ? b.c.charm : b.c.speed) / 2 - (a.c.skill + (role === "server" ? a.c.charm : a.c.speed) / 2)
          : (b.c.skill + b.c.speed) / b.c.wage - (a.c.skill + a.c.speed) / a.c.wage,
      );
    const best = pool[0];
    if (best) s = step(s, { type: "HIRE", candidateIndex: best.i });
  }
  // Consistency needs two strong chefs: swap the weakest for a candidate 15+ points better when cash allows.
  const chefs = s.staff.filter((x) => x.role === "chef").sort((a, b) => a.skill - b.skill);
  const weakest = chefs[0];
  if (profile === "stars" && chefs.length >= 2 && weakest && s.cash > 600_000) {
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
  if (profile === "stars" && s.cash > 800_000 && profit30(s) > 0) {
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

export interface DayLog {
  day: number;
  covers: number;
  quality: number;
  stress: number;
  prestige: number;
  cash: number;
  events: StarsEvent[];
}

/** A scripted restaurant you can advance one day at a time (the headless CLI and the demo page both use it). */
export class ScriptedRun {
  readonly content: ContentPack;
  readonly opts: HeadlessOptions;
  readonly profile: Profile;
  state: GameState;
  stars: StarsState;
  rows: YearRow[] = [];
  events: StarsEvent[] = [];
  private row?: YearRow;
  private qSum = 0;
  private qN = 0;

  constructor(content: ContentPack, opts: HeadlessOptions) {
    this.content = content;
    this.opts = opts;
    this.profile = opts.profile ?? "stars";
    let s = newGame(content, { type: "NEW_GAME", seed: opts.seed, districtId: opts.districtId, restaurantName: "The Larder", difficulty: "normal" });
    for (const item of this.profile === "stars" ? qualityMenu(content) : bistroMenu(content, opts.districtId)) s = this.step(s, { type: "ADD_MENU_ITEM", dishId: item.dishId, price: item.price });
    this.state = s;
    this.stars = newStarsState(content, s);
  }

  private step(st: GameState, c: Command): GameState {
    return applyCommand(this.content, st, c).state;
  }

  get done(): boolean {
    return this.state.phase === "gameover" || !!this.stars.ending;
  }

  /** Plays one full day: morning decisions, service, the Stars evening step, effects, restock, END_DAY. */
  stepDay(): DayLog | undefined {
    if (this.done) return undefined;
    const content = this.content;
    const step = (st: GameState, c: Command) => this.step(st, c);
    let s = this.state;
    let stars = this.stars;
    const year = Math.floor(s.day / YEAR_DAYS) + 1;
    if (!this.row || this.row.year !== year) {
      if (this.row) this.rows.push(this.row);
      this.row = newRow(year, stars);
      this.qSum = 0;
      this.qN = 0;
    }
    const row = this.row;
    const dayEvents: StarsEvent[] = [];
    // ── morning ──
    s = staffUp(content, s, step, this.profile);
    for (const cmd of this.profile === "stars" ? decide(content, stars, s, this.opts) : []) {
      const r = applyStarsCommand(content, stars, cmd, { day: s.day, cash: s.cash, state: s });
      stars = r.stars;
      for (const e of r.events) if (e.type === "REJECTED") row.notes.push(`d${s.day} ${cmd.type} rejected: ${e.reason}`);
      dayEvents.push(...r.events);
      // A head chef who left must be fired in the sim-core game.
      for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId && s.staff.some((x) => x.id === e.staffId)) s = step(s, { type: "FIRE", staffId: e.staffId });
    }
    // ── service (on signature-aware content; nobody comes while shut) ──
    const cooking = withSignatures(content, stars);
    s = prepareService(s, stars);
    s = play(cooking, s);
    if (s.phase === "gameover") {
      this.state = s;
      this.stars = stars;
      this.rows.push(row);
      this.row = undefined;
      return undefined;
    }
    // ── evening: Stars step on today's result, then fold its effects back ──
    const result: DayResult = s.history.at(-1)!;
    const r = stepStarsDay(cooking, stars, result.covers > 0 ? result : closedDay(result.day), s);
    stars = r.stars;
    dayEvents.push(...r.events);
    noteEvents(row, s.day, r.events);
    const fx = applyStarsEffects(s, stars);
    s = fx.state;
    stars = fx.stars;
    for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId && s.staff.some((x) => x.id === e.staffId)) s = step(s, { type: "FIRE", staffId: e.staffId });
    const quality = result.covers > 0 ? (stars.consistencyWindow.at(-1) ?? 0) : 0;
    if (result.covers > 0) {
      this.qSum += quality;
      this.qN++;
    }
    row.covers += result.covers;
    row.quality = this.qN ? Math.round((this.qSum / this.qN) * 10) / 10 : 0;
    row.stressMax = Math.max(row.stressMax, stars.headChef.stress);
    row.stressEnd = stars.headChef.stress;
    row.prestige = s.reputation.prestige;
    row.fiftyBest = stars.guides.fiftyBest.rank;
    row.hallOfFame = stars.guides.fiftyBest.hallOfFame;
    row.gaultMillau = stars.guides.gaultMillau.points;
    row.goodFood = stars.guides.goodFood.tier;
    row.cash = s.cash;
    const log: DayLog = { day: result.day, covers: result.covers, quality, stress: stars.headChef.stress, prestige: s.reputation.prestige, cash: s.cash, events: dayEvents };
    if (s.phase === "evening") s = restock(content, s, step);
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") {
      const ev = content.events.find((e) => e.id === s.activeEvent?.eventId);
      const choice = ev?.choices.find((c) => (c.effects.cash ?? 0) >= 0 || s.cash + (c.effects.cash ?? 0) > 1_000_000) ?? ev?.choices.at(-1);
      s = step(s, { type: "RESOLVE_EVENT", choiceId: choice?.id ?? "x" });
    }
    this.state = s;
    this.stars = stars;
    this.events.push(...dayEvents);
    if (this.done && this.row) {
      this.rows.push(this.row);
      this.row = undefined;
    }
    return log;
  }

  /** Rows so far, including the year in progress. */
  allRows(): YearRow[] {
    return this.row ? [...this.rows, this.row] : this.rows;
  }

  result(): HeadlessRun {
    const s = this.state;
    const stars = this.stars;
    return {
      seed: this.opts.seed,
      profile: this.profile,
      rows: this.allRows(),
      final: { state: s, stars },
      win: !!stars.ending?.win,
      ...(stars.ending ? { ending: stars.ending.kind } : s.phase === "gameover" ? { ending: `gameover: ${s.gameOverReason ?? ""}` } : {}),
      events: this.events,
    };
  }
}

function newRow(year: number, stars: StarsState): YearRow {
  const n = stars.guides.michelin.stars;
  return { year, starsBefore: n, starsAfter: n, assessed: false, visits: [], stressEnd: 0, stressMax: 0, prestige: 0, hallOfFame: false, gaultMillau: 0, goodFood: 0, cash: 0, covers: 0, quality: 0, notes: [] };
}

function noteEvents(row: YearRow, day: number, events: readonly StarsEvent[]): void {
  for (const e of events) {
    if (e.type === "HEAD_CHEF_LEFT") row.notes.push(`d${day} head chef left (${e.backed ? "backed" : `rival ${e.rival}`})`);
    if (e.type === "BURNOUT") row.notes.push(`d${day} BURNOUT`);
    if (e.type === "SMYTH_ARC_STARTED") row.notes.push(`d${day} head chef wants their own place`);
    if (e.type === "STAGIAIRE_SCANDAL") row.notes.push(`d${day} stagiaire scandal`);
    if (e.type === "RESEARCH_DONE") row.notes.push(`d${day} signature: ${e.dishId}`);
    if (e.type === "SATELLITE_OPENED") row.notes.push(`d${day} opened ${e.satellite.name}`);
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
}

export function runHeadless(content: ContentPack, opts: HeadlessOptions): HeadlessRun {
  const run = new ScriptedRun(content, opts);
  const days = opts.years * YEAR_DAYS;
  while (run.state.day < days && !run.done) run.stepDay();
  return run.result();
}

const gbp = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;
const starStr = (n: number) => (n ? "★".repeat(n) : "—");

export function report(run: HeadlessRun): string {
  const lines: string[] = [];
  lines.push(`seed ${run.seed} — ${run.profile}`);
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

