import type { ContentPack, DayResult, DishCourse, DishId, GameState, ServiceTally } from "@full-plate/sim-core";
import { dishById } from "./content";

/** A dish needs at least this many plates sold today before it can be called the worst. */
export const WORST_MIN_SOLD = 3;
/**
 * Plate quality this far below the average of today's other dishes reads as "low quality". No absolute
 * floor: when every plate is poor (the owner cooking) the kitchen is the problem, not one dish.
 */
const QUALITY_GAP = 8;

export interface DishDay { dishId: DishId; course: DishCourse; sold: number; quality?: number }
export interface WorstDish { dishId: DishId; reason: "quality" | "unpopular"; sold: number; quality?: number; text: string }

/**
 * Today's per-dish numbers. In the evening the service tally is still on the state (sold, plated,
 * quality); without it (round-1 saves) falls back to the menu's rolled 7-day window, newest last.
 */
export function dishDays(content: ContentPack, game: Pick<GameState, "menu" | "service">): DishDay[] {
  const tally: ServiceTally["dishes"] | undefined = game.service?.dishes;
  return game.menu.flatMap((m) => {
    const def = dishById(content, m.dishId);
    if (!def) return [];
    const t = tally?.[m.dishId];
    const sold = t ? t.sold : m.recent?.at(-1)?.sold ?? 0;
    const quality = t && t.plated > 0 ? t.qualitySum / t.plated : undefined;
    return [{ dishId: m.dishId, course: def.course, sold, ...(quality !== undefined ? { quality } : {}) }];
  });
}

/**
 * The evening's "Worst dish", excluding anything that sold fewer than WORST_MIN_SOLD plates (two plates
 * of a cheap starter are not a verdict). Low quality wins if one dish is clearly worse than the rest;
 * otherwise the dish that sold least compared with others in its course is "unpopular".
 * `simWorst` (DayResult.worstDish, lowest quality) is used when there is no per-dish quality.
 */
export function worstDish(days: DishDay[], simWorst?: DishId): WorstDish | null {
  const eligible = days.filter((d) => d.sold >= WORST_MIN_SOLD);
  if (eligible.length < 2) return null;
  const rated = eligible.filter((d) => d.quality !== undefined);
  if (rated.length >= 2) {
    const low = [...rated].sort((a, b) => a.quality! - b.quality! || a.dishId.localeCompare(b.dishId))[0]!;
    const others = rated.filter((d) => d !== low);
    const avg = others.reduce((a, d) => a + d.quality!, 0) / others.length;
    if (low.quality! <= avg - QUALITY_GAP) {
      return { dishId: low.dishId, reason: "quality", sold: low.sold, quality: low.quality, text: `Low quality: plates scored ${Math.round(low.quality!)} (the rest of the menu averaged ${Math.round(avg)})` };
    }
  } else if (simWorst) {
    const d = eligible.find((x) => x.dishId === simWorst);
    if (d) return { dishId: d.dishId, reason: "quality", sold: d.sold, text: "Lowest plate quality today" };
  }
  // Unpopular: fewest plates relative to the average of its own course (a dessert is compared with desserts).
  const byCourse = new Map<DishCourse, DishDay[]>();
  for (const d of days) byCourse.set(d.course, [...(byCourse.get(d.course) ?? []), d]);
  const share = (d: DishDay) => {
    const peers = byCourse.get(d.course) ?? [d];
    const mean = peers.reduce((a, p) => a + p.sold, 0) / peers.length;
    return mean > 0 ? d.sold / mean : 1;
  };
  const candidates = eligible.filter((d) => (byCourse.get(d.course)?.length ?? 0) > 1);
  if (!candidates.length) return null;
  const pick = [...candidates].sort((a, b) => share(a) - share(b) || a.dishId.localeCompare(b.dishId))[0]!;
  if (share(pick) >= 0.8) return null; // nothing stands out
  return { dishId: pick.dishId, reason: "unpopular", sold: pick.sold, ...(pick.quality !== undefined ? { quality: pick.quality } : {}), text: `Unpopular: ${pick.sold} sold, fewer than others in its course` };
}

/** Most recent earlier day with nobody missing (the owner covered nothing). */
export function lastStaffedDay(history: readonly DayResult[], today: number): DayResult | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const d = history[i]!;
    if (d.day < today && !(d.ownerCovered?.length)) return d;
  }
  return undefined;
}

/** Walk-outs above this on a day suggest more tables. */
export const WALKOUTS_FOR_TABLE_TIP = 5;

/**
 * Round 14 (F, U5): why nobody ate tonight, for the Evening's headline. In the evening the state still holds today's
 * larder (deliveries land tomorrow morning) and today's rota, so "nothing could be cooked" and "nobody on" are what
 * the day really was. Undefined on a night somebody ate.
 */
export type ZeroCause = "closed" | "noMenu" | "noStock" | "noStaff" | "nobody";
export function zeroNightCause(
  r: Pick<DayResult, "covers" | "closed" | "day">,
  game: Pick<GameState, "menu" | "staff">,
  unplateableNow: number,
  weekday: number,
): ZeroCause | undefined {
  if (r.covers > 0) return undefined;
  if (r.closed) return "closed";
  const active = game.menu.filter((m) => m.active).length;
  if (active === 0) return "noMenu";
  if (unplateableNow >= active) return "noStock";
  if (!game.staff.some((s) => s.rota[weekday])) return "noStaff";
  return "nobody";
}

export const ZERO_HEADLINE: Record<ZeroCause, { title: string; line: string }> = {
  closed: { title: "Closed today.", line: "No service, so no takings. Rent and the bills still ran." },
  noMenu: { title: "Nothing on the menu.", line: "Nobody can order from an empty menu. Add dishes in the morning." },
  noStock: { title: "Nobody ate: the larder was empty.", line: "Every dish on the menu was out of stock, so the kitchen couldn't cook anything. Wages and rent were paid anyway. Order in the evening and it arrives tomorrow morning." },
  noStaff: { title: "Nobody ate: nobody was on.", line: "With no one on the rota the doors opened on an empty kitchen. Put someone on today's rota." },
  nobody: { title: "Nobody came in tonight.", line: "Not a single guest. Check your prices and the gossip in the morning." },
};
