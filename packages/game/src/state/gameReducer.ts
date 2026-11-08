import type { Command, DayResult, GameState, LogEntry, SimEvent } from "@full-plate/sim-core";
import { applyCommand, content, newGame, tick } from "../sim";
import { formatPence } from "../lib/format";

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
}

export type AppAction =
  | { type: "new"; cmd: Extract<Command, { type: "NEW_GAME" }> }
  | { type: "load"; game: GameState }
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
};

const TICKER_MAX = 60;

function withToast(s: AppState, text: string, tone: ToastTone): AppState {
  return { ...s, toast: { id: (s.toast?.id ?? 0) + 1, text, tone } };
}

/** Ticker kind for a resolved incident: letting it time out is bad; a chosen option is good unless its outcome says otherwise. */
export function incidentOutcomeKind(resolution: string, outcome: string): LogEntry["kind"] {
  if (resolution === "ignored") return "bad";
  return /\b(walked out|left|angry|furious|worse|lost|complain|bad review|upset|quit)\b/i.test(outcome) ? "bad" : "good";
}

function goalToastText(game: GameState | null, goalId: string): string {
  const g = game?.goals?.find((x) => x.id === goalId);
  if (!g) return "🎉 Goal complete!";
  const bits: string[] = [];
  if (g.reward?.cash) bits.push(`+${formatPence(g.reward.cash, { whole: true })}`);
  if (g.reward?.popularity) bits.push(`+${g.reward.popularity} popularity`);
  return `🎉 Goal complete: ${g.title}${bits.length ? ` · ${bits.join(", ")}` : ""}`;
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
          ticker = [...ticker, { day: g?.day ?? 0, tick: g?.tick ?? 0, text: e.outcome, kind: incidentOutcomeKind(e.resolution, e.outcome) }];
        }
        break;
      case "GOAL_COMPLETED":
        if (!goalsJustDone.includes(e.goalId)) goalsJustDone = [...goalsJustDone, e.goalId];
        next = withToast(next, goalToastText(s.game, e.goalId), "good");
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

export function appReducer(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case "new":
      return { ...initialAppState, game: newGame(content, a.cmd) };
    case "load":
      return { ...initialAppState, game: a.game, lastResult: a.game.history.at(-1) ?? null };
    case "quit":
      return initialAppState;
    case "toast":
      return withToast(s, a.text, a.tone ?? "info");
    case "dismissToast":
      return s.toast ? { ...s, toast: null } : s;
    case "command": {
      if (!s.game) return s;
      const before = s.game;
      const res = applyCommand(content, before, a.cmd);
      let next: AppState = { ...s, game: res.state };
      if (res.state.day !== before.day) next = { ...next, goalsJustDone: [] };
      if (a.cmd.type === "START_SERVICE" && res.state.phase === "service") {
        next = { ...next, ticker: [], ratings: { sum: 0, count: 0 }, toast: null };
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
      while (n < a.n && game.phase === "service") {
        const res = tick(content, game);
        game = res.state;
        events.push(...res.events);
        n++;
        if (res.events.some((e) => e.type === "INCIDENT_STARTED")) break;
      }
      return absorb({ ...s, game, ticksRun: s.ticksRun + n }, events);
    }
  }
}
