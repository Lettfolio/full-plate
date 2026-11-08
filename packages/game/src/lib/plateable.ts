import type { ContentPack, DishId, GameState } from "@full-plate/sim-core";
import { dishById } from "./content";

/** Active dishes the larder can't plate even once right now (sim-core auto-86s these at opening). */
export function unplateable(content: ContentPack, game: GameState): DishId[] {
  const qty = new Map(game.stock.map((s) => [s.ingredientId, s.qty]));
  return game.menu
    .filter((m) => m.active)
    .filter((m) => (dishById(content, m.dishId)?.ingredients ?? []).some((i) => (qty.get(i.id) ?? 0) + 1e-9 < i.qty))
    .map((m) => m.dishId);
}
