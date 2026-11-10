/**
 * Scripted owner strategies (balanced, typical, cheap, premium, nohire, learner and learner-<tip>), browser-safe: no node imports.
 * Used by the headless runner and exported as `strategies` for other packages (sim-career's AI owner, demos).
 *
 *   runStrategyDay(content, state, STRATEGIES.typical)  // one planning → service → evening → next planning day
 *   playOne(content, seed, days, strat, difficulty)     // a whole run from newGame
 */
import { DAYS_PER_MONTH, DECOR_SLOTS, INSOLVENCY_DAYS } from "./constants";
import { BANK_LAST_DAYS } from "./bank";
import { dispatch as applyCommand } from "./commands";
import { tickService as tick } from "./engine";
import { newGame } from "./newGame";
import { candidates } from "./staff";
import { allAdvice, rotaAdvice } from "./advice";
import { stockQty } from "./stock";
import { findDecorItem, installed as installedDecor, wearOf as decorWear } from "./decor";
import type { AdviceKind, Candidate, Command, ContentPack, Difficulty, GameState, StaffRole } from "./types";

// ── strategies ──
export type StrategyName =
  | "balanced" | "cheap" | "premium" | "nohire" | "typical" | "learner"
  | "learner-rota" | "learner-overstock" | "learner-dog" | "learner-idleChef" | "learner-underpriced" | "decorator";

export interface Strategy {
  name: StrategyName;
  /** Menu price as a multiple of suggested price. */
  priceMult: number;
  /** Max dishes on the menu (best-appeal first). */
  menuSize: number;
  /** Cash above which a second chef / server is hired to cover the first one's days off. */
  coverCash: number;
  /** Cash above which the second chef / server also works the weekend. */
  secondHireCash: number;
  /** Cash above which a table is bought (if below max). */
  tableCash: number;
  /** Days of expected usage to keep in stock. */
  stockDays: number;
  /** Pick candidates by skill (premium) or by wage (cheap). */
  hireBy: "value" | "skill" | "wage";
  /** Never hire: the owner covers every role (the "is staff worth it?" baseline). */
  noHire?: boolean;
  /**
   * A typical first-time player rather than a near-optimal script: never trims weekend shifts after a bad fortnight,
   * answers only every other incident, and restocks with a generous margin (overstock → spoilage).
   */
  typical?: boolean;
  /**
   * [round 5 review] A typical player who acts on the evening's rota tip once they've seen it a few nights running.
   * [round 6] Which evening tips (advice.ts) they act on: the rota tip as in round 5; the others once the tip has been
   * shown LEARNER_NOTICE_SHOWS evenings (GameState.adviceLog).
   */
  readsTips?: readonly AdviceKind[];
  /**
   * [round 10] Decor items to buy in order (one per DECORATOR_GAP_DAYS, only with `decorCash` left after paying), and
   * worn items are refreshed when the cash allows. Ids missing from the content pack are skipped.
   */
  decor?: readonly string[];
  decorCash?: number;
}

const TYPICAL: Strategy = { name: "typical", priceMult: 1, menuSize: 8, coverCash: 150_000, secondHireCash: 800_000, tableCash: 1_200_000, stockDays: 2.0, hireBy: "value", typical: true };

export const STRATEGIES: Record<StrategyName, Strategy> = {
  balanced: { name: "balanced", priceMult: 1, menuSize: 6, coverCash: 150_000, secondHireCash: 1_500_000, tableCash: 2_000_000, stockDays: 1.3, hireBy: "value" },
  // Round 2 review: cheap keeps its 0.85× prices but hires like balanced (it collapsed on its script, CONTENT-NOTES).
  cheap: { name: "cheap", priceMult: 0.85, menuSize: 6, coverCash: 150_000, secondHireCash: 2_500_000, tableCash: 3_000_000, stockDays: 1.1, hireBy: "value" },
  premium: { name: "premium", priceMult: 1.25, menuSize: 6, coverCash: 150_000, secondHireCash: 1_000_000, tableCash: 1_500_000, stockDays: 1.5, hireBy: "skill" },
  // The headline "normal" owner: hires cover late, over-orders, never trims the rota, ignores half the incidents.
  typical: TYPICAL,
  // Round 5 review: the typical owner who follows the evening's "trim the rota" tip (advice.ts) after noticing it.
  // Round 6: the typical owner who follows every evening tip (advice.ts eveningAdvice), and one variant per tip.
  learner: { ...TYPICAL, name: "learner", readsTips: ["rota", "overstock", "dog", "idleChef", "underpriced"] },
  "learner-rota": { ...TYPICAL, name: "learner-rota", readsTips: ["rota"] },
  "learner-overstock": { ...TYPICAL, name: "learner-overstock", readsTips: ["overstock"] },
  "learner-dog": { ...TYPICAL, name: "learner-dog", readsTips: ["dog"] },
  "learner-idleChef": { ...TYPICAL, name: "learner-idleChef", readsTips: ["idleChef"] },
  "learner-underpriced": { ...TYPICAL, name: "learner-underpriced", readsTips: ["underpriced"] },
  // Round 10: the typical owner who decorates over year 1 — a cosy kit, one piece a fortnight, refreshed when worn.
  decorator: {
    ...TYPICAL, name: "decorator", decorCash: 1_000_000,
    decor: ["light_lanterns", "seat_cushions", "sign_chalk", "table_gingham", "music_radio", "walls_stripes", "window_cakes", "plant_baskets", "floor_rugs"],
  },
  nohire: { name: "nohire", priceMult: 1, menuSize: 6, coverCash: Infinity, secondHireCash: Infinity, tableCash: 2_000_000, stockDays: 1.3, hireBy: "value", noHire: true },
};

export type Step = (s: GameState, cmd: Command) => GameState;

export function setUpMenu(content: ContentPack, state: GameState, strat: Strategy, step: Step): GameState {
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

/** Walk-outs per day over the last week above which another table is worth it. */
const BUSY_WALKOUTS = 4;

/** True when staffed days in the last week averaged more than BUSY_WALKOUTS walk-outs (owner days don't count). */
function isBusy(s: GameState): boolean {
  const recent = s.history.slice(-7).filter((h) => !h.ownerCovered?.length);
  return recent.length >= 4 && recent.reduce((a, h) => a + h.walkouts, 0) / recent.length > BUSY_WALKOUTS;
}

/** Owner-covered days before the typical player hires cover for that role. */
const TYPICAL_NOTICE_DAYS = 6;

export function staffing(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  if (strat.noHire) return s;
  let cur = s;
  for (const role of ["chef", "server"] as const) {
    const have = cur.staff.filter((x) => x.role === role).length;
    // A second of each role first covers the first one's days off (so the owner isn't left alone), then the weekend.
    // The typical player only notices after a few days of covering it themselves (it's in the evening copy).
    const noticed = !strat.typical || cur.history.filter((h) => h.ownerCovered?.includes(role)).length >= TYPICAL_NOTICE_DAYS;
    const want = cur.cash > strat.coverCash && noticed ? 2 : 1;
    if (have < want) cur = hireRole(content, cur, role, strat, step);
  }
  return cur;
}

/** The first hire's default days off (Mon, Tue); plus the weekend once cash allows. */
const COVER_ROTA = [true, true, false, false, false, false, false];
const COVER_PLUS_WEEKEND_ROTA = [true, true, false, false, true, true, true];

/** Mean daily profit over the last `days` (0 with no history). */
function recentProfit(s: GameState, days: number): number {
  const h = s.history.slice(-days);
  return h.length ? h.reduce((a, d) => a + d.profit, 0) / h.length : 0;
}

/**
 * The second of each role works the days the first has off, plus the weekend when the strategy can afford it
 * and the last fortnight was profitable; weekend shifts are dropped again after a losing fortnight
 * (a real owner trims the rota in slow months; REVIEW.md coordinator item 3).
 */
export function rotas(s: GameState, strat: Strategy, step: Step): GameState {
  let cur = s;
  const profit = recentProfit(cur, 14);
  for (const role of ["chef", "server"] as const) {
    const team = cur.staff.filter((x) => x.role === role);
    if (team.length < 2) continue;
    const second = team[1]!;
    const has = second.rota.join() === COVER_PLUS_WEEKEND_ROTA.join();
    // Round 5 review: the typical player never trims; the learner (typical + reads the evening tips) trims once the
    // "trim the rota" tip (advice.ts) has named this person for TYPICAL_NOTICE_DAYS evenings running.
    const weekend = strat.typical
      ? has ? !(reads(strat, "rota") && noticedRotaAdvice(cur, second.id)) : cur.cash > strat.secondHireCash && !(role === "chef" && keepsChefOff(cur, strat, second.id))
      : has ? profit >= 0 || cur.cash > strat.secondHireCash * 2 : cur.cash > strat.secondHireCash && profit > 0;
    const rota = weekend ? COVER_PLUS_WEEKEND_ROTA : COVER_ROTA;
    if (second.rota.join() !== rota.join()) cur = step(cur, { type: "SET_ROTA", staffId: second.id, rota });
  }
  return cur;
}

const reads = (strat: Strategy, kind: AdviceKind) => !!strat.readsTips?.includes(kind);

/** [round 6] Evenings a tip must have been shown before a learner acts on it. */
export const LEARNER_NOTICE_SHOWS = 2;

/** [round 6] The learner has seen tip `kind` at least LEARNER_NOTICE_SHOWS evenings; `lastNight` = it was last night's. */
function learnt(s: GameState, strat: Strategy, kind: AdviceKind, lastNight = false): boolean {
  const e = s.adviceLog?.[kind];
  return reads(strat, kind) && !!e && e.count >= LEARNER_NOTICE_SHOWS && (!lastNight || e.day === s.day - 1);
}

/** [round 6] Once the idle-chef tip named this chef, the learner leaves their extra days off until the room is busy. */
function keepsChefOff(s: GameState, strat: Strategy, staffId: string): boolean {
  return learnt(s, strat, "idleChef") && s.adviceLog!.idleChef!.subject === staffId && !isBusy(s);
}

/**
 * [round 6] The learner acts on last night's tip in the morning (planning commands): the dud comes off the menu, prices
 * go up, the idle chef's doubled days come off the rota — the same commands the Evening's button sends. Over-stock is a
 * lasting lesson instead (`stockDaysOf`), and the rota tip keeps its round-5 handling in `rotas`.
 */
export function followTips(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  if (!strat.readsTips?.length || s.phase !== "planning") return s;
  const kinds = (["dog", "idleChef", "underpriced"] as const).filter((k) => learnt(s, strat, k, true));
  if (!kinds.length) return s;
  let cur = s;
  for (const a of allAdvice(cur, content, kinds)) {
    if (a.subject !== cur.adviceLog?.[a.kind]?.subject) continue;
    for (const cmd of a.commands) cur = step(cur, cmd);
  }
  return cur;
}

/** [round 6] Days of stock the owner keeps: a learner who has seen the over-stock tip orders like the balanced script. */
export function stockDaysOf(s: GameState, strat: Strategy): number {
  return learnt(s, strat, "overstock") ? Math.min(strat.stockDays, STRATEGIES.balanced.stockDays) : strat.stockDays;
}

/** The rota advice has named this staff member on each of the last TYPICAL_NOTICE_DAYS evenings. */
function noticedRotaAdvice(s: GameState, staffId: string): boolean {
  const n = s.history.length;
  for (let k = 0; k < TYPICAL_NOTICE_DAYS; k++) if (rotaAdvice(s, n - k)?.staffId !== staffId) return false;
  return true;
}

/** Plates per cover the scripted owner plans for (one main plus some extras). */
const PLATES_PER_COVER = 1.8;

/** In the evening, orders tomorrow's needs from the busiest recent day (deliveries arrive next morning). */
export function restock(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  const recent = s.history.slice(-7).map((h) => h.covers + h.walkouts / 2);
  const covers = Math.max(30, ...recent);
  const active = s.menu.filter((m) => m.active).map((m) => content.dishes.find((d) => d.id === m.dishId)!);
  const platesPerDish = PLATES_PER_COVER / Math.max(1, active.length);
  const perCover: Record<string, number> = {};
  for (const d of active) for (const ing of d.ingredients) perCover[ing.id] = (perCover[ing.id] ?? 0) + ing.qty * platesPerDish;
  let cur = s;
  for (const [id, need] of Object.entries(perCover)) {
    const target = Math.ceil(need * covers * stockDaysOf(s, strat));
    const pending = cur.orders.filter((o) => o.ingredientId === id).reduce((a, o) => a + o.qty, 0);
    const have = stockQty(cur.stock, id) + pending;
    if (have < target) cur = step(cur, { type: "ORDER_STOCK", ingredientId: id, qty: target - Math.floor(have) });
  }
  return cur;
}

/** [round 10] Days between the decorator's purchases. */
export const DECORATOR_GAP_DAYS = 14;

/** [round 10] Evening: refresh one worn item, or buy the plan's next piece (strategies with `decor`). */
export function decorate(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  if (!strat.decor || !content.decor || (s.phase !== "evening" && s.phase !== "planning")) return s;
  const spare = s.cash - (strat.decorCash ?? 0);
  for (const slot of DECOR_SLOTS) {
    const it = installedDecor(content, s, slot);
    if (it?.bought && decorWear(it.item, it.since, s.day) !== "fresh" && it.item.refreshCost <= spare) return step(s, { type: "REFRESH_DECOR", slot });
  }
  if (s.decor?.pending?.length) return s;
  const last = Math.max(-Infinity, ...Object.values(s.decor?.slots ?? {}).map((x) => x?.since ?? -Infinity));
  if (s.day - last < DECORATOR_GAP_DAYS) return s;
  for (const id of strat.decor) {
    const item = findDecorItem(content, id);
    if (!item || installedDecor(content, s, item.slot)?.item.id === id) continue;
    return item.price <= spare ? step(s, { type: "BUY_DECOR", slot: item.slot, itemId: id }) : s;
  }
  return s;
}

export function buyTables(content: ContentPack, s: GameState, strat: Strategy, step: Step): GameState {
  if (isBusy(s) && s.cash > strat.tableCash && s.tables.length < content.balance.maxTables) return step(s, { type: "BUY_TABLE" });
  return s;
}

/** First choice that does not cost cash we don't have; otherwise the last (usually the cheap option). */
export function resolveEvent(content: ContentPack, s: GameState, step: Step): GameState {
  const ev = content.events.find((e) => e.id === s.activeEvent?.eventId);
  if (!ev) return s;
  const affordable = ev.choices.find((c) => (c.effects.cash ?? 0) >= 0 || s.cash + (c.effects.cash ?? 0) > 500_000);
  return step(s, { type: "RESOLVE_EVENT", choiceId: (affordable ?? ev.choices.at(-1)!).id });
}

/**
 * Incident policy for scripted owners: a fixed preference per kind (the free, "deal with it properly" option
 * first; the corner shop is the only paid option they take, and only with cash to spare). Never comps.
 */
export const INCIDENT_POLICY: Record<string, readonly string[]> = {
  sent_back: ["remake", "apologise"],
  spill: ["mop"],
  big_party: ["push", "decline"],
  rush: ["simplify", "ride"],
  supplier_short: ["shop", "pull"],
  equipment: ["fix"],
  vip: ["best"],
  staff_wobble: ["break"],
};

export function respondToIncidents(content: ContentPack, s: GameState, half = false): GameState {
  let cur = s;
  for (const inc of cur.incidents ?? []) {
    if (inc.resolution) continue;
    // A typical player misses about half: deterministic by the incident's sequence number.
    if (half && Number(inc.id.split("-").at(-1)) % 2 === 1) continue;
    for (const id of INCIDENT_POLICY[inc.kind] ?? []) {
      const opt = inc.options.find((o) => o.id === id);
      if (!opt || (opt.cost ?? 0) > cur.cash - 200_000) continue;
      const r = applyCommand(content, cur, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: opt.id });
      if ((r.state.incidents ?? []).find((i) => i.id === inc.id)?.resolution) {
        cur = r.state;
        break;
      }
    }
  }
  return cur;
}

/** One service, tick by tick, reacting to incidents as they start. */
export function playService(content: ContentPack, s0: GameState, react: boolean, half = false): GameState {
  let s = s0.phase === "planning" ? applyCommand(content, s0, { type: "START_SERVICE" }).state : s0;
  while (s.phase === "service") {
    if (react && (s.incidents ?? []).some((i) => !i.resolution)) s = respondToIncidents(content, s, half);
    s = tick(content, s).state;
  }
  return s;
}

/** applyCommand that keeps only the state (strategies ignore rejections). */
export const stepper = (content: ContentPack): Step => (s, cmd) => applyCommand(content, s, cmd).state;

/**
 * One scripted owner day from wherever `state` is: in planning it staffs, sets rotas, buys tables and plays the
 * service (reacting to incidents); in the evening it restocks and ends the day (an event is resolved). A state with an
 * empty menu gets the strategy's menu first. Returns the next morning's planning state (or gameover).
 */
export function runStrategyDay(content: ContentPack, state: GameState, strat: Strategy): GameState {
  const step = stepper(content);
  let s = state;
  if (s.phase === "planning") {
    if (s.menu.length === 0) s = setUpMenu(content, s, strat, step);
    s = staffing(content, s, strat, step);
    s = followTips(content, s, strat, step);
    s = rotas(s, strat, step);
    s = buyTables(content, s, strat, step);
  }
  if (s.phase === "planning" || s.phase === "service") s = playService(content, s, true, !!strat.typical);
  if (s.phase === "evening" || s.phase === "event") s = restock(content, s, strat, step);
  if (s.phase === "evening") s = decorate(content, s, strat, step);
  if (s.phase === "evening") s = step(s, { type: "END_DAY" });
  else if (s.phase === "event") s = resolveEvent(content, s, step);
  return s;
}

export interface RunResult {
  seed: number;
  survived: boolean;
  daysPlayed: number;
  monthEndCash: number[];
  covers: number[];
  ratings: number[];
  finalPopularity: number;
  /** [round 10] Prestige at the end of the run. */
  finalPrestige?: number;
  /** Final state (dropped when results cross a worker boundary). */
  final?: GameState;
  /** [round 11] First day the evening ended below the bank's overdraft line (the countdown chip appears), if ever. */
  firstBelowDay?: number;
  /** [round 11] Evenings that ended with the bank's last-days banner due (BANK_LAST_DAYS or fewer left). */
  lastDaysWarnings?: number;
}

/** [round 11] playOne options. `starterChef` opens with one chef hired (NEW_GAME.starterChef), as the game does. */
export interface PlayOptions { starterChef?: boolean }

export function playOne(content: ContentPack, seed: number, days: number, strat: Strategy, difficulty: Difficulty, opts: PlayOptions = {}): RunResult {
  const step: Step = (s, cmd) => applyCommand(content, s, cmd).state;
  const districtId = content.districts[seed % content.districts.length]!.id;
  let s = newGame(content, { type: "NEW_GAME", seed, districtId, restaurantName: "Headless", difficulty, ...(opts.starterChef ? { starterChef: true } : {}) });
  let firstBelowDay: number | undefined;
  let lastDaysWarnings = 0;
  s = setUpMenu(content, s, strat, step);
  const monthEndCash: number[] = [];
  const covers: number[] = [];
  const ratings: number[] = [];
  while (s.day < days && s.phase !== "gameover") {
    s = staffing(content, s, strat, step);
    s = followTips(content, s, strat, step);
    s = rotas(s, strat, step);
    s = buyTables(content, s, strat, step);
    s = playService(content, s, true, !!strat.typical);
    if (s.phase === "evening" || s.phase === "event") s = restock(content, s, strat, step);
    if (s.phase === "evening") s = decorate(content, s, strat, step);
    const h = s.history.at(-1);
    if (h) {
      covers.push(h.covers);
      if (h.covers) ratings.push(h.averageRating);
    }
    if ((s.day + 1) % DAYS_PER_MONTH === 0 && s.phase !== "gameover") monthEndCash.push(s.cash);
    if ((s.distressDays ?? 0) > 0) {
      firstBelowDay ??= s.day;
      if (INSOLVENCY_DAYS - (s.distressDays ?? 0) <= BANK_LAST_DAYS) lastDaysWarnings++;
    }
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") s = resolveEvent(content, s, step);
  }
  return {
    seed, survived: s.phase !== "gameover", daysPlayed: s.day, monthEndCash, covers, ratings, finalPopularity: s.reputation.popularity, finalPrestige: s.reputation.prestige, final: s,
    ...(firstBelowDay !== undefined ? { firstBelowDay } : {}), lastDaysWarnings,
  };
}
