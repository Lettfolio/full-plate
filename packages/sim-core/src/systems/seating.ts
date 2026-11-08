/**
 * SeatingSystem — front of house seats queued parties (first come, first served) at the
 * smallest clean free table that fits, spending SEAT_ACTION_COST per party.
 * Also starts the tick's action budget for later FOH systems.
 */
import { ACTIONS_CARRY_CAP, PATIENCE_START, SEAT_ACTION_COST, SEATED_PATIENCE_RESTORE } from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, GameState, SimEvent, Table } from "../types";
import { tallyOf } from "../util";
import type { SystemResult } from "./system";

/** Smallest free, clean table that seats the party. */
export function findTable(tables: readonly Table[], partySize: number): Table | undefined {
  let best: Table | undefined;
  for (const t of tables) {
    if (t.occupiedBy || t.dirtyTicks > 0 || t.seats < partySize) continue;
    if (!best || t.seats < best.seats) best = t;
  }
  return best;
}

export function seatingSystem(_content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  const tally = tallyOf(state);
  let actions = Math.min(ACTIONS_CARRY_CAP, tally.actionsLeft) + tally.actionsPerTick;
  const queue = state.customers.filter((c) => c.stage === "queue");
  const events: SimEvent[] = [];
  let tables = state.tables;
  const seated = new Map<string, Customer>();
  for (const c of queue) {
    if (actions < SEAT_ACTION_COST) break;
    const table = findTable(tables, c.partySize);
    if (!table) continue; // a smaller party behind may still fit
    tables = tables.map((t) => (t === table ? { ...t, occupiedBy: c.id } : t));
    const patience = Math.min(PATIENCE_START, c.patience + SEATED_PATIENCE_RESTORE);
    seated.set(c.id, { ...c, stage: "seated", tableId: table.id, stageTick: state.tick, patience });
    events.push({ type: "CUSTOMER_SEATED", customerId: c.id, tableId: table.id });
    actions -= SEAT_ACTION_COST;
  }
  const customers = seated.size ? state.customers.map((c) => seated.get(c.id) ?? c) : state.customers;
  return { state: { ...state, tables, customers, service: { ...tally, actionsLeft: actions } }, events };
}
