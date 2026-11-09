import type { Command, ContentPack, DayResult, GameState, Goal, LogEntry, SimEvent } from "@full-plate/sim-core";
import type { CareerCommand, CareerTrack, OwnerStrategy } from "@full-plate/sim-career";
import type { EmpireCommand } from "@full-plate/sim-empire";
import type { StarsCommand } from "@full-plate/sim-stars";
import { applyCommand, asCommand, content, HOOKS, newGame, tick } from "../sim";
import { formatPence } from "../lib/format";
import { forkDue, handsOnCommands, initialMeta, type HandsOnMeta, type PathMeta } from "./paths";
import {
  careerCommand, careerIdleDay, careerMorning, careerNextDay, chooseEmpire, chooseStars, empireCommand, eveningHooks, focusSite,
  ownerApply, ownerResponds, packFor, setTastingMenu, snoozeFork, starsCommand, starsMorning, startCareer,
} from "./pathEngine";
import type { HandsOnResult } from "@full-plate/handson";

export type ToastTone = "bad" | "good" | "info";
export interface ToastMsg { id: number; text: string; tone: ToastTone }

/**
 * App-level state. `game` is the sim's GameState and is only ever replaced with the result of
 * newGame / applyCommand / tick. Everything else here is UI memory derived from SimEvents that
 * the GameState itself does not keep.
 */
export interface AppState {
  game: GameState | null;
  /** Ticker lines from LOG events during the current service (newest last). */
  ticker: LogEntry[];
  /** Ratings from CUSTOMER_PAID during the current service, for the live average. */
  ratings: { sum: number; count: number };
  /** Most recent SERVICE_ENDED result. Falls back to history[last] in the Evening screen. */
  lastResult: DayResult | null;
  /** Player-facing message: a refused command (tone "bad"), a goal reached ("good"), an incident at 4x ("info"). */
  toast: ToastMsg | null;
  /** Events from the last dispatch, for one-shot effects (coin pops on the canvas). */
  lastEvents: SimEvent[];
  /** Monotonic count of ticks applied in this session; animation clock for the canvas (not saved). */
  ticksRun: number;
  /**
   * Bumped on every INCIDENT_STARTED; `incidentId` is the newest one. The Service screen watches the
   * counter to auto-pause (1x/2x) or toast (4x) exactly once per incident.
   */
  incidentAlert: { seq: number; incidentId: string | null };
  /** Goals completed on the current day (GOAL_COMPLETED), so the Goals card can flash them. Reset when the day changes. */
  goalsJustDone: string[];
  /** Round 3: career, paths, fork, hands-on and endings (state/paths.ts). */
  meta: PathMeta;
}

export type AppAction =
  | { type: "new"; cmd: Extract<Command, { type: "NEW_GAME" }> }
  | { type: "load"; game: GameState; meta?: PathMeta }
  | { type: "newCareer"; seed: number; track: CareerTrack; strategy: OwnerStrategy; playerName: string; difficulty: GameState["difficulty"]; districtId?: string }
  | { type: "career"; cmd: CareerCommand }
  | { type: "empire"; cmd: EmpireCommand }
  | { type: "stars"; cmd: StarsCommand }
  | { type: "fork"; choice: "snooze" | "empire" | "stars"; brandName?: string }
  | { type: "focusSite"; siteId: string }
  | { type: "openGuide" }
  | { type: "dismissWin" }
  | { type: "seenHandover" }
  | { type: "nextDay" }
  | { type: "skipShift" }
  | { type: "handsOnStart"; meta: HandsOnMeta }
  | { type: "handsOnStop" }
  | { type: "handsOnResults"; results: HandsOnResult[] }
  | { type: "tastingMenu"; menuId: string | null }
  | { type: "command"; cmd: Command }
  | { type: "ticks"; n: number }
  | { type: "toast"; text: string; tone?: ToastTone }
  | { type: "dismissToast" }
  | { type: "quit" };

export const initialAppState: AppState = {
  game: null,
  ticker: [],
  ratings: { sum: 0, count: 0 },
  lastResult: null,
  toast: null,
  lastEvents: [],
  ticksRun: 0,
  incidentAlert: { seq: 0, incidentId: null },
  goalsJustDone: [],
  meta: initialMeta(),
};

const TICKER_MAX = 60;

function withToast(s: AppState, text: string, tone: ToastTone): AppState {
  return { ...s, toast: { id: (s.toast?.id ?? 0) + 1, text, tone } };
}

const TONE_KIND: Record<"good" | "bad" | "neutral", LogEntry["kind"]> = { good: "good", bad: "bad", neutral: "info" };

/** Fallback ticker kind when INCIDENT_RESOLVED has no `tone` (round-1/early round-2 sims): a guess from the text. */
export function incidentOutcomeKind(resolution: string, outcome: string): LogEntry["kind"] {
  if (resolution === "ignored") return "bad";
  return /\b(walked out|left|angry|furious|worse|lost|complain|bad review|upset|quit)\b/i.test(outcome) ? "bad" : "good";
}

function goalToastText(game: GameState | null, goalId: string, paid?: Goal["reward"]): string {
  const g = game?.goals?.find((x) => x.id === goalId);
  const reward = paid ?? g?.reward;
  const bits: string[] = [];
  if (reward?.cash) bits.push(`+${formatPence(reward.cash, { whole: true })}`);
  if (reward?.popularity) bits.push(`+${reward.popularity} popularity`);
  return `🎉 Goal complete${g ? `: ${g.title}` : "!"}${bits.length ? ` · ${bits.join(", ")}` : ""}`;
}

/** Folds sim events into UI memory. Exported for tests. */
export function absorb(s: AppState, events: SimEvent[]): AppState {
  if (!events.length) return { ...s, lastEvents: events };
  let { ticker, ratings, lastResult, incidentAlert, goalsJustDone } = s;
  let next = s;
  const logged = new Set(events.filter((e) => e.type === "LOG").map((e) => (e as Extract<SimEvent, { type: "LOG" }>).entry.text));
  for (const e of events) {
    switch (e.type) {
      case "LOG": ticker = [...ticker, e.entry]; break;
      case "CUSTOMER_PAID": ratings = { sum: ratings.sum + e.rating, count: ratings.count + 1 }; break;
      case "SERVICE_ENDED": lastResult = e.result; break;
      case "INCIDENT_STARTED": incidentAlert = { seq: incidentAlert.seq + 1, incidentId: e.incidentId }; break;
      case "INCIDENT_RESOLVED":
        // The sim may log the outcome itself; only add a line when it didn't.
        if (e.outcome && !logged.has(e.outcome)) {
          const g = s.game;
          const kind = e.tone ? TONE_KIND[e.tone] : incidentOutcomeKind(e.resolution, e.outcome);
          ticker = [...ticker, { day: g?.day ?? 0, tick: g?.tick ?? 0, text: e.outcome, kind }];
        }
        break;
      case "GOAL_COMPLETED":
        if (!goalsJustDone.includes(e.goalId)) goalsJustDone = [...goalsJustDone, e.goalId];
        next = withToast(next, goalToastText(s.game, e.goalId, e.reward), "good");
        break;
      default: break;
    }
  }
  if (ticker.length > TICKER_MAX) ticker = ticker.slice(-TICKER_MAX);
  return { ...next, ticker, ratings, lastResult, incidentAlert, goalsJustDone, lastEvents: events };
}

/** sim-core rejects a command with exactly one LOG of kind "bad"; other "bad" lines (e.g. auto-86 at open) go to the ticker. */
function rejection(events: SimEvent[]): string | null {
  const bad = events.filter((e): e is Extract<SimEvent, { type: "LOG" }> => e.type === "LOG" && e.entry.kind === "bad");
  return bad.length ? bad.map((e) => e.entry.text).join(" ") : null;
}

/** During service a refusal is a result made of exactly one LOG "bad" (legitimate service commands add other events too). */
function serviceRejection(events: SimEvent[]): string | null {
  const only = events.length === 1 ? events[0] : undefined;
  return only?.type === "LOG" && only.entry.kind === "bad" ? only.entry.text : null;
}

/**
 * After any transition: run the path layers' daily hooks. Entering an evening runs career/empire/stars once per day and
 * decides whether the fork card shows; entering a morning lets the career's AI owner plan and a Stars refit close the doors.
 */
function settle(s: AppState): AppState {
  const g0 = s.game;
  if (!g0) return s;
  let game = g0;
  let meta = s.meta;
  if (game.phase === "evening" || game.phase === "event" || game.phase === "gameover") {
    ({ game, meta } = eveningHooks(game, meta));
    if (!meta.fork.offered && forkDue(game, meta.fork, meta.mode === "career" && meta.career?.handover ? "owner" : meta.mode)) {
      meta = { ...meta, fork: { ...meta.fork, offered: true, firstOfferDay: meta.fork.firstOfferDay ?? game.day } };
    }
    if (meta.handsOn) meta = { ...meta, handsOn: undefined };
  } else if (game.phase === "planning" && meta.morningDay !== game.day) {
    ({ game, meta } = careerMorning(game, meta));
    game = starsMorning(game, meta);
    meta = { ...meta, morningDay: game.day };
  }
  if (game === g0 && meta === s.meta) return s;
  return { ...s, game, meta };
}

function rejectToast(s: AppState, why: string | undefined): AppState {
  return why ? withToast(s, why, "bad") : s;
}

export function appReducer(s: AppState, a: AppAction): AppState {
  const next = reduce(s, a);
  return next === s ? s : settle(next);
}

function reduce(s: AppState, a: AppAction): AppState {
  const pack: ContentPack = packFor(s.meta);
  switch (a.type) {
    case "new":
      return { ...initialAppState, game: newGame(content, a.cmd), meta: initialMeta("owner") };
    case "newCareer": {
      const r = startCareer(a);
      return { ...initialAppState, game: r.game, meta: r.meta };
    }
    case "load": {
      const meta = a.meta ?? initialMeta("owner");
      return { ...initialAppState, game: a.game, lastResult: a.game.history.at(-1) ?? null, meta: { ...meta, lastPathDay: Math.max(meta.lastPathDay, a.game.history.at(-1)?.day ?? -1) } };
    }
    case "quit":
      return initialAppState;
    case "toast":
      return withToast(s, a.text, a.tone ?? "info");
    case "dismissToast":
      return s.toast ? { ...s, toast: null } : s;
    case "command": {
      if (!s.game) return s;
      const before = s.game;
      const r = ownerApply(pack, before, s.meta, a.cmd);
      const res = { state: r.state, events: r.events };
      let next: AppState = { ...s, game: res.state, meta: r.meta };
      if (res.state.day !== before.day) next = { ...next, goalsJustDone: [] };
      if (a.cmd.type === "START_SERVICE" && res.state.phase === "service") {
        next = { ...next, ticker: [], ratings: { sum: 0, count: 0 }, toast: null, meta: { ...next.meta, shiftSummary: undefined } };
      } else {
        const why = before.phase === "service" && res.state.phase === "service" ? serviceRejection(res.events) : res.state.phase !== "service" ? rejection(res.events) : null;
        if (why) {
          next = withToast(next, why, "bad");
          // A refusal in service is a toast, not a ticker line.
          if (before.phase === "service") return { ...next, lastEvents: res.events };
        }
      }
      return absorb(next, res.events);
    }
    case "ticks": {
      if (!s.game || s.game.phase !== "service" || a.n <= 0) return s;
      let game = s.game;
      const events: SimEvent[] = [];
      let n = 0;
      // Stop early if the service ends mid-batch (phase changes to evening / event / gameover),
      // or as soon as an incident starts, so the UI can pause on the very tick it appeared.
      // An employee's owner answers incidents themselves, so career shifts don't stop for them.
      const career = s.meta.mode === "career" && !s.meta.career?.handover;
      while (n < a.n && game.phase === "service") {
        if (career) { const o = ownerResponds(game, s.meta); game = o.game; events.push(...o.events); }
        const res = tick(pack, game);
        game = res.state;
        events.push(...res.events);
        n++;
        if (!career && res.events.some((e) => e.type === "INCIDENT_STARTED")) break;
      }
      return absorb({ ...s, game, ticksRun: s.ticksRun + n }, events);
    }
    case "skipShift": {
      // "Skip to end of shift": run every remaining tick; the owner answers incidents (career) or they time out.
      if (!s.game || s.game.phase !== "service") return s;
      let game = s.game;
      const events: SimEvent[] = [];
      let n = 0;
      while (game.phase === "service" && n < 1000) {
        const o = ownerResponds(game, s.meta);
        game = o.game;
        events.push(...o.events);
        const res = tick(pack, game);
        game = res.state;
        events.push(...res.events);
        n++;
      }
      return absorb({ ...s, game, ticksRun: s.ticksRun + n, meta: { ...s.meta, handsOn: undefined } }, events);
    }
    case "handsOnStart": {
      if (!s.game || s.game.phase !== "service") return s;
      let game = s.game;
      if (HOOKS.handsOn) game = applyCommand(pack, game, asCommand({ type: "SET_HANDS_ON", role: a.meta.role })).state;
      return { ...s, game, meta: { ...s.meta, handsOn: a.meta } };
    }
    case "handsOnStop": {
      if (!s.game) return s;
      let game = s.game;
      if (HOOKS.handsOn && game.phase === "service") game = applyCommand(pack, game, asCommand({ type: "SET_HANDS_ON", role: null })).state;
      return { ...s, game, meta: { ...s.meta, handsOn: undefined } };
    }
    case "handsOnResults": {
      if (!s.game || s.game.phase !== "service" || !HOOKS.player || !a.results.length) return s;
      let game = s.game;
      const events: SimEvent[] = [];
      for (const cmd of handsOnCommands(a.results)) {
        const r = applyCommand(pack, game, cmd);
        // A rejected hands-on command (the session was a tick behind) is harmless: the session prunes its own marks.
        if (serviceRejection(r.events)) continue;
        game = r.state;
        events.push(...r.events);
      }
      return absorb({ ...s, game }, events);
    }
    case "nextDay": {
      // Evening → tomorrow. Employees: the AI owner closes the day. Owners: END_DAY (the event modal handles "event").
      if (!s.game) return s;
      const m = s.meta;
      if (m.mode === "career" && m.career && !m.career.handover) {
        if (m.career.employer.status !== "employed") {
          const r = careerIdleDay(s.game, m);
          return { ...s, meta: { ...r.meta, morningDay: undefined } };
        }
        const r = careerNextDay(s.game, m);
        return { ...s, game: r.game, meta: r.meta, goalsJustDone: [] };
      }
      return reduce(s, { type: "command", cmd: { type: "END_DAY" } });
    }
    case "career": {
      if (!s.game) return s;
      const r = careerCommand(s.game, s.meta, a.cmd);
      let next: AppState = { ...s, game: r.game, meta: r.meta };
      if (r.rejected) next = withToast(next, r.rejected, "bad");
      else if (a.cmd.type === "ACCEPT_OFFER" || a.cmd.type === "OPEN_OWN_PLACE") next = { ...next, meta: { ...next.meta, morningDay: undefined }, lastResult: null, ticker: [] };
      return next;
    }
    case "empire": {
      if (!s.game) return s;
      const r = empireCommand(s.game, s.meta, a.cmd);
      const bad = r.events.find((e) => e.kind === "rejected");
      return rejectToast({ ...s, game: r.game, meta: r.meta }, bad?.text);
    }
    case "focusSite": {
      if (!s.game) return s;
      const r = focusSite(s.game, s.meta, a.siteId);
      if ("error" in r) return withToast(s, r.error, "bad");
      return { ...s, game: r.game, meta: { ...r.meta, morningDay: r.game.day }, lastResult: null, ticker: [] };
    }
    case "stars": {
      if (!s.game) return s;
      const r = starsCommand(s.game, s.meta, a.cmd);
      const bad = r.events.find((e): e is Extract<typeof e, { type: "REJECTED" }> => e.type === "REJECTED");
      return rejectToast({ ...s, game: r.game, meta: r.meta }, bad?.reason);
    }
    case "tastingMenu": {
      if (!s.game) return s;
      const r = setTastingMenu(s.game, a.menuId);
      if (!r) return withToast(s, "Tasting menus need the sim's set-menu support (coming soon).", "info");
      const why = rejection(r.events);
      return why ? withToast(s, why, "bad") : { ...s, game: r.state };
    }
    case "fork": {
      if (!s.game) return s;
      const meta = a.choice === "snooze" ? snoozeFork(s.game, s.meta) : a.choice === "empire" ? chooseEmpire(s.game, s.meta, a.brandName) : chooseStars(s.game, s.meta);
      return { ...s, meta };
    }
    case "openGuide":
      return s.meta.pendingGuide ? { ...s, meta: { ...s.meta, pendingGuide: undefined } } : s;
    case "dismissWin":
      return s.meta.win ? { ...s, meta: { ...s.meta, win: { ...s.meta.win, dismissed: true } } } : s;
    case "seenHandover":
      return { ...s, meta: { ...s.meta, handoverSeen: true } };
  }
}

/** The pack the current game cooks with (exported for screens that call pure sim helpers). */
export const packOf = (s: AppState): ContentPack => packFor(s.meta);
