/**
 * Round 14 (F, G9): an invented dish's description is built from its ingredients' names, so the whole-string swap of
 * "Hide alcoholic drinks" never matched it: a recipe made with lager kept "draught lager" after a parent switched the
 * setting on. Now the setting re-words it at once, both ways, and a recipe made with the setting on reads soft.
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyCustomDishes, applySoftDrinks, content, extras, fullContent, GROWN_UP_WORDS, SOFT_INGREDIENTS, softIngredientWords } from "../src/index";
import type { CustomDishSpec } from "../src/index";

const pours = Object.keys(SOFT_INGREDIENTS).filter((id) => content.ingredients.some((i) => i.id === id));
const spec = (id: string, drink: string): CustomDishSpec => ({ id, name: "Burger float", course: "main", icon: "🍔", createdDay: 3, ingredients: [{ id: "burger_buns", qty: 1 }, { id: drink, qty: 1 }] }) as CustomDishSpec;
const pack = () => ({ ...fullContent, dishes: fullContent.dishes.filter((d) => !d.id.startsWith("custom:")) });

afterEach(() => { applySoftDrinks([fullContent, content, extras], false); });

describe("Round 14 F — G9 invented dishes and Hide alcoholic drinks", () => {
  it("switching the setting on after a recipe was made re-words its description, and off puts it back", () => {
    expect(pours.length).toBeGreaterThanOrEqual(3);
    const p = pack();
    const specs = pours.map((x, i) => spec(`custom:rt14s${String(i).padStart(3, "0")}`, x));
    applyCustomDishes([p], specs, content);
    const mine = () => p.dishes.filter((d) => d.id.startsWith("custom:"));
    const before = mine().map((d) => d.blurb);
    expect(before.filter((b) => GROWN_UP_WORDS.test(b ?? "")).length).toBeGreaterThan(0);
    applySoftDrinks([p, content, extras], true);
    for (const d of mine()) expect(GROWN_UP_WORDS.test(d.blurb ?? ""), d.blurb).toBe(false);
    applySoftDrinks([p, content, extras], false);
    expect(mine().map((d) => d.blurb)).toEqual(before);
  });

  it("a recipe made with the setting already on reads soft", () => {
    applySoftDrinks([fullContent, content, extras], true);
    const p = pack();
    applyCustomDishes([p], [spec("custom:rt14son1", "lager")], content);
    const d = p.dishes.find((x) => x.id === "custom:rt14son1")!;
    expect(d.blurb).toContain(softIngredientWords().get("draught lager"));
    expect(GROWN_UP_WORDS.test(d.blurb ?? "")).toBe(false);
  });
});
