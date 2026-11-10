/**
 * Round 12 (F) fairness harness: sim-core's scripted "typical" owner, except that on day 1 she swaps the last three
 * dishes of her menu for three sensible dishes she invented (two mains and a pudding, at their suggested prices). Same
 * loop as sim-core's `playOne`, run on a pack with the custom dishes appended by the real content transform.
 */
import { newGame, strategies, type ContentPack, type GameState } from "@full-plate/sim-core";
import { deriveCustomDish, withCustomDishes, type CustomDishSpec } from "../src/customDish";

export const SENSIBLE: CustomDishSpec[] = [
  { id: "custom:burger01", name: "Bacon cheese stack", course: "main", icon: "🍔", createdDay: 0,
    ingredients: [{ id: "beef_mince", qty: 1 }, { id: "burger_buns", qty: 1 }, { id: "cheddar", qty: 1 }, { id: "bacon", qty: 1 }] },
  { id: "custom:pasta001", name: "Garlic mushroom pasta", course: "main", icon: "🍝", createdDay: 0,
    ingredients: [{ id: "pasta", qty: 1 }, { id: "mushrooms", qty: 1.5 }, { id: "garlic", qty: 0.5 }, { id: "cream", qty: 1 }, { id: "parmesan", qty: 0.5 }] },
  { id: "custom:eton0001", name: "Strawberry mess", course: "dessert", icon: "🍨", createdDay: 0,
    ingredients: [{ id: "strawberries", qty: 1 }, { id: "cream", qty: 1 }, { id: "sugar", qty: 0.5 }] },
];
/** A hard one (as hard as the shipped risotto): for tests that want a dish a new chef struggles with. */
export const RISOTTO: CustomDishSpec = { id: "custom:risotto1", name: "Mushroom risotto", course: "main", icon: "🍲", createdDay: 0,
  ingredients: [{ id: "rice", qty: 1.5 }, { id: "mushrooms", qty: 2 }, { id: "parmesan", qty: 1 }, { id: "butter", qty: 1 }, { id: "stock", qty: 1 }] };

const { buyTables, decorate, followTips, playService, resolveEvent, restock, rotas, setUpMenu, staffing, STRATEGIES, stepper } = strategies;

export interface FairResult { seed: number; survived: boolean; customSold: number; final: GameState }

/** One run: typical, or typical with the three invented dishes on the menu from day 1. */
export function playTypical(base: ContentPack, seed: number, days: number, invent: readonly CustomDishSpec[]): FairResult {
  const content = invent.length ? withCustomDishes(base, invent, base) : base;
  const strat = STRATEGIES.typical;
  const step = stepper(content);
  const districtId = content.districts[seed % content.districts.length]!.id;
  let s = newGame(content, { type: "NEW_GAME", seed, districtId, restaurantName: "Headless", difficulty: "normal" });
  // setUpMenu ranks by appeal over the whole pack; the inventor plays the shipped menu first, then swaps.
  s = setUpMenu(base, s, strat, stepper(base));
  // Like for like: each invented dish replaces her least appealing dish of the same course (the menu keeps its shape).
  const district = base.districts.find((d) => d.id === districtId)!;
  const appeal = (id: string) => {
    const d = base.dishes.find((x) => x.id === id)!;
    return Object.entries(district.segmentMix).reduce((a, [seg, w]) => a + w * (d.baseAppeal[seg] ?? 0), 0);
  };
  for (const spec of invent) {
    const same = s.menu.filter((m) => !m.dishId.startsWith("custom:") && base.dishes.find((d) => d.id === m.dishId)?.course === spec.course);
    const out = [...same].sort((a, b) => appeal(a.dishId) - appeal(b.dishId))[0];
    if (out) s = step(s, { type: "REMOVE_MENU_ITEM", dishId: out.dishId });
    s = step(s, { type: "ADD_MENU_ITEM", dishId: spec.id, price: deriveCustomDish(spec, base).suggestedPrice });
  }
  let customSold = 0;
  while (s.day < days && s.phase !== "gameover") {
    s = staffing(content, s, strat, step);
    s = followTips(content, s, strat, step);
    s = rotas(s, strat, step);
    s = buyTables(content, s, strat, step);
    s = playService(content, s, true, true);
    if (s.phase === "evening" || s.phase === "event") s = restock(content, s, strat, step);
    if (s.phase === "evening") s = decorate(content, s, strat, step);
    const h = s.history.at(-1);
    for (const spec of invent) customSold += h?.perDish?.[spec.id]?.sold ?? 0;
    if (s.phase === "evening") s = step(s, { type: "END_DAY" });
    else if (s.phase === "event") s = resolveEvent(content, s, step);
  }
  return { seed, survived: s.phase !== "gameover", customSold, final: s };
}

/** Survival % over seeds 1..n for typical and the inventor. */
export function fairness(base: ContentPack, seeds: number, days = 365): { typical: number; inventor: number; customPerDay: number } {
  let a = 0, b = 0, sold = 0, played = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    if (playTypical(base, seed, days, []).survived) a++;
    const r = playTypical(base, seed, days, SENSIBLE);
    if (r.survived) b++;
    sold += r.customSold;
    played += r.final.day;
  }
  return { typical: (100 * a) / seeds, inventor: (100 * b) / seeds, customPerDay: played ? sold / played : 0 };
}
