/**
 * ServiceSystem — patience falls while waiting (queue / seated / ordered, scaled by the
 * segment's speedWeight); at 0 the party walks out. Fully served parties eat, then ask for the bill.
 */
import {
  CHARM_PATIENCE_CLAMP,
  CHARM_PATIENCE_WEIGHT,
  EAT_TICKS_BASE,
  EAT_TICKS_PER_EXTRA_GUEST,
  HANDS_ON,
  PATIENCE_DECAY,
  PATIENCE_SPEED_BASE,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, Customer, GameState, SegmentDef, SimEvent, Table } from "../types";
import { clamp, findSegment, logEvent, mapIfChanged, round2, tallyOf } from "../util";
import { frontCharm, type SystemResult } from "./system";
import { dilationOf, waitingOnHuman } from "./station";

/** Charmed guests wait more happily: decay × (1 + w × (50 − charm)/50), clamped. Charm 50 ⇒ ×1. */
export function charmPatienceMult(charm: number): number {
  const [lo, hi] = CHARM_PATIENCE_CLAMP;
  return clamp(1 + (CHARM_PATIENCE_WEIGHT * (50 - charm)) / 50, lo, hi);
}

export function patienceDecay(stage: Customer["stage"], seg: SegmentDef | undefined, charm = 50): number {
  if (stage !== "queue" && stage !== "seated" && stage !== "ordered") return 0;
  return PATIENCE_DECAY[stage] * (PATIENCE_SPEED_BASE + (seg?.speedWeight ?? 0.5)) * charmPatienceMult(charm);
}

export const eatTicks = (partySize: number): number =>
  EAT_TICKS_BASE + EAT_TICKS_PER_EXTRA_GUEST * Math.max(0, partySize - 1);

function walkOut(c: Customer, tick: number): Customer {
  return { ...c, stage: "left", walkedOut: true, patience: 0, leftTick: tick, spend: 0, tip: 0, satisfaction: 0 };
}

/**
 * Eating time once served. Round 5 station dilation: the ticks a party waited on the hands-on human beyond an AI
 * cook's time (`dueTick`) come off it, down to HANDS_ON.dilationMinEatTicks.
 */
export function eatTicksFor(c: Customer): number {
  const eat = eatTicks(c.partySize);
  const owed = dilationOf(c);
  return owed ? Math.max(Math.min(eat, HANDS_ON.dilationMinEatTicks), eat - owed) : eat;
}

/**
 * Advances one customer by a tick. `patienceMult` scales the patience fall (round 5: a party waiting only on the
 * hands-on human's station). A party eating its mains while its own course is out (`courseOut`) pays once it lands.
 */
export function advanceCustomer(content: ContentPack, c: Customer, tick: number, charm = 50, patienceMult = 1): Customer {
  if (c.stage === "ordered" && c.servedTick !== undefined) {
    return { ...c, stage: "eating", stageTick: tick, eatUntil: tick + eatTicksFor(c) };
  }
  if (c.stage === "eating") {
    return tick >= (c.eatUntil ?? tick) && !c.courseOut ? { ...c, stage: "paying", stageTick: tick } : c;
  }
  const decay = patienceDecay(c.stage, findSegment(content, c.segment), charm) * patienceMult;
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
  const charm = state.service?.frontCharm ?? frontCharm(content, state);
  const onHuman = waitingOnHuman(content, state);
  const customers = mapIfChanged(state.customers, (c) => {
    const slow = c.stage === "ordered" && c.servedTick === undefined && onHuman.has(c.id);
    const next = advanceCustomer(content, c, state.tick, charm, slow ? HANDS_ON.stationPatienceMult : 1);
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
