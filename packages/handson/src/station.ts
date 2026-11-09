/**
 * Round 4: the commis station. In career mode a hands-on chef owns a section of the menu (starters and sides, then
 * desserts, then the easiest mains) instead of racing the head chef for the oldest ticket. The sim's AI cooks leave
 * the player's rail alone (sim-core SET_HANDS_ON `station`); a sous chef covers a ticket if the player idles, so a slow
 * child never stalls service. Higher rungs widen the section and tighten the cover.
 *
 * Pure and deterministic: everything is derived from the GameState (menu, 7-day sales) and the content pack.
 */
import type { ContentPack, DishId, GameState, KitchenTicket } from "@full-plate/sim-core";
import type { HandsOnSession } from "./types";

/** Per hands-on level (career rung on the chef track: 0 commis, 1 chef de partie, 2 sous chef, 3 head chef). */
export interface StationLevel {
  /** Name the rail shows, e.g. "Commis station". */
  title: string;
  /** Tickets on the player's rail at once (sim-core reserves exactly these). */
  cap: number;
  /** A sous chef covers a ticket when the player has done nothing for this long with work on their rail. */
  idleCoverSecs: number;
  /** …and any rail ticket left this long, however busy the player is (customers can't wait for ever). */
  hardCoverSecs: number;
  /** Mains are added to the section, easiest first, until the section holds this share of the kitchen's food. */
  minShare: number;
  /** At most this many mains on the section (the whole menu when Infinity). */
  maxMains: number;
  /** Target plates per minute for pacing (see pacing.ts): one ticket every 60 / targetPpm seconds. */
  targetPpm: number;
}

export const STATION_LEVELS: readonly StationLevel[] = [
  { title: "Commis station", cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, minShare: 0.3, maxMains: 1, targetPpm: 2.2 },
  { title: "Your section", cap: 2, idleCoverSecs: 26, hardCoverSecs: 70, minShare: 0.45, maxMains: 2, targetPpm: 2.6 },
  { title: "The pass", cap: 3, idleCoverSecs: 22, hardCoverSecs: 60, minShare: 1, maxMains: Infinity, targetPpm: 3 },
  { title: "The pass", cap: 3, idleCoverSecs: 20, hardCoverSecs: 55, minShare: 1, maxMains: Infinity, targetPpm: 3.4 },
];

/** Execution a covered plate is booked at (the sous chef rushed it between their own tickets). */
export const COVER_EXECUTION = 0.6;

/** What the session stores (HandsOnSession.opts.station) and the game sends to sim-core (dishIds + cap). */
export interface StationPlan {
  level: number;
  title: string;
  /** "Starters · Sides · Burger" — what the player owns, for the rail and the My shift card. */
  label: string;
  dishIds: DishId[];
  cap: number;
  idleCoverSecs: number;
  hardCoverSecs: number;
  targetPpm: number;
}

const SECTION_NAME: Record<string, string> = { starter: "Starters", side: "Sides", dessert: "Desserts" };
const SECTIONS = ["starter", "side", "dessert"] as const;
const COURSE_WEIGHT: Record<string, number> = { main: 1, starter: 0.3, side: 0.3, dessert: 0.3 };

export const stationLevel = (level: number): StationLevel => STATION_LEVELS[Math.max(0, Math.min(STATION_LEVELS.length - 1, Math.floor(level)))]!;

/**
 * Picks the player's section from today's menu. Starters, sides and desserts first (whole courses); then mains,
 * easiest first (skill required, then prep time), until the section carries `minShare` of the kitchen's expected
 * plates or `maxMains` is reached. Expected plates come from each dish's 7-day sales (course weights before any).
 * Returns undefined when the menu has no food.
 */
export function commisStation(state: GameState, content: ContentPack, level = 0): StationPlan | undefined {
  const L = stationLevel(level);
  const dishes = state.menu
    .filter((m) => m.active)
    .map((m) => ({ m, d: content.dishes.find((x) => x.id === m.dishId) }))
    .filter((x): x is { m: typeof x.m; d: NonNullable<typeof x.d> } => !!x.d && x.d.course !== "drink");
  if (!dishes.length) return undefined;
  const anySales = dishes.some((x) => x.m.sold7d > 0);
  const perCourse = new Map<string, number>();
  for (const x of dishes) perCourse.set(x.d.course, (perCourse.get(x.d.course) ?? 0) + 1);
  const volume = (x: (typeof dishes)[number]) => (anySales ? x.m.sold7d : (COURSE_WEIGHT[x.d.course] ?? 0.3) / perCourse.get(x.d.course)!);
  const total = dishes.reduce((a, x) => a + volume(x), 0) || 1;
  const picked: typeof dishes = [];
  const sections: string[] = [];
  for (const c of SECTIONS) {
    const ds = dishes.filter((x) => x.d.course === c);
    if (ds.length) { picked.push(...ds); sections.push(SECTION_NAME[c]!); }
  }
  const mains = dishes.filter((x) => !SECTIONS.includes(x.d.course as (typeof SECTIONS)[number]))
    .sort((a, b) => a.d.skillRequired - b.d.skillRequired || a.d.prepTicks - b.d.prepTicks || (a.d.id < b.d.id ? -1 : 1));
  let share = picked.reduce((a, x) => a + volume(x), 0) / total;
  let added = 0;
  for (const x of mains) {
    if (share >= L.minShare - 1e-9 || added >= L.maxMains) break;
    picked.push(x);
    sections.push(shortMain(x.d.name));
    share += volume(x) / total;
    added++;
  }
  // A menu of mains only, at a level with maxMains 0, still needs something to cook.
  if (!picked.length && mains[0]) { picked.push(mains[0]); sections.push(shortMain(mains[0].d.name)); }
  const whole = picked.length === dishes.length;
  return {
    level,
    title: L.title,
    label: whole ? "Every food ticket" : sections.join(" · "),
    dishIds: picked.map((x) => x.d.id),
    cap: L.cap,
    idleCoverSecs: L.idleCoverSecs,
    hardCoverSecs: L.hardCoverSecs,
    targetPpm: L.targetPpm,
  };
}

/** "Steak & ale pie" stays; any burger → "Burgers"; long names are trimmed for the rail. */
function shortMain(name: string): string {
  const n = name.trim();
  if (/burger/i.test(n)) return "Burgers";
  if (/pizza|margherita/i.test(n)) return "Pizza";
  return n.length <= 18 ? n : `${n.slice(0, 16)}…`;
}

const byAge = (a: KitchenTicket, b: KitchenTicket) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The rail size in force: the sim's (it may have been updated mid-shift by pacing), else the plan's. */
export function railCapOf(session: HandsOnSession, state: GameState): number {
  return state.handsOn?.station?.cap ?? session.railCap ?? session.opts.station?.cap ?? 0;
}

/**
 * The player's rail: their station's tickets they have picked up, then the oldest unassigned ones, up to the rail
 * size — the same rule sim-core's `stationRail` reserves. Oldest first. Cooked/covered tickets drop off.
 */
export function stationTickets(session: HandsOnSession, state: GameState): KitchenTicket[] {
  const st = session.opts.station;
  if (!st) return [];
  const dishes = new Set(st.dishIds);
  const pid = session.opts.playerStaffId;
  const live = state.tickets.filter((t) => dishes.has(t.dishId) && t.ticksRemaining > 0 && !t.atPass && !session.cooked[t.id]);
  const held = live.filter((t) => session.claimed[t.id]);
  const out = [...held];
  const cap = Math.max(railCapOf(session, state), held.length);
  for (const t of [...live].sort(byAge)) {
    if (out.length >= cap) break;
    if (session.claimed[t.id]) continue;
    if (t.chefId && t.chefId !== pid) continue;
    out.push(t);
  }
  return out.sort(byAge);
}
