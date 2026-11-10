/**
 * Round 6: the sous chef's walk, so the child *sees* a cover instead of reading a number (REVIEW R5.6 step 1).
 *
 * When the session notices the sim covered a ticket off her rail (session.ts `coveredBySim`), it books a walk: the sous
 * chef leaves their post, takes the slip off the rail, carries the plate to the pass, puts it down and walks back.
 * The walk is cosmetic replay of what the sim already did in that tick: it never touches a ticket, a timing or a
 * result. Pure functions of (walks, time) so render can draw it without memory, and a paused session draws a still.
 */

/** A plate he sends. */
export interface SousItem {
  ticketId: string;
  dishId: string;
  /** Table number as the player sees it, when the party is seated. */
  table?: number;
}

/**
 * One trip to act out. `at` is the session time the cover was noticed (or, queued, when the walk starts). Covers noticed
 * before he has taken the slip join the trip (the sim often covers two tickets in one tick), so what he says always
 * matches the line the session shows.
 */
export interface SousWalk {
  items: SousItem[];
  /** Which slip on the header rail it was (left to right, by party), so the slip lifts from where it hung. */
  slot: number;
  at: number;
  /**
   * Round 7: he set off for the rail at this session time, when the slip fell due (it turned amber because the sim
   * sends it at the next tick), and waited there for the tick — so he takes the slip off the rail instead of replaying
   * it. Absent: he sets off at `at`, as in round 6.
   */
  leadFrom?: number;
  /**
   * Round 10 review: booked (without a lead-in of its own) while he was out on a lead-in to another due slip — that slip's
   * slot and due time — so the trip sets off from where that lead-in had him, not from his post.
   */
  from?: SousPending;
}

/** Seconds in each leg of the walk. */
export const SOUS_WALK = { toRail: 1.1, take: 0.45, toPass: 1.5, set: 0.5, back: 1.3 } as const;
export const SOUS_WALK_TOTAL = SOUS_WALK.toRail + SOUS_WALK.take + SOUS_WALK.toPass + SOUS_WALK.set + SOUS_WALK.back;

/** Walks kept at once (the oldest finished ones are dropped). */
const MAX_WALKS = 4;

/** Where the sous chef stands between covers (kitchen right, by the sink), the row under the rail, and the pass. */
export const SOUS_POST = { x: 19.4, y: 3.2 } as const;
export const RAIL_STAND_Y = 2.2;
export const PASS_STAND = { x: 9.5, y: 4.35 } as const;

/** Round 7: a trip's timeline — sets off, takes the slip (after waiting at the rail if he got there first), ends. */
export function walkTimes(w: SousWalk): { start: number; takeAt: number; end: number } {
  const start = w.leadFrom ?? w.at;
  const takeAt = Math.max(w.at, start + SOUS_WALK.toRail);
  // A stand-down (no items: she plated the slip herself before the tick) just walks back from the rail.
  const end = w.items.length ? takeAt + SOUS_WALK.take + SOUS_WALK.toPass + SOUS_WALK.set + SOUS_WALK.back : takeAt + SOUS_WALK.back;
  return { start, takeAt, end };
}
export const walkStart = (w: SousWalk): number => walkTimes(w).start;
export const walkEnd = (w: SousWalk): number => walkTimes(w).end;
/** When he is free again after every trip in `walks` (−Infinity when there are none). */
export const freeAt = (walks: readonly SousWalk[] | undefined): number => (walks ?? []).reduce((a, w) => Math.max(a, walkEnd(w)), -Infinity);

/**
 * Books a cover noticed at `now`. It joins the latest trip if he hasn't taken that slip yet; otherwise a new trip starts
 * when the previous one is over (so at most one trip waits, a few seconds). Returns the new list (finished walks
 * pruned), never mutating `walks`. Round 7: `dueSince` (the session time the slip fell due; the game's lead-in) makes
 * the trip set off then — or as soon as he was free after it — the same start `leadIn` draws before the cover.
 */
export function bookSousWalk(walks: readonly SousWalk[] | undefined, item: SousItem, slot: number, now: number, dueSince?: number, from?: SousPending): SousWalk[] {
  const live = (walks ?? []).filter((w) => walkEnd(w) > now);
  const last = live.at(-1);
  if (last && last.items.length && now < walkTimes(last).takeAt + SOUS_WALK.take) return [...live.slice(0, -1), { ...last, items: [...last.items, item] }];
  if (dueSince !== undefined) return [...live, { items: [item], slot, at: now, leadFrom: Math.max(dueSince, freeAt(walks)) }].slice(-MAX_WALKS);
  const prevEnd = live.reduce((a, w) => Math.max(a, walkEnd(w)), now);
  return [...live, { items: [item], slot, at: prevEnd, ...(from ? { from } : {}) }].slice(-MAX_WALKS);
}

/**
 * Round 7: the slip he was walking to (or waiting under) left the rail without a cover — she plated it herself before the
 * tick. He walks back from the rail. Nothing to do if he never set off (busy until after `now`).
 */
export function standDown(walks: readonly SousWalk[] | undefined, slot: number, now: number, dueSince: number): SousWalk[] {
  const leadFrom = Math.max(dueSince, freeAt(walks));
  const live = (walks ?? []).filter((w) => walkEnd(w) > now);
  if (leadFrom >= now) return live;
  return [...live, { items: [], slot, at: now, leadFrom }].slice(-MAX_WALKS);
}

/**
 * Round 10 review: a due slip's slot as drawn at `time`. When a party to its left leaves the rail the slip moves over one
 * place; he slides over with it in SLOT_SLIDE seconds instead of jumping (the session stamps `slotFrom` / `slotAt`).
 */
export const SLOT_SLIDE = 0.4;
export function shownSlot(e: { slot?: number; slotFrom?: number; slotAt?: number }, time: number, fallback: number): number {
  const slot = e.slot ?? fallback;
  if (e.slotFrom === undefined || e.slotAt === undefined) return slot;
  const u = (time - e.slotAt) / SLOT_SLIDE;
  return u >= 1 ? slot : e.slotFrom + (slot - e.slotFrom) * ease(Math.max(0, u));
}

/** Round 7: a slip due at the next tick, its rail slot, and when it fell due (the session stamps it). */
export interface SousPending { slot: number; dueSince: number }

/** The walk render draws while a due slip waits for its tick: the trip `bookSousWalk` will book, minus the cover time. */
export function leadIn(walks: readonly SousWalk[] | undefined, pending: SousPending): SousWalk {
  return { items: [], slot: pending.slot, at: Infinity, leadFrom: Math.max(pending.dueSince, freeAt(walks)) };
}

export type SousPhase = "idle" | "toRail" | "wait" | "take" | "toPass" | "set" | "back";

export interface SousPose {
  x: number;
  y: number;
  facing: "up" | "down" | "left" | "right";
  moving: boolean;
  phase: SousPhase;
  /** The walk being acted out (absent when idle or on a lead-in). */
  walk?: SousWalk;
  /** 0..1 through the current leg. */
  t: number;
  /** Carrying the plate (after the slip is taken, until it is set on the pass). */
  carrying: boolean;
  /** Show the speech bubble ("I've got table 3's Chips!"): from setting off until the plate is down. */
  talking: boolean;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const facingOf = (dx: number, dy: number, fallback: SousPose["facing"]): SousPose["facing"] =>
  Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 ? fallback : Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";

/**
 * Where the sous chef is at `time`. `railX(slot)` is the world x (tiles) under that header slip; render supplies it from
 * its own metrics. Idle: at the post, facing down. Round 7: with `pending` (a slip the sim sends at the next tick) he
 * sets off when it falls due and waits under it, so the trip booked at the cover carries on without a jump.
 *
 * Round 10 review (the snap fix): the newest walk under way is drawn, and it never makes him jump. A walk that takes over
 * while he is still out (a cover booked while he walks to a different due slip — `SousWalk.from` — or a trip that starts
 * as another one's walk back ends) sets off **from where he is**: the pose the walks booked before it, and the lead-in
 * it interrupted, give at the moment it started — not from his post. A cover booked after its lead-in (`leadFrom < at`)
 * carries on that lead-in on its own timeline; the session books it at the slot he was waiting under (the group's
 * first-due slip), and render's lead-in follows the slip that fell due first, sliding along when it moves (`shownSlot`).
 * Still a pure function of (walks, time, pending).
 */
export function sousPose(walks: readonly SousWalk[] | undefined, time: number, railX: (slot: number) => number, pending?: SousPending): SousPose {
  return poseAt(walks ?? [], time, railX, pending, 0);
}

const IDLE: SousPose = { x: SOUS_POST.x, y: SOUS_POST.y, facing: "down", moving: false, phase: "idle", t: 0, carrying: false, talking: false };

function poseAt(walks: readonly SousWalk[], time: number, railX: (slot: number) => number, pending: SousPending | undefined, depth: number): SousPose {
  const lead = pending ? leadIn(walks, pending) : undefined;
  const all = lead ? [...walks, lead] : walks;
  let i = -1;
  for (let k = all.length - 1; k >= 0; k--) if (walkStart(all[k]!) <= time && time < walkEnd(all[k]!)) { i = k; break; }
  if (i < 0) return IDLE;
  const w = all[i]!;
  // A cover booked after its lead-in carries on the lead-in render drew until then (the session books it at that slip's
  // slot and lead-in start): drawn on its own timeline.
  if (Number.isFinite(w.at) && w.leadFrom !== undefined && w.leadFrom < w.at) return walkPose(w, time, railX, SOUS_POST);
  // Otherwise it sets off from where he was when it started: the walks booked before it (they are kept in booking
  // order) and the lead-in it interrupted, if any.
  const rest = w === lead ? walks : walks.slice(0, i);
  const before = depth < 6 ? poseAt(rest, walkStart(w), railX, w === lead ? undefined : w.from, depth + 1) : IDLE;
  return walkPose(w, time, railX, before.phase === "idle" ? SOUS_POST : { x: before.x, y: before.y });
}

/** The pose `w` gives at `time`, its first leg setting off from `origin` (his post, or where he was when it took over). */
function walkPose(w: SousWalk, time: number, railX: (slot: number) => number, origin: { x: number; y: number }): SousPose {
  const { start, takeAt } = walkTimes(w);
  const rail = { x: railX(w.slot), y: RAIL_STAND_Y };
  const legs: { phase: SousPhase; dur: number; from: { x: number; y: number }; to: { x: number; y: number } }[] = [
    { phase: "toRail", dur: SOUS_WALK.toRail, from: origin, to: rail },
    { phase: "wait", dur: takeAt - start - SOUS_WALK.toRail, from: rail, to: rail },
    ...(w.items.length
      ? [
          { phase: "take" as const, dur: SOUS_WALK.take, from: rail, to: rail },
          { phase: "toPass" as const, dur: SOUS_WALK.toPass, from: rail, to: PASS_STAND },
          { phase: "set" as const, dur: SOUS_WALK.set, from: PASS_STAND, to: PASS_STAND },
          { phase: "back" as const, dur: SOUS_WALK.back, from: PASS_STAND, to: SOUS_POST },
        ]
      : [{ phase: "back" as const, dur: SOUS_WALK.back, from: rail, to: SOUS_POST }]),
  ];
  let e = time - start;
  for (const leg of legs) {
    if (e < leg.dur) {
      const t = leg.dur > 0 ? Math.max(0, Math.min(1, e / leg.dur)) : 1;
      const k = ease(t);
      const dx = leg.to.x - leg.from.x, dy = leg.to.y - leg.from.y;
      const facing = leg.phase === "take" || leg.phase === "wait" ? "up" : leg.phase === "set" ? "down" : facingOf(dx, dy, "down");
      const real = w.items.length > 0;
      return {
        x: leg.from.x + dx * k,
        y: leg.from.y + dy * k,
        facing,
        moving: leg.from !== leg.to,
        phase: leg.phase,
        ...(real ? { walk: w } : {}),
        t,
        carrying: real && (leg.phase === "toPass" || (leg.phase === "take" && t >= 0.5) || (leg.phase === "set" && t < 0.5)),
        // He talks once he has the cover to talk about (round 6 talked from setting off; a lead-in has no cover yet).
        talking: real && leg.phase !== "back" && (w.leadFrom === undefined || time >= w.at),
      };
    }
    e -= leg.dur;
  }
  return IDLE;
}

/**
 * What the sous chef says on the way: "I've got table 3's Chips!", "I've got the Chips for tables 1 and 5!",
 * "I've got tables 2 and 4!". `short` names a dish for the slip.
 */
export function sousLine(items: readonly Pick<SousItem, "dishId" | "table">[], short: (dishId: string) => string): string {
  const first = items[0];
  if (!first) return "";
  if (items.length === 1) return first.table ? `I've got table ${first.table}'s ${short(first.dishId)}!` : `I've got the ${short(first.dishId)}!`;
  const tables = [...new Set(items.map((i) => i.table).filter((t): t is number => t !== undefined))];
  const sameDish = items.every((i) => i.dishId === first.dishId);
  if (!tables.length) return sameDish ? `I've got the ${short(first.dishId)}s!` : "I've got those plates!";
  const list = tables.length === 1 ? `table ${tables[0]}` : `tables ${tables.slice(0, -1).join(", ")} and ${tables.at(-1)}`;
  return sameDish ? `I've got the ${short(first.dishId)} for ${list}!` : `I've got ${list}!`;
}
