import type { ContentPack, DishDef, DishId, GameState, IngredientId } from "@full-plate/sim-core";

export function dishById(content: ContentPack, id: DishId | undefined): DishDef | undefined {
  return id ? content.dishes.find((d) => d.id === id) : undefined;
}

export function dishName(content: ContentPack, id: DishId | undefined): string {
  return dishById(content, id)?.name ?? id ?? "—";
}

/** Ingredient cost of one plate, in pence (unit costs at base price; the sim may apply seasonality). */
export function plateCost(content: ContentPack, id: DishId): number {
  const d = dishById(content, id);
  if (!d) return 0;
  return d.ingredients.reduce((sum, i) => sum + (content.ingredients.find((x) => x.id === i.id)?.unitCost ?? 0) * i.qty, 0);
}

/** Gross margin as a fraction of price (0.7 = 70%). */
export function marginFraction(price: number, cost: number): number {
  return price > 0 ? (price - cost) / price : 0;
}

export function segmentName(content: ContentPack, id: string): string {
  return content.segments.find((s) => s.id === id)?.name ?? id;
}

export function traitName(content: ContentPack, id: string): string {
  return content.traits.find((t) => t.id === id)?.name ?? id;
}

/** Ingredient → active dishes that use it, and portions per plate. */
export function ingredientUsage(content: ContentPack, state: GameState): Map<IngredientId, { dishId: DishId; qty: number }[]> {
  const out = new Map<IngredientId, { dishId: DishId; qty: number }[]>();
  for (const m of state.menu) {
    if (!m.active) continue;
    for (const ing of dishById(content, m.dishId)?.ingredients ?? []) {
      const list = out.get(ing.id) ?? [];
      list.push({ dishId: m.dishId, qty: ing.qty });
      out.set(ing.id, list);
    }
  }
  return out;
}
