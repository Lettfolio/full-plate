/**
 * The path layers' daily wiring, as pure functions over (GameState, PathMeta). The reducer calls these; nothing here
 * touches React. See docs/UI-NOTES.md "Round 3" for the order of calls each day.
 *
 * - Career (CAREER-NOTES): beginCareerDay in planning → START_SERVICE → owner incident responses per tick →
 *   stepCareerDay in the evening → finishCareerDay on "Next day".
 * - Empire (EMPIRE-NOTES): stepEmpireDay(content, empire, history.at(-1)) each evening.
 * - Stars (STARS-NOTES): prepareService in the morning; cook with withSignatures; stepStarsDay + applyStarsEffects in
 *   the evening; FIRE on HEAD_CHEF_LEFT.
 */
import { Rng, seedState, type Command, type ContentPack, type DayResult, type GameState, type SimEvent } from "@full-plate/sim-core";
import {
  applyCareerCommand, applyWithPerks, beginCareerDay, finishCareerDay, handoverToOwner, newCareer, ownerIncidentResponses,
  stepCareerDay, type CareerCommand, type CareerEvent, type CareerTrack, type OwnerStrategy,
} from "@full-plate/sim-career";
import {
  applyEmpireCommand, forkFromGameState, newGameFromSite, recalibrateFromSite, siteBrandPull, stepEmpireDay, BRAND_PULL_SOURCE, EMPIRE,
  type EmpireCommand, type EmpireEvent,
} from "@full-plate/sim-empire";
import {
  applyStarsCommand, applyStarsEffects, closedDay, isClosed, newStarsState, prepareService, stepStarsDay, withSignatures,
  type StarsCommand, type StarsEvent,
} from "@full-plate/sim-stars";
import { applyCommand, asCommand, careerContent, content, extras, HOOKS, recruitmentFeeOf, serialize, deserialize } from "../sim";
import { fill } from "@full-plate/content";
import { FORK_SNOOZE_DAYS, type PathMeta, type WinMeta, initialMeta } from "./paths";

const EMPIRE_EVENTS_MAX = 80;

/** The pack the sim cooks with for this game: the career's library pack, or the full pack with Stars signatures. */
export function packFor(meta: PathMeta): ContentPack {
  if (meta.mode === "career" && !meta.career?.handover) return careerContent;
  return meta.stars ? withSignatures(content, meta.stars) : content;
}

// ───────────────────────── career ─────────────────────────
export function startCareer(opts: { seed: number; track: CareerTrack; strategy: OwnerStrategy; playerName: string; difficulty: GameState["difficulty"]; districtId?: string; look?: number }) {
  const g = newCareer(careerContent, { seed: opts.seed, track: opts.track, strategy: opts.strategy, playerName: opts.playerName, difficulty: opts.difficulty, ...(opts.districtId ? { districtId: opts.districtId } : {}), ...(opts.look !== undefined ? { look: opts.look } : {}) });
  return { game: g.state, meta: { ...initialMeta("career"), career: g.career } satisfies PathMeta };
}

const careerLive = (meta: PathMeta) => meta.mode === "career" && !!meta.career && !meta.career.handover;

/** Morning: sync the player and let the AI owner plan. Idempotent per day (the reducer calls it once). */
export function careerMorning(game: GameState, meta: PathMeta): { game: GameState; meta: PathMeta } {
  if (!careerLive(meta) || game.phase !== "planning") return { game, meta };
  const r = beginCareerDay(careerContent, { career: meta.career!, state: game });
  return { game: r.game.state, meta: { ...meta, career: r.game.career, ownerMorning: r.ownerCommands } };
}

/** During an employee's service: the owner deals with live incidents (CAREER-NOTES "Incidents belong to the owner"). */
export function ownerResponds(game: GameState, meta: PathMeta): { game: GameState; events: SimEvent[] } {
  if (!careerLive(meta) || game.phase !== "service" || !(game.incidents ?? []).some((i) => !i.resolution)) return { game, events: [] };
  let g = game;
  const events: SimEvent[] = [];
  for (const cmd of ownerIncidentResponses(careerContent, meta.career!.owner.strategy, g)) {
    const r = applyCommand(careerContent, g, cmd);
    g = r.state;
    events.push(...r.events);
  }
  return { game: g, events };
}

export function careerCommand(game: GameState, meta: PathMeta, cmd: CareerCommand): { game: GameState; meta: PathMeta; events: CareerEvent[]; rejected?: string } {
  if (!meta.career) return { game, meta, events: [] };
  const r = applyCareerCommand(careerContent, { career: meta.career, state: game }, cmd);
  let next: PathMeta = { ...meta, career: r.game.career, careerEvents: [...meta.careerEvents, ...r.events] };
  let g = r.game.state;
  const opened = r.events.find((e): e is Extract<CareerEvent, { type: "OPENED_OWN_PLACE" }> => e.type === "OPENED_OWN_PLACE");
  if (opened) {
    // The career is over: g is the player's own restaurant. Apply the perks sim-core can now take directly.
    g = applyOwnerProfile(g, meta.career);
    next = { ...next, handover: opened.summary, handoverSeen: false, ownerPerks: r.game.career.ownerPerks, ownerCommands: [], ownerMorning: [], lastPathDay: -1 };
  }
  return { game: g, meta: next, events: r.events, ...(r.rejected ? { rejected: r.rejected } : {}) };
}

/** Preview of "Open my own place" (pure; the planning panel shows it). */
export const handoverPreview = (game: GameState, meta: PathMeta, districtId?: string) =>
  meta.career ? handoverToOwner(careerContent, meta.career, game, districtId ? { districtId } : {}) : undefined;

/**
 * Handover perks that need a sim-core hook: the owner covers shifts with the player's own skills (SET_OWNER_PROFILE),
 * and a manager's contacts make hiring cheaper (GameState.recruitmentFee instead of the applyWithPerks rebate).
 */
export function applyOwnerProfile(game: GameState, career: NonNullable<PathMeta["career"]>): GameState {
  let g = game;
  if (HOOKS.ownerProfile) {
    const r = applyCommand(content, g, asCommand({ type: "SET_OWNER_PROFILE", skill: Math.round(career.stats.skill), speed: Math.round(career.stats.speed), charm: Math.round(career.stats.charm) }));
    g = r.state;
  }
  // Cheaper hiring: a per-game fee replaces the applyWithPerks rebate wrapper (the rebate applies to every hire, not just 3).
  if (HOOKS.recruitmentFee && career.ownerPerks && career.ownerPerks.hireRebatesLeft > 0) {
    g = { ...g, recruitmentFee: Math.max(0, recruitmentFeeOf(g) - career.ownerPerks.hireRebateEach) };
  }
  return g;
}

/** A command on the player's own restaurant after a handover: HIRE goes through applyWithPerks while rebates last. */
export function ownerApply(pack: ContentPack, game: GameState, meta: PathMeta, cmd: Command): { state: GameState; events: SimEvent[]; meta: PathMeta } {
  if (cmd.type === "HIRE" && meta.ownerPerks && meta.ownerPerks.hireRebatesLeft > 0 && !HOOKS.recruitmentFee) {
    const r = applyWithPerks(pack, game, meta.ownerPerks, cmd);
    return { state: r.state, events: r.events, meta: { ...meta, ownerPerks: r.perks } };
  }
  const r = applyCommand(pack, game, cmd);
  return { state: r.state, events: r.events, meta };
}

// ───────────────────────── the fork ─────────────────────────
export function snoozeFork(game: GameState, meta: PathMeta): PathMeta {
  return { ...meta, fork: { ...meta.fork, offered: false, snoozeUntil: game.day + FORK_SNOOZE_DAYS } };
}

/** Trading days sim-empire's calibration needs before the fork can model the flagship. */
export const MIN_FORK_TRADING_DAYS = 14;

export function chooseEmpire(game: GameState, meta: PathMeta, brandName?: string): PathMeta {
  if (game.history.filter((d) => d.covers > 0).length < MIN_FORK_TRADING_DAYS) return meta;
  const empire = forkFromGameState(content, game, { brandName: brandName?.trim() || `${game.restaurantName} Kitchen` });
  return { ...meta, empire, empireEvents: [], fork: { ...meta.fork, offered: false, chosen: "empire", chosenDay: game.day } };
}

export function chooseStars(game: GameState, meta: PathMeta): PathMeta {
  const stars = newStarsState(content, game);
  return { ...meta, stars, starsEvents: [], fork: { ...meta.fork, offered: false, chosen: "stars", chosenDay: game.day } };
}

// ───────────────────────── Empire ─────────────────────────
export function empireCommand(game: GameState, meta: PathMeta, cmd: EmpireCommand): { game: GameState; meta: PathMeta; events: EmpireEvent[] } {
  if (!meta.empire) return { game, meta, events: [] };
  let g = game;
  if (cmd.type === "TRANSFER_FROM_FOCUSED") {
    // Round 11 (G14): a finite amount, no more than the till holds (Infinity used to move the whole till).
    if (!Number.isFinite(cmd.amount) || Math.round(cmd.amount) > game.cash) return { game, meta, events: [{ day: meta.empire.hq.day, kind: "rejected", text: "The till doesn't hold that much.", tone: "bad" }] };
    const amount = Math.min(Math.round(cmd.amount), Math.max(0, game.cash));
    if (amount <= 0) return { game, meta, events: [{ day: meta.empire.hq.day, kind: "rejected", text: "There's no spare cash in the till to move.", tone: "bad" }] };
    cmd = { ...cmd, amount };
    g = { ...game, cash: game.cash - amount };
  }
  const r = applyEmpireCommand(content, meta.empire, cmd);
  if (r.events.some((e) => e.kind === "rejected")) return { game, meta: { ...meta, empireEvents: trimEvents([...meta.empireEvents, ...r.events]) }, events: r.events };
  return { game: g, meta: { ...meta, empire: r.empire, empireEvents: trimEvents([...meta.empireEvents, ...r.events]) }, events: r.events };
}

const trimEvents = (evs: EmpireEvent[]) => evs.filter((e) => e.kind !== "rent_review").slice(-EMPIRE_EVENTS_MAX);

/**
 * FOCUS_SITE switching. The current restaurant is parked (serialised) and the model is recalibrated on its history
 * and GameState; the new site gets a parked GameState if it has been run before, else sim-empire's newGameFromSite:
 * its district, the brand menu, the brand's box of tables, a locally hired crew of its staff quality and the brand
 * pull as a footfall mod (round 3: it used to copy the flagship's staff).
 */
export function focusSite(game: GameState, meta: PathMeta, siteId: string): { game: GameState; meta: PathMeta } | { error: string } {
  const e = meta.empire;
  if (!e) return { error: "No empire." };
  if (game.phase !== "planning") return { error: "Switch restaurants in the morning." };
  const cur = e.focusedSiteId;
  if (cur === siteId) return { game, meta };
  const site = e.sites.find((s) => s.id === siteId);
  if (!site || site.status !== "open") return { error: "Only an open site can be run hands-on." };
  let empire = e;
  if (cur && game.history.filter((d) => d.covers > 0).length >= 14) empire = recalibrateFromSite(content, empire, cur, game.history, game);
  empire = applyEmpireCommand(content, empire, { type: "FOCUS_SITE", siteId }).empire;
  const parked = { ...(meta.parked ?? {}), ...(cur ? { [cur]: serialize(game) } : {}) };
  let next: GameState;
  const saved = parked[siteId];
  if (saved) {
    next = { ...deserialize(saved), day: game.day };
    delete parked[siteId];
  } else {
    const promoted = empire.sites.find((s) => s.id === siteId)!;
    next = newGameFromSite(content, { ...empire, hq: { ...empire.hq, day: game.day } }, promoted, new Rng(seedState((game.seed ^ hashName(site.name)) >>> 0)), { difficulty: game.difficulty });
  }
  return { game: next, meta: { ...meta, empire, parked } };
}

/** Evening: keep a promoted site's "brand" footfall mod in step with the empire (recognition, saturation, effects). */
export function refreshBrandPull(game: GameState, empire: PathMeta["empire"]): GameState {
  const id = empire?.focusedSiteId;
  if (!empire || !id) return game;
  const pull = Math.round(siteBrandPull(content, empire, id) * 1000) / 1000;
  const has = game.footfallMods.find((m) => m.source === BRAND_PULL_SOURCE);
  if (has && has.mult === pull) return game;
  const others = game.footfallMods.filter((m) => m.source !== BRAND_PULL_SOURCE);
  return { ...game, footfallMods: Math.abs(pull - 1) > 0.005 ? [...others, { mult: pull, daysRemaining: EMPIRE.BRAND_PULL_DAYS, source: BRAND_PULL_SOURCE }] : others };
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ───────────────────────── Stars ─────────────────────────
export function starsCommand(game: GameState, meta: PathMeta, cmd: StarsCommand): { meta: PathMeta; events: StarsEvent[]; game: GameState } {
  if (!meta.stars) return { meta, events: [], game };
  const r = applyStarsCommand(content, meta.stars, cmd, { day: game.day, cash: game.cash, state: game });
  let g = game;
  for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId) g = applyCommand(content, g, { type: "FIRE", staffId: e.staffId }).state;
  // Costs are booked to the ledger; pay them now so the header's cash is honest.
  let stars = r.stars;
  if (!r.events.some((e) => e.type === "REJECTED") && stars.ledger.pendingCash !== 0) {
    g = { ...g, cash: g.cash + stars.ledger.pendingCash };
    stars = { ...stars, ledger: { ...stars.ledger, pendingCash: 0 } };
  }
  const ending = r.events.find((e): e is Extract<StarsEvent, { type: "ENDING" }> => e.type === "ENDING");
  return { meta: { ...meta, stars, starsEvents: [...meta.starsEvents, ...r.events], ...(ending ? { win: starsWin(ending.ending, game) } : {}) }, events: r.events, game: g };
}

/** Morning: a refit closes the restaurant. CLOSE_TODAY when sim-core has it, else the ×0-footfall fallback. */
export function starsMorning(game: GameState, meta: PathMeta): GameState {
  if (!meta.stars || game.phase !== "planning") return game;
  // With CLOSE_TODAY the Planning screen closes the doors itself (and un-rosters staff first); the ×0-footfall
  // fallback is only for the ending (the restaurant is shut for good) or a sim without the hook.
  if (HOOKS.closeToday && !meta.stars.ending) return game;
  return prepareService(game, meta.stars);
}

export const starsClosedToday = (game: GameState, meta: PathMeta) => !!meta.stars && isClosed(meta.stars, game.day);

/** Set (or clear) a tasting menu from extras.tastingMenus via SET_SET_MENU. Returns undefined when sim-core lacks it. */
export function setTastingMenu(game: GameState, menuId: string | null): { state: GameState; events: SimEvent[] } | undefined {
  if (!HOOKS.setMenu) return undefined;
  const m = menuId ? extras.tastingMenus.find((t) => t.id === menuId) : undefined;
  const cmd = m
    ? { type: "SET_SET_MENU" as const, dishIds: m.courses.map((c) => c.dishId), price: m.pricePerHead, active: true }
    : { type: "SET_SET_MENU" as const, dishIds: game.setMenu?.dishIds ?? [], price: game.setMenu?.price ?? 0, active: false };
  return applyCommand(content, game, asCommand(cmd));
}

function starsWin(ending: { kind: "dynasty" | "el_bulli" | "handed_back"; day: number; win: boolean; text: string }, game: GameState): WinMeta {
  const key = ending.kind === "el_bulli" ? "elBulli" : ending.kind === "dynasty" ? "dynasty" : "handedBack";
  const t = extras.criticText.endings[key];
  const chef = game.staff.filter((s) => s.role === "chef").sort((a, b) => b.skill - a.skill)[0]?.name ?? "the chef";
  return {
    kind: ending.kind,
    won: ending.win,
    day: ending.day,
    title: t.title,
    text: t.body.map((line) => fill(line, { restaurant: game.restaurantName, chef })),
  };
}

// ───────────────────────── the evening ─────────────────────────
/**
 * Runs once per played day when service closes (phase evening/event/gameover). Career: stepCareerDay and keep the
 * owner's closing commands. Empire: stepEmpireDay. Stars: stepStarsDay + applyStarsEffects (+ FIRE on HEAD_CHEF_LEFT).
 */
export function eveningHooks(game: GameState, meta: PathMeta): { game: GameState; meta: PathMeta } {
  const result: DayResult | undefined = game.history.at(-1);
  if (!result || meta.lastPathDay >= result.day) return { game, meta };
  let g = game;
  let m: PathMeta = { ...meta, lastPathDay: result.day };

  if (careerLive(m)) {
    // A shift the player played hands-on today (reset at START_SERVICE; only counts if they scored anything).
    const sum = m.shiftSummary;
    const played = sum && sum.points > 0
      ? { stars: sum.stars, points: sum.points, meanQuality: sum.meanQuality, plates: sum.role === "server" ? sum.served : sum.plates }
      : undefined;
    const r = stepCareerDay(careerContent, m.career!, g, result, played);
    m = { ...m, career: r.career, careerEvents: [...r.events], ownerCommands: r.nextOwnerCommands };
  }

  if (m.empire && m.empire.status === "running") {
    const r = stepEmpireDay(content, m.empire, result);
    m = { ...m, empire: r.empire, empireEvents: trimEvents([...m.empireEvents, ...r.events]) };
    g = refreshBrandPull(g, r.empire);
    if (r.empire.win.achieved && !m.win) {
      const meals = r.empire.win.reason === "meals";
      m = {
        ...m,
        win: {
          kind: meals ? "empire_meals" : "empire_regions", won: true, day: r.empire.win.achievedDay ?? result.day,
          title: meals ? "A billion served" : "Everywhere",
          text: meals
            ? [`${r.empire.brand.name} has served a billion meals.`, "From one scruffy kitchen to a name on every high street. Not bad at all."]
            : [`${r.empire.brand.name} is known and profitable in every region of the map.`, "Somewhere, right now, someone is ordering your food for the very first time."],
        },
      };
    }
  }

  if (m.stars) {
    const cooking = withSignatures(content, m.stars);
    // A 0-cover night that was not CLOSE_TODAY goes in as itself: a stock-out is a failed service (sim-stars SHORT_MENU).
    const r = stepStarsDay(cooking, m.stars, result.closed ? closedDay(result.day) : result, g);
    const fx = applyStarsEffects(g, r.stars);
    g = fx.state;
    let stars = fx.stars;
    for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId) g = applyCommand(content, g, { type: "FIRE", staffId: e.staffId }).state;
    const guide = r.events.find((e): e is Extract<StarsEvent, { type: "GUIDE_DAY" }> => e.type === "GUIDE_DAY");
    const ending = r.events.find((e): e is Extract<StarsEvent, { type: "ENDING" }> => e.type === "ENDING");
    m = {
      ...m,
      stars,
      starsEvents: r.events,
      ...(guide ? { pendingGuide: { result: guide.result, visits: guide.visits } } : {}),
      ...(ending && !m.win ? { win: starsWin(ending.ending, g) } : {}),
    };
    stars = m.stars!;
  }
  return { game: g, meta: m };
}

/** "Next day" for an employee: the AI owner's evening commands (stock, then END_DAY or the event answer). */
export function careerNextDay(game: GameState, meta: PathMeta): { game: GameState; meta: PathMeta } {
  if (!careerLive(meta)) return { game, meta };
  const g = finishCareerDay(careerContent, { career: meta.career!, state: game }, meta.ownerCommands);
  return { game: g.state, meta: { ...meta, career: g.career, ownerCommands: [], careerEvents: [] } };
}

/** An employee out of work (fired / employer closed): one idle day (offers + living costs), no service. */
export function careerIdleDay(game: GameState, meta: PathMeta): { game: GameState; meta: PathMeta } {
  if (!meta.career || meta.career.handover || meta.career.employer.status === "employed") return { game, meta };
  const last = game.history.at(-1) ?? closedDay(game.day);
  const r = stepCareerDay(careerContent, meta.career, game, last);
  return { game, meta: { ...meta, career: r.career, careerEvents: r.events } };
}
