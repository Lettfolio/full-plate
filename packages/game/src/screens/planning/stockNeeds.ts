import type { ContentPack, DishCourse, GameState, IngredientId } from "@full-plate/sim-core";
import { COURSE_ORDER_CHANCE } from "../../sim";
import { dishById, ingredientUsage } from "../../lib/content";

export interface StockNeed {
  ingredientId: IngredientId;
  name: string;
  unitCost: number;
  shelfLifeDays: number;
  onHand: number;
  incoming: number;
  /** Age in days of the oldest batch. */
  age: number;
  /** Rough portions needed for one day's service with the current menu (0 if unused). */
  need: number;
  usedBy: string[];
}

/**
 * Guess at the next service's guests: the busiest of the last week (covers + walk-outs, i.e. demand,
 * not what we managed to serve) plus 10%; a cautious 40 before the first service. Using only
 * yesterday collapsed the forecast after a sold-out day and caused feast/famine stock cycles.
 */
export function expectedCovers(game: GameState): number {
  const recent = game.history.slice(-7);
  if (!recent.length) return 40;
  const demand = Math.max(...recent.map((d) => d.covers + d.walkouts));
  return Math.max(20, Math.round(demand * 1.1));
}

/**
 * Plates of each dish per guest, following sim-core's ordering: every guest picks one main, plus each
 * other course with COURSE_ORDER_CHANCE; demand within a course is split evenly (a heuristic — the sim
 * weights by appeal and price). With no mains on the menu each guest orders one dish of any kind.
 */
export function platesPerGuest(content: ContentPack, game: GameState): Map<string, number> {
  const active = game.menu.filter((m) => m.active && !(game.eightySixed ?? []).includes(m.dishId));
  const byCourse = new Map<DishCourse, string[]>();
  for (const m of active) {
    const d = dishById(content, m.dishId);
    if (d) byCourse.set(d.course, [...(byCourse.get(d.course) ?? []), d.id]);
  }
  const out = new Map<string, number>();
  const mains = byCourse.get("main");
  if (!mains) {
    for (const m of active) out.set(m.dishId, 1 / active.length);
    return out;
  }
  for (const [course, ids] of byCourse) {
    const perGuest = course === "main" ? 1 : COURSE_ORDER_CHANCE[course] ?? 0;
    for (const id of ids) out.set(id, perGuest / ids.length);
  }
  return out;
}

/** Heuristic only — the sim owns real demand. Good enough for "you'll probably run out". */
export function stockNeeds(content: ContentPack, game: GameState): StockNeed[] {
  const usage = ingredientUsage(content, game);
  const guests = expectedCovers(game);
  const share = platesPerGuest(content, game);
  return content.ingredients.map((ing) => {
    const st = game.stock.find((s) => s.ingredientId === ing.id);
    const uses = usage.get(ing.id) ?? [];
    const need = Math.ceil(uses.reduce((a, u) => a + u.qty * (share.get(u.dishId) ?? 0) * guests, 0));
    return {
      ingredientId: ing.id,
      name: ing.name,
      unitCost: ing.unitCost,
      shelfLifeDays: ing.shelfLifeDays,
      onHand: st?.qty ?? 0,
      incoming: game.orders.filter((o) => o.ingredientId === ing.id).reduce((a, o) => a + o.qty, 0),
      age: st && st.qty > 0 ? Math.max(0, game.day - st.oldestDay) : 0,
      need,
      usedBy: uses.map((u) => content.dishes.find((d) => d.id === u.dishId)?.name ?? u.dishId),
    };
  });
}

/** Portions to order so that on hand + incoming covers the forecast (rounded up to 5s). */
export function shortfall(needs: StockNeed[]): Record<IngredientId, number> {
  const out: Record<IngredientId, number> = {};
  for (const r of needs) {
    const gap = r.need - r.onHand - r.incoming;
    if (r.need > 0 && gap > 0) out[r.ingredientId] = Math.ceil(gap / 5) * 5;
  }
  return out;
}
