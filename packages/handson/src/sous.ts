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
 * One trip to act out. `at` is the session time the walk starts (queued behind the previous one). Covers noticed
 * before he has taken the slip join the trip (the sim often covers two tickets in one tick), so what he says always
 * matches the line the session shows.
 */
export interface SousWalk {
  items: SousItem[];
  /** Which slip on the header rail it was (left to right, by party), so the slip lifts from where it hung. */
  slot: number;
  at: number;
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

/**
 * Books a cover noticed at `now`. It joins the latest trip if he hasn't taken that slip yet; otherwise a new trip starts
 * when the previous one is over (so at most one trip waits, a few seconds). Returns the new list (finished walks
 * pruned), never mutating `walks`.
 */
export function bookSousWalk(walks: readonly SousWalk[] | undefined, item: SousItem, slot: number, now: number): SousWalk[] {
  const live = (walks ?? []).filter((w) => w.at + SOUS_WALK_TOTAL > now);
  const last = live.at(-1);
  if (last && now < last.at + SOUS_WALK.toRail + SOUS_WALK.take) return [...live.slice(0, -1), { ...last, items: [...last.items, item] }];
  const prevEnd = live.reduce((a, w) => Math.max(a, w.at + SOUS_WALK_TOTAL), now);
  return [...live, { items: [item], slot, at: prevEnd }].slice(-MAX_WALKS);
}

export type SousPhase = "idle" | "toRail" | "take" | "toPass" | "set" | "back";

export interface SousPose {
  x: number;
  y: number;
  facing: "up" | "down" | "left" | "right";
  moving: boolean;
  phase: SousPhase;
  /** The walk being acted out (absent when idle). */
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
 * its own metrics. Idle: at the post, facing down.
 */
export function sousPose(walks: readonly SousWalk[] | undefined, time: number, railX: (slot: number) => number): SousPose {
  const w = (walks ?? []).filter((x) => x.at <= time && time < x.at + SOUS_WALK_TOTAL).at(-1);
  const idle: SousPose = { x: SOUS_POST.x, y: SOUS_POST.y, facing: "down", moving: false, phase: "idle", t: 0, carrying: false, talking: false };
  if (!w) return idle;
  const rail = { x: railX(w.slot), y: RAIL_STAND_Y };
  const legs: { phase: SousPhase; dur: number; from: { x: number; y: number }; to: { x: number; y: number } }[] = [
    { phase: "toRail", dur: SOUS_WALK.toRail, from: SOUS_POST, to: rail },
    { phase: "take", dur: SOUS_WALK.take, from: rail, to: rail },
    { phase: "toPass", dur: SOUS_WALK.toPass, from: rail, to: PASS_STAND },
    { phase: "set", dur: SOUS_WALK.set, from: PASS_STAND, to: PASS_STAND },
    { phase: "back", dur: SOUS_WALK.back, from: PASS_STAND, to: SOUS_POST },
  ];
  let e = time - w.at;
  for (const leg of legs) {
    if (e < leg.dur) {
      const t = Math.max(0, Math.min(1, e / leg.dur));
      const k = ease(t);
      const dx = leg.to.x - leg.from.x, dy = leg.to.y - leg.from.y;
      const facing = leg.phase === "take" ? "up" : leg.phase === "set" ? "down" : facingOf(dx, dy, "down");
      return {
        x: leg.from.x + dx * k,
        y: leg.from.y + dy * k,
        facing,
        moving: leg.from !== leg.to,
        phase: leg.phase,
        walk: w,
        t,
        carrying: leg.phase === "toPass" || (leg.phase === "take" && t >= 0.5) || (leg.phase === "set" && t < 0.5),
        talking: leg.phase !== "back",
      };
    }
    e -= leg.dur;
  }
  return idle;
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
