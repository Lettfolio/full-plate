import type { ContentPack, DishDef } from "@full-plate/sim-core";
import { inLibrary, tagsOf } from "../sim";

/** The path the player chose at the fork (undefined before it, and for the whole career). */
export type PathKind = "empire" | "stars";

/** Recipe-book section a dish belongs to: the starter library, or a path set unlocked by the fork. */
export type LibrarySection = "library" | "fast_food" | "fine_dining";

export function sectionOf(dishId: string): LibrarySection {
  if (inLibrary(dishId)) return "library";
  return tagsOf(dishId).includes("fast_food") ? "fast_food" : "fine_dining";
}

/** Whether the recipe book offers a dish: library dishes always; fast food after Empire; fine dining after Stars. */
export function dishUnlocked(dishId: string, path: PathKind | undefined): boolean {
  const s = sectionOf(dishId);
  return s === "library" || (s === "fast_food" && path === "empire") || (s === "fine_dining" && path === "stars");
}

export function recipeBook(content: ContentPack, path: PathKind | undefined): DishDef[] {
  return content.dishes.filter((d) => dishUnlocked(d.id, path));
}
