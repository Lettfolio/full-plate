/** @full-plate/sim-core public API. Pure functions over (content, state). */
import { dispatch } from "./commands";
import { tickService } from "./engine";
import { candidates as candidatePool } from "./staff";
import { classifyMenu as classify } from "./menu";
import { newGame as createGame } from "./newGame";
import { deserialize as load, serialize as save } from "./save";
import type { Candidate, Command, ContentPack, DishId, GameState, MenuQuadrant, SimEvent, StepResult } from "./types";
import { SERVICE_TICKS } from "./types";

export function newGame(content: ContentPack, cmd: Extract<Command, { type: "NEW_GAME" }>): GameState {
  return createGame(content, cmd);
}

/** Applies a player command. Invalid commands leave state unchanged and emit a LOG "bad" event. */
export function applyCommand(content: ContentPack, state: GameState, cmd: Command): StepResult {
  return dispatch(content, state, cmd);
}

/** Advances one service tick (no-op outside service). The final tick closes service and runs the evening. */
export function tick(content: ContentPack, state: GameState): StepResult {
  return tickService(content, state);
}

/** Convenience: START_SERVICE (if in planning) → all ticks → evening/event/gameover. */
export function runDay(content: ContentPack, state: GameState): StepResult {
  const events: SimEvent[] = [];
  let cur = state;
  if (cur.phase === "planning") {
    const r = dispatch(content, cur, { type: "START_SERVICE" });
    cur = r.state;
    events.push(...r.events);
  }
  for (let i = 0; i <= SERVICE_TICKS && cur.phase === "service"; i++) {
    const r = tickService(content, cur);
    cur = r.state;
    for (const e of r.events) events.push(e);
  }
  return { state: cur, events };
}

export function candidates(content: ContentPack, state: GameState): Candidate[] {
  return candidatePool(content, state);
}

export function classifyMenu(content: ContentPack, state: GameState): Record<DishId, MenuQuadrant> {
  return classify(content, state);
}

export function serialize(state: GameState): string {
  return save(state);
}

export function deserialize(json: string): GameState {
  return load(json);
}

export * from "./types";

/**
 * Calendar and price constants the UI needs to show before the player acts.
 * (Re-exported from constants.ts; values stay owned by sim-core.)
 */
export {
  COURSE_ORDER_CHANCE,
  DAYS_PER_MONTH,
  EMPLOYER_ONCOST,
  HIRE_CASH_BUFFER_SHIFTS,
  MAX_MENU_ITEMS,
  MONTHS_PER_YEAR,
  RECRUITMENT_FEE,
  SHIFT_HOURS,
  START_MONTH,
  START_WEEKDAY,
  TABLE_COST,
  WEEKEND_DAYS,
} from "./constants";
/** Calendar helpers: month 1-12, weekday 0 = Monday (rota index), weekend footfall days. */
export { isWeekend, monthOf, weekdayOf } from "./util";
/** Cost of one rostered shift for a staff member (wage × SHIFT_HOURS × (1 + EMPLOYER_ONCOST)). */
export { shiftCost } from "./systems/finance";
