import type { ContentPack, DishCourse, DishDef, GameState } from "@full-plate/sim-core";
import { inLibrary } from "../sim";

/** How many of each course the suggested starter menu takes (7 dishes). */
const SHAPE: [DishCourse, number][] = [["main", 3], ["starter", 1], ["side", 1], ["dessert", 1], ["drink", 1]];
/** Prefer dishes a new (or the owner, skill 40) cook can manage. */
const EASY_SKILL = 45;

/**
 * A sensible first menu for the district: the dishes its passers-by like most, weighted by the
 * district's segment mix, favouring easy recipes. Library dishes only (never the fast-food or fine-dining
 * path sets). Pure; the UI adds them with ADD_MENU_ITEM.
 */
export function suggestedStarterMenu(content: ContentPack, game: GameState): DishDef[] {
  const district = content.districts.find((d) => d.id === game.districtId);
  const mix = district?.segmentMix ?? {};
  const onMenu = new Set(game.menu.map((m) => m.dishId));
  const score = (d: DishDef) => {
    const appeal = Object.entries(mix).reduce((a, [seg, w]) => a + w * (d.baseAppeal[seg] ?? 0), 0);
    return appeal - (d.skillRequired > EASY_SKILL ? 0.15 : 0);
  };
  const picks: DishDef[] = [];
  for (const [course, n] of SHAPE) {
    const pool = content.dishes
      .filter((d) => d.course === course && !onMenu.has(d.id) && inLibrary(d.id))
      .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    picks.push(...pool.slice(0, n));
  }
  return picks;
}
