/** Kasavana–Smith menu engineering matrix over the rolling 7-day window. */
import { MENU_POPULARITY_RULE } from "./constants";
import type { ContentPack, DishId, GameState, MenuItem, MenuQuadrant } from "./types";

/**
 * Popularity: sold7d ≥ 70% of the mean share (the classic 70% rule).
 * Profitability: margin per plate ≥ the sales-weighted mean margin per plate.
 * Dishes with no sales are "dog". Content is unused but kept for API symmetry.
 */
export function classifyMenu(_content: ContentPack, state: GameState): Record<DishId, MenuQuadrant> {
  const items = state.menu.filter((m) => m.active);
  const out: Record<DishId, MenuQuadrant> = {};
  if (items.length === 0) return out;
  const totalSold = items.reduce((a, m) => a + m.sold7d, 0);
  const totalMargin = items.reduce((a, m) => a + m.margin7d, 0);
  const meanSold = totalSold / items.length;
  const meanMarginPerPlate = totalSold ? totalMargin / totalSold : 0;
  for (const m of items) out[m.dishId] = quadrantOf(m, meanSold, meanMarginPerPlate);
  return out;
}

function quadrantOf(m: MenuItem, meanSold: number, meanMarginPerPlate: number): MenuQuadrant {
  if (m.sold7d <= 0) return "dog";
  const popular = m.sold7d >= MENU_POPULARITY_RULE * meanSold;
  const profitable = m.margin7d / m.sold7d >= meanMarginPerPlate;
  if (popular) return profitable ? "star" : "ploughhorse";
  return profitable ? "puzzle" : "dog";
}
