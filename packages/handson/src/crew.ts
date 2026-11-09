/**
 * Round 6: who is cooking what, for the canvas (REVIEW R5.6 step 1: "show the course on the canvas so the child sees
 * the help instead of reading a number"). Read-only views derived from (session, state) with the same rules as the
 * station's rail (station.ts `stationTickets` / `coverDueTick`, which mirror sim-core station.ts): nothing here changes
 * a ticket, a timing or a result.
 *
 * - `railView`: the header rail's tickets, each marked hers, the sous chef's (the sim covers it within a tick), or a
 *   helper's (a station dish the sim gave another cook: the second main, a full rail, the commis's own `~ai` hands).
 * - `courseMarkers`: tables eating their mains while their own course (her dessert/side/starter) is still cooking,
 *   with how far through the mains they are (the course is due as they finish).
 * - `helperAtWork`: the commis's AI hands (`<staffId>~ai`) cooking one of her station's dishes, and where.
 */
import { HANDS_ON, SHADOW_COOK_SUFFIX, type GameState, type KitchenTicket } from "@full-plate/sim-core";
import { profile } from "./session";
import { coverDueTick, ownCourse, stationTickets } from "./station";
import type { HandsOnSession } from "./types";

/** The cook id of a hands-on commis's AI hands is `<staffId>~ai`: sim-core's own constant (kitchen.ts), not a copy. */
export const HELPER_SUFFIX = SHADOW_COOK_SUFFIX;

/** hers: on her rail or in her hands · sous: on her rail, the sim's sous chef sends it within a tick · helper: another cook has it. */
export type RailOwner = "hers" | "sous" | "helper";

export interface RailEntry {
  ticket: KitchenTicket;
  owner: RailOwner;
  /** Its party's own course and the party is already eating the mains (a dessert/side/starter that's "coming"). */
  course: boolean;
  /** helper: the cook's id (`<staffId>~ai` for her AI hands). */
  cook?: string;
}

const byAge = (a: KitchenTicket, b: KitchenTicket) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The sim's sous chef takes this rail ticket within a tick: its cover tick has come, or (not its own course) its table is at its last patience. */
export function coverSoon(session: HandsOnSession, state: GameState, t: KitchenTicket): boolean {
  if (coverDueTick(session, state, t) <= state.tick + 1) return true;
  const c = state.customers.find((x) => x.id === t.customerId);
  return !!c && !ownCourse(session, t, c) && c.stage === "ordered" && c.patience <= HANDS_ON.coverPatience;
}

/**
 * Her rail (hers or about to be the sous chef's) then her station's dishes another cook is cooking (oldest first, at
 * most `maxHelper`). Empty without a station.
 */
export function railView(session: HandsOnSession, state: GameState, maxHelper = 2): RailEntry[] {
  const st = session.opts.station;
  if (!st) return [];
  const byId = new Map(state.customers.map((c) => [c.id, c]));
  const coming = (t: KitchenTicket) => {
    const c = byId.get(t.customerId);
    return !!c?.courseOut && ownCourse(session, t, c);
  };
  const rail = stationTickets(session, state);
  const mine = new Set(rail.map((t) => t.id));
  const out: RailEntry[] = rail.map((t) => ({ ticket: t, owner: coverSoon(session, state, t) ? "sous" : "hers", course: coming(t) }));
  const dishes = new Set(st.dishIds);
  const pid = session.opts.playerStaffId;
  const others = state.tickets
    .filter((t) => dishes.has(t.dishId) && !mine.has(t.id) && !t.atPass && t.ticksRemaining > 0 && !!t.chefId && t.chefId !== pid && !session.cooked[t.id])
    .sort(byAge)
    .slice(0, Math.max(0, maxHelper));
  for (const t of others) out.push({ ticket: t, owner: "helper", course: coming(t), cook: t.chefId! });
  return out;
}

export interface CourseMarker {
  customerId: string;
  tableId: string;
  /** The course's tickets still out (usually one). */
  ticketIds: string[];
  dishIds: string[];
  /** hers if any of them is on her rail or in her hands, else a helper's (or the sous chef's) to send. */
  owner: "hers" | "helper";
  /** 0..1 through the mains towards when the course is due (eatUntil − courseLeadTicks); 0 until they're eating. */
  progress: number;
  /** The sim tick the sous chef would send it (Infinity until the party is eating). */
  dueTick: number;
}

/**
 * Tables eating their mains while their own course is still cooking (sim-core `Customer.courseOut`). The marker
 * clears when the course lands (courseOut is cleared with the last plate).
 */
export function courseMarkers(session: HandsOnSession, state: GameState): CourseMarker[] {
  if (!session.opts.station) return [];
  const mine = new Set(stationTickets(session, state).map((t) => t.id));
  const held = session.carrying && "ticketId" in session.carrying ? session.carrying.ticketId : undefined;
  if (held) mine.add(held);
  const out: CourseMarker[] = [];
  for (const c of state.customers) {
    if (!c.courseOut || !c.tableId || c.stage === "left" || c.stage === "paying") continue;
    const tks = state.tickets.filter((t) => t.customerId === c.id && !t.atPass && !session.cooked[t.id]).sort(byAge);
    if (!tks.length) continue;
    const due = c.stage === "eating" && c.eatUntil !== undefined ? c.eatUntil - HANDS_ON.courseLeadTicks : Infinity;
    const start = c.servedTick ?? state.tick;
    const progress = Number.isFinite(due) ? Math.max(0, Math.min(1, due > start ? (state.tick - start) / (due - start) : 1)) : 0;
    out.push({
      customerId: c.id,
      tableId: c.tableId,
      ticketIds: tks.map((t) => t.id),
      dishIds: tks.map((t) => t.dishId),
      owner: tks.some((t) => mine.has(t.id)) ? "hers" : "helper",
      progress,
      dueTick: due,
    });
  }
  return out;
}

export interface HelperWork {
  ticket: KitchenTicket;
  /** The cook's id (`<staffId>~ai`). */
  cook: string;
  /** Where they stand: the dish's hob/oven/fryer, or the prep board for cold dishes. */
  stationId: "stove" | "oven" | "fryer" | "prep";
}

/** The commis's AI hands cooking one of her station's dishes (the oldest), and at which station. */
export function helperAtWork(session: HandsOnSession, state: GameState): HelperWork | undefined {
  const st = session.opts.station;
  const pid = session.opts.playerStaffId;
  if (!st || !pid) return undefined;
  const cook = `${pid}${HELPER_SUFFIX}`;
  const dishes = new Set(st.dishIds);
  const t = state.tickets.filter((x) => x.chefId === cook && dishes.has(x.dishId) && !x.atPass && x.ticksRemaining > 0).sort(byAge)[0];
  if (!t) return undefined;
  const m = profile(session, t.dishId).method;
  return { ticket: t, cook, stationId: m === "stove" || m === "oven" || m === "fryer" ? m : "prep" };
}
