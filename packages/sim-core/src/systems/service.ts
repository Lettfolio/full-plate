/**
 * ServiceSystem — patience falls while waiting (queue / seated / ordered, scaled by the
 * segment's speedWeight); at 0 the party walks out. Fully served parties eat, then ask for the bill.
 */
import {
  EAT_TICKS_BASE,
  EAT_TICKS_PER_EXTRA_GUEST,
  PATIENCE_DECAY,
  PATIENCE_SPEED_BASE,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, GameState, SegmentDef, SimEvent, Table } from "../types";
import { findSegment, logEvent, mapIfChanged, round2, tallyOf } from "../util";
import type { SystemResult } from "./system";

export function patienceDecay(stage: Customer["stage"], seg: SegmentDef | undefined): number {
  if (stage !== "queue" && stage !== "seated" && stage !== "ordered") return 0;
  return PATIENCE_DECAY[stage] * (PATIENCE_SPEED_BASE + (seg?.speedWeight ?? 0.5));
}

export const eatTicks = (partySize: number): number =>
  EAT_TICKS_BASE + EAT_TICKS_PER_EXTRA_GUEST * Math.max(0, partySize - 1);

function walkOut(c: Customer, tick: number): Customer {
  return { ...c, stage: "left", walkedOut: true, patience: 0, leftTick: tick, spend: 0, tip: 0, satisfaction: 0 };
}

/** Advances one customer by a tick. */
export function advanceCustomer(content: ContentPack, c: Customer, tick: number): Customer {
  if (c.stage === "ordered" && c.servedTick !== undefined) {
    return { ...c, stage: "eating", stageTick: tick, eatUntil: tick + eatTicks(c.partySize) };
  }
  if (c.stage === "eating") {
    return tick >= (c.eatUntil ?? tick) ? { ...c, stage: "paying", stageTick: tick } : c;
  }
  const decay = patienceDecay(c.stage, findSegment(content, c.segment));
  if (decay === 0) return c;
  const patience = round2(c.patience - decay);
  return patience <= 0 ? walkOut(c, tick) : { ...c, patience };
}

function freeTable(tables: readonly Table[], tableId: string | undefined, dirtyTicks: number): Table[] {
  if (!tableId) return tables as Table[];
  return mapIfChanged(tables, (t) => (t.id === tableId ? { ...t, occupiedBy: undefined, dirtyTicks } : t));
}

export function serviceSystem(content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  const events: SimEvent[] = [];
  let tables = state.tables;
  let walkouts = 0;
  let walkoutCovers = 0;
  const customers = mapIfChanged(state.customers, (c) => {
    const next = advanceCustomer(content, c, state.tick);
    if (next.walkedOut && !c.walkedOut) {
      walkouts++;
      walkoutCovers += c.partySize;
      // A walked-out table still needs resetting (and any half-eaten setup cleared).
      tables = freeTable(tables, c.tableId, c.tableId ? 1 : 0);
      events.push({ type: "CUSTOMER_WALKED_OUT", customerId: c.id });
      events.push(logEvent(state, `A party of ${c.partySize} got fed up and walked out.`, "bad"));
    }
    return next;
  });
  if (customers === state.customers) return { state, events };
  const tally = tallyOf(state);
  return {
    state: {
      ...state,
      customers,
      tables,
      todays: { ...state.todays, walkouts: (state.todays.walkouts ?? 0) + walkoutCovers },
      service: { ...tally, walkoutParties: tally.walkoutParties + walkouts },
    },
    events,
  };
}
