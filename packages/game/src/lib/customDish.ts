/**
 * Round 12 (F): invented dishes, game side. The recipes live in PathMeta (`meta.customDishes`, saved with the game) and
 * are put into the content packs by `syncCustomDishes` (sim.ts): the content transform `applyCustomDishes` turns each
 * into an ordinary DishDef, so the sim cooks, prices, sells and reviews it like any shipped dish. GameState is untouched.
 *
 * The helpers (making a recipe, folding each day's sales into the cookbook, the Evening's first-night line) live in
 * packages/content/src/customDish.ts, in the content chunk, so the main chunk only carries these few lines.
 */
import { canInventIn, type CustomDishDraft, type CustomDishRecord } from "@full-plate/content";
import type { PathMeta } from "../state/paths";

export type CustomDish = CustomDishRecord;
export type { CustomDishDraft };

/** The player can invent here: an owner's game (or a career that became their own place), up to 12 recipes. */
export const canInvent: (meta: PathMeta | undefined) => boolean = canInventIn;
