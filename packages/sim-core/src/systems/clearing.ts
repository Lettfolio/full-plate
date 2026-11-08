/**
 * ClearingSystem — frees tables of parties that paid this tick (they become dirty),
 * counts down dirty tables (a porter halves the work), drops tickets for walk-outs,
 * and removes customers who left on an earlier tick so the UI sees "left" for one tick.
 */
import { DIRTY_TICKS, DIRTY_TICKS_WITH_PORTER, OWNER_EXTRA_DIRTY_TICKS } from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, GameState, Table } from "../types";
import { mapIfChanged, onShift } from "../util";
import { coveringRoles, type SystemResult } from "./system";

/** A porter turns tables round fast; an owner running kitchen and floor alone is slower still. */
export function dirtyTicksFor(state: GameState): number {
  if (onShift(state, "porter").length > 0) return DIRTY_TICKS_WITH_PORTER;
  return DIRTY_TICKS + (coveringRoles(state).length >= 2 ? OWNER_EXTRA_DIRTY_TICKS : 0);
}

function clearTable(t: Table, leftNow: ReadonlySet<string>, dirty: number): Table {
  if (t.occupiedBy && leftNow.has(t.occupiedBy)) return { ...t, occupiedBy: undefined, dirtyTicks: dirty };
  if (!t.occupiedBy && t.dirtyTicks > 0) return { ...t, dirtyTicks: t.dirtyTicks - 1 };
  return t;
}

export function clearingSystem(_content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  const leftNow = new Set<string>();
  const gone = new Set<string>();
  for (const c of state.customers) {
    if (c.stage !== "left") continue;
    if (c.leftTick === state.tick) leftNow.add(c.id);
    else gone.add(c.id);
  }
  const dirty = dirtyTicksFor(state);
  const tables = mapIfChanged(state.tables, (t) => clearTable(t, leftNow, dirty));
  const customers = gone.size ? state.customers.filter((c) => !gone.has(c.id)) : state.customers;
  const walked = new Set<string>();
  for (const c of state.customers) if (c.walkedOut) walked.add(c.id);
  const tickets = walked.size ? state.tickets.filter((t) => !walked.has(t.customerId)) : state.tickets;
  if (tables === state.tables && customers === state.customers && tickets === state.tickets) {
    return { state, events: [] };
  }
  return { state: { ...state, tables, customers, tickets }, events: [] };
}
