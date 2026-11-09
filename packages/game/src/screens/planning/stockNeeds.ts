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

/** A menu dish tonight's larder can't cover (round 3 review P1: a short menu in inspection season). */
export interface DishRisk {
  dishId: string;
  name: string;
  /** Plates the larder can make right now (0 ⇒ sim-core 86s it at the door). */
  plates: number;
}

export interface TonightRisk {
  /** Active dishes that use an ingredient whose stock on hand is below the forecast need, fewest plates first. */
  dishes: DishRisk[];
  /** Dishes the larder can't plate even once: 86'd when the doors open. */
  out: number;
  /** sim-core `suggestedOrder` lines (they arrive tomorrow morning) and their base cost. */
  lines: [IngredientId, number][];
  cost: number;
}

/**
 * Which of tonight's menu dishes the larder won't cover. Need is sim-core's forecast (`forecastNeeds`, the numbers
 * `suggestedOrder` is built on) against stock **on hand**: orders placed now arrive tomorrow, so they don't help
 * tonight. Content order breaks ties, so the list is stable.
 */
export function tonightRisk(content: ContentPack, game: GameState): TonightRisk {
  const onHand = new Map(game.stock.map((s) => [s.ingredientId, s.qty]));
  const shortIngs = new Set(forecastNeeds(content, game).filter((n) => n.need > (onHand.get(n.ingredientId) ?? 0)).map((n) => n.ingredientId));
  const active = new Set(game.menu.filter((m) => m.active).map((m) => m.dishId));
  const dishes: DishRisk[] = [];
  for (const d of content.dishes) {
    if (!active.has(d.id) || !d.ingredients.some((i) => shortIngs.has(i.id))) continue;
    const plates = Math.min(...d.ingredients.map((i) => Math.floor(((onHand.get(i.id) ?? 0) + 1e-9) / i.qty)));
    dishes.push({ dishId: d.id, name: d.name, plates: Number.isFinite(plates) ? plates : 0 });
  }
  dishes.sort((a, b) => a.plates - b.plates);
  const lines = restockLines(game);
  const unit = (id: string) => content.ingredients.find((i) => i.id === id)?.unitCost ?? 0;
  return { dishes, out: dishes.filter((d) => d.plates === 0).length, lines, cost: lines.reduce((a, [id, q]) => a + q * unit(id), 0) };
}
