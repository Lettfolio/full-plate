import type { Command, DayResult, DishId, GameState, LogEntry, SimEvent } from "@full-plate/sim-core";
import { applyCommand, content, newGame, tick } from "../sim";

/**
 * App-level state. `game` is the sim's GameState and is only ever replaced with the result of
 * newGame / applyCommand / tick. Everything else here is UI memory derived from SimEvents that
 * the GameState itself does not keep (see docs/UI-NOTES.md → contract gaps).
 */
export interface AppState {
  game: GameState | null;
  /** Ticker lines from LOG events during the current service (newest last). */
  ticker: LogEntry[];
  /** Ratings from CUSTOMER_PAID during the current service, for the live average. */
  ratings: { sum: number; count: number };
  /** Dishes 86'd this service (the contract has no state field for this). */
  eightySixed: DishId[];
  /** Most recent SERVICE_ENDED result. Falls back to history[last] in the Evening screen. */
  lastResult: DayResult | null;
  /** From GAME_OVER; GameState has no field for it. */
  gameOverReason: string | null;
  /** Events from the last dispatch, for one-shot effects (coin pops on the canvas). */
  lastEvents: SimEvent[];
  /** Monotonic count of ticks applied in this session; animation clock for the canvas. */
  ticksRun: number;
}

export type AppAction =
  | { type: "new"; cmd: Extract<Command, { type: "NEW_GAME" }> }
  | { type: "load"; game: GameState }
  | { type: "command"; cmd: Command }
  | { type: "ticks"; n: number }
  | { type: "quit" };

export const initialAppState: AppState = {
  game: null,
  ticker: [],
  ratings: { sum: 0, count: 0 },
  eightySixed: [],
  lastResult: null,
  gameOverReason: null,
  lastEvents: [],
  ticksRun: 0,
};

const TICKER_MAX = 60;

function absorb(s: AppState, events: SimEvent[]): AppState {
  if (!events.length) return { ...s, lastEvents: events };
  let { ticker, ratings, lastResult, gameOverReason } = s;
  for (const e of events) {
    switch (e.type) {
      case "LOG": ticker = [...ticker, e.entry]; break;
      case "CUSTOMER_PAID": ratings = { sum: ratings.sum + e.rating, count: ratings.count + 1 }; break;
      case "SERVICE_ENDED": lastResult = e.result; break;
      case "GAME_OVER": gameOverReason = e.reason; break;
      default: break;
    }
  }
  if (ticker.length > TICKER_MAX) ticker = ticker.slice(-TICKER_MAX);
  return { ...s, ticker, ratings, lastResult, gameOverReason, lastEvents: events };
}

export function appReducer(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case "new":
      return { ...initialAppState, game: newGame(content, a.cmd) };
    case "load":
      return { ...initialAppState, game: a.game, lastResult: a.game.history.at(-1) ?? null };
    case "quit":
      return initialAppState;
    case "command": {
      if (!s.game) return s;
      const res = applyCommand(content, s.game, a.cmd);
      let next: AppState = { ...s, game: res.state };
      if (a.cmd.type === "START_SERVICE" && res.state.phase === "service") {
        next = { ...next, ticker: [], ratings: { sum: 0, count: 0 }, eightySixed: [] };
      }
      if (a.cmd.type === "EIGHTY_SIX" && !next.eightySixed.includes(a.cmd.dishId)) {
        next = { ...next, eightySixed: [...next.eightySixed, a.cmd.dishId] };
      }
      return absorb(next, res.events);
    }
    case "ticks": {
      if (!s.game || s.game.phase !== "service" || a.n <= 0) return s;
      let game = s.game;
      const events: SimEvent[] = [];
      let n = 0;
      // Stop early if the service ends mid-batch (phase changes to evening / gameover).
      while (n < a.n && game.phase === "service") {
        const res = tick(content, game);
        game = res.state;
        events.push(...res.events);
        n++;
      }
      return absorb({ ...s, game, ticksRun: s.ticksRun + n }, events);
    }
  }
}
