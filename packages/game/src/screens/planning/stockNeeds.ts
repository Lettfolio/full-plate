import type { ContentPack, GameState, IngredientId } from "@full-plate/sim-core";
import { content as pack, expectedCovers as simExpectedCovers, forecastNeeds, suggestedOrder } from "../../sim";
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
  /** Portions the sim's forecast needs for the next service with the current menu (0 if unused). */
  need: number;
  usedBy: string[];
}

/** Guests sim-core's forecast plans for at the next service. */
export function expectedCovers(game: GameState): number {
  return simExpectedCovers(pack, game);
}

/**
 * One row per ingredient for the Stock tab. `need` is sim-core's per-ingredient forecast (`forecastNeeds`), the
 * same numbers `suggestedOrder` is built from, so "needed" and "Fill what's short" always agree.
 */
export function stockNeeds(content: ContentPack, game: GameState): StockNeed[] {
  const usage = ingredientUsage(content, game);
  const need = new Map(forecastNeeds(content, game).map((n) => [n.ingredientId, n.need]));
  return content.ingredients.map((ing) => {
    const st = game.stock.find((s) => s.ingredientId === ing.id);
    const uses = usage.get(ing.id) ?? [];
    return {
      ingredientId: ing.id,
      name: ing.name,
      unitCost: ing.unitCost,
      shelfLifeDays: ing.shelfLifeDays,
      onHand: st?.qty ?? 0,
      incoming: game.orders.filter((o) => o.ingredientId === ing.id).reduce((a, o) => a + o.qty, 0),
      age: st && st.qty > 0 ? Math.max(0, game.day - st.oldestDay) : 0,
      need: need.get(ing.id) ?? 0,
      usedBy: uses.map((u) => content.dishes.find((d) => d.id === u.dishId)?.name ?? u.dishId),
    };
  });
}

/** Tomorrow's order as [ingredientId, qty] lines, from sim-core's `suggestedOrder`. */
export function restockLines(game: GameState): [IngredientId, number][] {
  return suggestedOrder(pack, game).map((l) => [l.ingredientId, l.qty]);
}
