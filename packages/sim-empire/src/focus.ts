/**
 * [round 11] The hands-on site's money and memory (EMPIRE-NOTES "Round 11 — C"). Pure helpers the game's pathEngine
 * calls when the player switches restaurants, closes a day or loads a save:
 *
 * - **The till is HQ's money.** A visited site opens with a float of a week's rent and wages plus a stocked larder,
 *   both paid by HQ (`openTill`); leaving a site sends its till (and tomorrow's paid-for deliveries) back to HQ, or HQ
 *   settles it when it is overdrawn (`settleTill`). "Sweep" leaves the same week's buffer (`sweepable`).
 * - **HQ backs the till** (`tillCover`): while the Empire runs, HQ covers the hands-on shop's overdraft each evening,
 *   so sim-core's bank countdown never starts while HQ can pay.
 * - **Parked sites are small** (`parkSite`/`restoreSite`/`pruneParked`): only the room, menu, crew, reputation, loan,
 *   decor and the last 90 trading days (without reviews), as an object; entries for closed or sold sites are dropped.
 */
import {
  dailyRent, deserialize, forecastNeeds, monthlyWages, seedState,
  type ContentPack, type DayResult, type GameState, type Stock,
} from "@full-plate/sim-core";
import { formatPounds } from "@full-plate/sim-core";
import * as K from "./constants";
import { applyEmpireCommand, newGameFromSite, recalibrateFromSite, spendable } from "./engine";
import { hqSinkingPerDay } from "./board";
import { Rng } from "./rng";
import type { EmpireCommand, EmpireEvent, EmpireState, SiteSummary } from "./types";

const pounds = formatPounds; // R11 review: the one formatter (D)

/** Trading days a parked site keeps: enough for recalibrateFromSite (it needs 14) and the charts. */
export const PARKED_HISTORY_DAYS = 90;
/** The till a branch keeps: this many days of rent and wages. */
export const TILL_BUFFER_DAYS = 7;

// ── money ──

/** A week's rent and wages for this restaurant (pence): the float a till opens with and what "Sweep" leaves behind. */
export function tillFloat(content: ContentPack, g: GameState): number {
  return Math.round(TILL_BUFFER_DAYS * dailyRent(content, g) + (monthlyWages(g) * TILL_BUFFER_DAYS) / 30);
}

/** Cash the player may move from the till to HQ without leaving it short (≥ 0). */
export function sweepable(content: ContentPack, g: GameState): number {
  return Math.max(0, g.cash - tillFloat(content, g));
}

/** What a stocked larder cost (pence, base unit costs: the batches newGameFromSite delivers carry no price). */
export function larderCost(content: ContentPack, stock: readonly Stock[]): number {
  let total = 0;
  for (const row of stock) total += row.qty * (content.ingredients.find((i) => i.id === row.ingredientId)?.unitCost ?? 0);
  return Math.round(total);
}

/** A branch's larder: the forecast's needs plus BRANCH_STOCK_DAYS' buffer, delivered yesterday. */
export function branchLarder(content: ContentPack, g: GameState): Stock[] {
  return forecastNeeds(content, g).map(({ ingredientId, need }) => {
    const qty = Math.ceil(need * K.BRANCH_STOCK_DAYS);
    return { ingredientId, qty, oldestDay: g.day - 1, batches: [{ qty, day: g.day - 1 }] };
  });
}

export type TillPlan =
  | { ok: true; cash: number; hqPays: number; float: number; larder: number; short: boolean }
  | { ok: false; reason: string; need: number; can: number };

/**
 * How HQ opens `g`'s till: the float plus the larder, from what HQ can spend. Short of that, a smaller float (at least
 * a day's costs) — or a refusal with the reason. `force` (moving on after a shop closed) always opens, with whatever
 * float is left after the larder (HQ pays the larder even into debt).
 */
export function openTill(content: ContentPack, e: EmpireState, g: GameState, force = false): TillPlan {
  const float = tillFloat(content, g);
  const larder = larderCost(content, g.stock);
  const can = Math.max(0, spendable(e));
  if (can >= float + larder) return { ok: true, cash: float, hqPays: float + larder, float, larder, short: false };
  const minFloat = Math.round(float / TILL_BUFFER_DAYS);
  if (can >= larder + minFloat || force) {
    const cash = Math.max(0, can - larder);
    return { ok: true, cash, hqPays: cash + larder, float, larder, short: true };
  }
  return { ok: false, need: float + larder, can, reason: `Head office can't open the till at ${g.restaurantName}: it needs ${pounds(float + larder)} (a week's rent and wages, and the food) and can spend ${pounds(can)}.` };
}

/** Tonight's top-up: how much of the till's overdraft HQ can cover (0 when the till is in credit or HQ can't spend). */
export function tillCover(e: EmpireState, g: GameState): number {
  if (e.status !== "running" || g.cash >= 0) return 0;
  return Math.min(-g.cash, Math.max(0, spendable(e)));
}

/** Leaving a site: its till plus tomorrow's paid-for deliveries go back to HQ (negative = HQ settles an overdraft). */
export function settleTill(g: GameState): number {
  return g.cash + g.orders.reduce((a, o) => a + o.cost, 0);
}

// ── HQ's health, for the UI ──

export interface EmpireOutcome {
  /** running: fine · sinking: HQ can't spend and loses money every day · bankrupt: the banks called the loans in. */
  status: "running" | "sinking" | "bankrupt";
  /** About how much HQ loses a day (pence, ≥ 0). */
  sinkPerDay: number;
  /** HQ's cash (pence). */
  hqCash: number;
  /** How far HQ is from the bank's line (pence): HQ goes bust below −HQ_CREDIT_LINE. */
  headroom: number;
}

export function empireOutcome(e: EmpireState): EmpireOutcome {
  const sinkPerDay = hqSinkingPerDay(e);
  const headroom = Math.round(e.hq.cash + K.HQ_CREDIT_LINE * e.hq.priceLevel);
  const status = e.status === "bankrupt" ? "bankrupt" : spendable(e) < 0 && sinkPerDay > 0 ? "sinking" : "running";
  return { status, sinkPerDay, hqCash: e.hq.cash, headroom };
}

// ── parking ──

/** A parked restaurant: what it takes to bring the site back as the player left it (not its till or larder). */
export interface ParkedSite {
  v: 1;
  restaurantName: string;
  history: DayResult[];
  menu: GameState["menu"];
  staff: GameState["staff"];
  tables: GameState["tables"];
  reputation: GameState["reputation"];
  loan: GameState["loan"];
  stats: GameState["stats"];
  decor?: GameState["decor"];
  setMenu?: GameState["setMenu"];
  ownerFatigue?: number;
}

/** A DayResult without the bulky per-guest and per-dish detail (reviews, incidents, perDish, perChef, spoiled, decor). */
export function slimDay(d: DayResult): DayResult {
  const { reviews: _r, incidents: _i, perDish: _p, perChef: _c, spoiled: _s, decor: _d, staffMoodDelta: _m, ...rest } = d;
  return { ...rest, reviews: [], staffMoodDelta: {} };
}

export function parkSite(g: GameState): ParkedSite {
  return {
    v: 1,
    restaurantName: g.restaurantName,
    history: g.history.slice(-PARKED_HISTORY_DAYS).map(slimDay),
    menu: g.menu,
    staff: g.staff,
    tables: g.tables.map((t) => ({ ...t, dirtyTicks: 0 })),
    reputation: g.reputation,
    loan: g.loan,
    stats: g.stats,
    ...(g.decor ? { decor: g.decor } : {}),
    ...(g.setMenu ? { setMenu: g.setMenu } : {}),
    ...(g.ownerFatigue !== undefined ? { ownerFatigue: g.ownerFatigue } : {}),
  };
}

/** An old save's parked entry (a whole serialised GameState) as a ParkedSite; undefined when it can't be read. */
export function asParked(entry: ParkedSite | string): ParkedSite | undefined {
  if (typeof entry !== "string") return entry && entry.v === 1 ? entry : undefined;
  try {
    return parkSite(deserialize(entry));
  } catch {
    return undefined;
  }
}

/**
 * Brings a parked site back: newGameFromSite (district, brand pull, a fresh larder, a fresh rng) with the parked
 * room, menu, crew, reputation, loan, decor and recent days laid over it. The till opens empty: openTill funds it.
 */
export function restoreSite(content: ContentPack, e: EmpireState, site: SiteSummary, parked: ParkedSite, rng: Rng, opts: { difficulty?: GameState["difficulty"] } = {}): GameState {
  const base = newGameFromSite(content, e, site, rng, { ...opts, cash: 0 });
  let g: GameState = {
    ...base,
    restaurantName: parked.restaurantName,
    history: parked.history,
    menu: parked.menu,
    staff: parked.staff,
    tables: parked.tables,
    reputation: parked.reputation,
    loan: parked.loan,
    stats: parked.stats,
    log: [{ day: base.day, tick: 0, text: `Back at ${parked.restaurantName}: same crew, same menu, a fresh delivery in the larder.`, kind: "info" }],
    ...(parked.decor ? { decor: parked.decor } : {}),
    ...(parked.setMenu ? { setMenu: parked.setMenu } : {}),
    ...(parked.ownerFatigue !== undefined ? { ownerFatigue: parked.ownerFatigue } : {}),
  };
  g = { ...g, stock: branchLarder(content, g) };
  return g;
}

/**
 * Drops parked entries the Empire can't return to (closed, sold or franchised sites, the focused one) and turns old
 * whole-GameState strings into ParkedSites. Returns the same object when nothing changes (old saves stay
 * byte-identical), and undefined for undefined.
 */
export function pruneParked(parked: Record<string, ParkedSite | string> | undefined, e: EmpireState): Record<string, ParkedSite> | undefined {
  if (!parked) return undefined;
  const keep = (id: string) => {
    const s = e.sites.find((x) => x.id === id);
    return !!s && s.status === "open" && s.ownership === "company" && e.focusedSiteId !== id;
  };
  const ids = Object.keys(parked);
  if (ids.every((id) => keep(id) && typeof parked[id] !== "string")) return parked as Record<string, ParkedSite>;
  const out: Record<string, ParkedSite> = {};
  for (const id of ids) {
    if (!keep(id)) continue;
    const p = asParked(parked[id]!);
    if (p) out[id] = p;
  }
  return out;
}

// ── switching (the game's FOCUS_SITE) ──

export type Parked = Record<string, ParkedSite | string>;
export interface Switched { game: GameState; empire: EmpireState; parked: Record<string, ParkedSite>; events: EmpireEvent[] }

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Applies commands in order, keeping the ones that aren't refused. */
function apply(content: ContentPack, e: EmpireState, cmds: readonly EmpireCommand[]): { empire: EmpireState; events: EmpireEvent[] } {
  let empire = e;
  const events: EmpireEvent[] = [];
  for (const cmd of cmds) {
    const r = applyEmpireCommand(content, empire, cmd);
    if (r.events.some((x) => x.kind === "rejected")) continue;
    empire = r.empire;
    events.push(...r.events);
  }
  return { empire, events };
}

/** The commands that hand a leaving till back to HQ (or have HQ settle it). */
const settleCmds = (g: GameState): EmpireCommand[] => {
  const back = settleTill(g);
  return back > 0 ? [{ type: "TRANSFER_FROM_FOCUSED", amount: back }] : back < 0 ? [{ type: "TRANSFER_TO_FOCUSED", amount: -back, why: "close" }] : [];
};

/**
 * Switches the hands-on restaurant to `siteId` (a company shop). The current one's till goes back to HQ (or HQ settles
 * its overdraft), the model is recalibrated on its history and it is parked (parkSite). The new site comes back from
 * its parked entry (restoreSite) or is newGameFromSite, and HQ funds its till (openTill) — or the switch is refused
 * with the reason. `force` (after a bust): the new site starts tomorrow and opens with whatever HQ can give.
 */
export function switchSite(content: ContentPack, e: EmpireState, game: GameState, parked0: Parked | undefined, siteId: string, opts: { force?: boolean } = {}): Switched | { error: string } {
  const site = e.sites.find((s) => s.id === siteId);
  if (!site || site.status !== "open") return { error: "Only an open site can be run hands-on." };
  if (site.ownership !== "company") return { error: `${site.name} belongs to its franchisee: you can only run your own company shops hands-on.` };
  const cur = e.focusedSiteId;
  let empire = e;
  let parked: Parked = pruneParked(parked0, e) ?? {};
  const cmds: EmpireCommand[] = [];
  if (cur) {
    if (game.history.filter((d) => d.covers > 0).length >= 14) empire = recalibrateFromSite(content, empire, cur, game.history, game);
    cmds.push(...settleCmds(game));
    parked = { ...parked, [cur]: parkSite(game) };
  }
  cmds.push({ type: "FOCUS_SITE", siteId });
  const moved = apply(content, empire, cmds);
  empire = moved.empire;
  const saved = parked[siteId] ? asParked(parked[siteId]!) : undefined;
  const { [siteId]: _back, ...others } = parked;
  const promoted = empire.sites.find((s) => s.id === siteId)!;
  const at = { ...empire, hq: { ...empire.hq, day: opts.force ? e.hq.day : game.day } };
  const rng = new Rng(seedState((game.seed ^ hashName(site.name)) >>> 0));
  const fresh = saved
    ? restoreSite(content, at, promoted, saved, rng, { difficulty: game.difficulty })
    : newGameFromSite(content, at, promoted, rng, { difficulty: game.difficulty, cash: 0 });
  const plan = openTill(content, empire, fresh, opts.force);
  if (!plan.ok) return { error: plan.reason };
  const paid = apply(content, empire, [{ type: "TRANSFER_TO_FOCUSED", amount: plan.hqPays, why: "float" }]);
  return { game: { ...fresh, cash: plan.cash }, empire: paid.empire, parked: pruneParked(others, paid.empire) ?? {}, events: [...moved.events, ...paid.events] };
}

/**
 * "Close this shop and move on" (the hands-on shop went bust and HQ couldn't save it): HQ settles the till, the shop
 * closes, and the busiest other company shop opens hands-on tomorrow. Refused when there is none.
 */
export function closeAndMoveOn(content: ContentPack, e: EmpireState, game: GameState, parked: Parked | undefined): Switched | { error: string } {
  const cur = e.focusedSiteId;
  const next = e.sites
    .filter((s) => s.status === "open" && s.ownership === "company" && s.id !== cur)
    .sort((a, b) => b.revenueYear - a.revenueYear || a.id.localeCompare(b.id))[0];
  if (!next) return { error: "There's no other shop of your own to run." };
  const closed = cur ? apply(content, e, [...settleCmds(game), { type: "CLOSE_SITE", siteId: cur }]) : { empire: e, events: [] };
  const r = switchSite(content, closed.empire, { ...game, cash: 0, orders: [] }, pruneParked(parked, closed.empire), next.id, { force: true });
  return "error" in r ? r : { ...r, events: [...closed.events, ...r.events] };
}

/**
 * HQ backs the hands-on till: covers tonight's overdraft as far as it can ("HQ topped up the till £X"); a till that
 * ends at or above zero clears the bank's countdown and comes back from a bank game over.
 */
export function backTill(content: ContentPack, e: EmpireState, game: GameState): { game: GameState; empire: EmpireState; events: EmpireEvent[] } {
  const site = e.focusedSiteId ? e.sites.find((s) => s.id === e.focusedSiteId) : undefined;
  if (!site || site.ownership !== "company") return { game, empire: e, events: [] };
  const cover = tillCover(e, game);
  const r = cover > 0 ? apply(content, e, [{ type: "TRANSFER_TO_FOCUSED", amount: cover, why: "topUp" }]) : { empire: e, events: [] };
  let g = r.empire === e ? game : { ...game, cash: game.cash + cover };
  if (g.cash >= 0 && (g.distressDays ?? 0) > 0) g = { ...g, distressDays: 0 };
  if (g.cash >= 0 && g.phase === "gameover") {
    const { gameOverReason: _why, ...rest } = g;
    g = { ...rest, distressDays: 0, phase: rest.activeEvent ? "event" : "evening" };
  }
  return { game: g, empire: r.empire, events: r.events };
}
