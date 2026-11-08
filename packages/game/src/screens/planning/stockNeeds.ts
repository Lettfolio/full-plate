import type { ContentPack, GameState, IngredientId } from "@full-plate/sim-core";
import { ingredientUsage } from "../../lib/content";

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

/** Guess at tomorrow's covers: yesterday's covers if we have them, otherwise a cautious 40. */
export function expectedCovers(game: GameState): number {
  const last = game.history.at(-1);
  return Math.max(20, Math.round(last ? last.covers * 1.1 : 40));
}

/**
 * Heuristic only — the sim owns real demand. Assumes each cover orders ~1 dish, spread evenly
 * across active dishes. Good enough for a "you'll probably run out" hint.
 */
export function stockNeeds(content: ContentPack, game: GameState): StockNeed[] {
  const usage = ingredientUsage(content, game);
  const activeCount = Math.max(1, game.menu.filter((m) => m.active).length);
  const perDish = expectedCovers(game) / activeCount;
  return content.ingredients.map((ing) => {
    const st = game.stock.find((s) => s.ingredientId === ing.id);
    const uses = usage.get(ing.id) ?? [];
    const need = Math.ceil(uses.reduce((a, u) => a + u.qty * perDish, 0));
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
