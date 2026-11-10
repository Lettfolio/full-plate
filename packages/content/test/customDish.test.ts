/** Round 12 (F): invented dishes — the content transform, its maths and its limits. */
import { describe, expect, it } from "vitest";
import {
  addCustomDish, applyCustomDishes, checkCustomDish, cleanDishName, content, CUSTOM_MAX_PER_GAME, customDishFacts, customDishId,
  deriveCustomDish, dishCost, foldCookbook, fullContent, guessPopularity, makeCustomDish, newDishReview, NEW_DISH_REVIEWS,
  pickableIngredients, validateContent, withCustomDishes, withNewDishReview, type CustomDishRecord, type CustomDishSpec,
} from "../src/index";
import { playTypical, SENSIBLE } from "./inventor";

const spec = (over: Partial<CustomDishSpec> = {}): CustomDishSpec => ({
  id: "custom:abc12345", name: "Test bake", course: "main", icon: "🥧", createdDay: 0,
  ingredients: [{ id: "potatoes", qty: 2 }, { id: "cheddar", qty: 1 }, { id: "onions", qty: 1 }], ...over,
});
const realOf = (course: string) => content.dishes.filter((d) => d.course === course);
const q75 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const pos = (s.length - 1) * 0.75; return s[Math.floor(pos)]! + (s[Math.ceil(pos)]! - s[Math.floor(pos)]!) * (pos - Math.floor(pos)); };

describe("deriving a dish from a recipe", () => {
  it("is a pure function of the recipe (same numbers every time, no randomness)", () => {
    const a = deriveCustomDish(spec(), content);
    const b = deriveCustomDish(JSON.parse(JSON.stringify(spec())), content);
    expect(b).toEqual(a);
  });

  it("costs the real ingredients, and the suggested price covers them at the course's usual share", () => {
    for (const s of SENSIBLE) {
      const d = deriveCustomDish(s, content);
      const cost = dishCost(content, d);
      const expected = s.ingredients.reduce((a, x) => a + content.ingredients.find((i) => i.id === x.id)!.unitCost * x.qty, 0);
      expect(cost).toBe(Math.round(expected));
      expect(d.suggestedPrice).toBeGreaterThan(cost);
      expect(d.suggestedPrice % 5).toBe(0);
      const shares = realOf(s.course).map((r) => dishCost(content, r) / r.suggestedPrice).sort((x, y) => x - y);
      expect(cost / d.suggestedPrice).toBeGreaterThanOrEqual(shares[0]! - 0.02);
      expect(cost / d.suggestedPrice).toBeLessThanOrEqual(shares.at(-1)! + 0.02);
    }
  });

  it("needs more skill and more prep time with every ingredient past two", () => {
    const two = deriveCustomDish(spec({ ingredients: [{ id: "potatoes", qty: 1 }, { id: "cheddar", qty: 1 }] }), content);
    const five = deriveCustomDish(spec({ ingredients: [{ id: "potatoes", qty: 1 }, { id: "cheddar", qty: 1 }, { id: "onions", qty: 1 }, { id: "leeks", qty: 1 }, { id: "cream", qty: 1 }] }), content);
    expect(five.skillRequired).toBeGreaterThan(two.skillRequired);
    expect(five.prepTicks).toBeGreaterThanOrEqual(two.prepTicks);
  });

  it("never beats the best quarter of the course's real dishes for any guest type", () => {
    const pool = pickableIngredients(content).map((i) => i.id);
    for (const course of ["starter", "main", "dessert", "drink"] as const) {
      for (let k = 0; k + 3 <= pool.length; k += 3) {
        const d = deriveCustomDish(spec({ course, ingredients: pool.slice(k, k + 3).map((id) => ({ id, qty: 1 })) }), content);
        for (const seg of content.segments) expect(d.baseAppeal[seg.id], `${course} ${pool.slice(k, k + 3)} ${seg.id}`).toBeLessThanOrEqual(q75(realOf(course).map((r) => r.baseAppeal[seg.id]!)) + 1e-9);
        const ceilings = realOf(course).map((r) => r.qualityCeiling).sort((x, y) => x - y);
        expect(d.qualityCeiling).toBeLessThanOrEqual(ceilings[Math.ceil((ceilings.length - 1) / 2)]!);
      }
    }
  });

  it("an absurdly expensive plate is dear and a hard sell; a thin plate loses appeal", () => {
    const silly = customDishFacts(spec({ ingredients: ["beef_steak", "scallops", "duck_breast", "lamb", "asparagus"].map((id) => ({ id, qty: 3 })) }), content);
    expect(silly.priceBand).toBeGreaterThan(5);
    expect(guessPopularity(silly.dish, content, content.districts[0]!.id).band).toBe("hard");
    const sensible = customDishFacts(SENSIBLE[0]!, content);
    expect(guessPopularity(sensible.dish, content, content.districts[0]!.id).band).not.toBe("hard");
    const thin = customDishFacts(spec({ ingredients: [{ id: "rice", qty: 0.25 }, { id: "herbs", qty: 0.25 }] }), content);
    expect(thin.portion).toBeLessThan(0.75);
  });

  it("reads its cuisine from the ingredients and knows a vegetarian plate", () => {
    const pasta = customDishFacts(spec({ ingredients: [{ id: "pasta", qty: 1 }, { id: "parmesan", qty: 1 }, { id: "tomatoes", qty: 1 }] }), content);
    expect(pasta.cuisine).toBe("italian");
    expect(pasta.vegetarian).toBe(true);
    expect(customDishFacts(SENSIBLE[0]!, content).vegetarian).toBe(false);
    expect(customDishFacts(SENSIBLE[1]!, content).vegetarian).toBe(true);
  });
});

describe("calibration against the shipped dishes", () => {
  it("run on the real dishes' own recipes, the model lands near their real skill, prep, price and appeal", () => {
    const rows: { skill: number; prep: number; price: number; appeal: number }[] = [];
    for (const d of content.dishes) {
      if (!["starter", "main", "dessert", "drink"].includes(d.course) || d.ingredients.length < 2 || d.ingredients.length > 5) continue;
      const ingredients = d.ingredients.map((x) => ({ id: x.id, qty: Math.min(3, Math.max(0.25, Math.round(x.qty * 4) / 4)) }));
      const f = customDishFacts(spec({ course: d.course as CustomDishSpec["course"], ingredients }), content).dish;
      const mean = (a: Record<string, number>) => content.segments.reduce((t, s) => t + a[s.id]!, 0) / content.segments.length;
      rows.push({ skill: f.skillRequired - d.skillRequired, prep: f.prepTicks - d.prepTicks, price: f.suggestedPrice / d.suggestedPrice, appeal: mean(f.baseAppeal) - mean(d.baseAppeal) });
    }
    const avg = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
    expect(rows.length).toBeGreaterThan(25);
    expect(avg("skill")).toBeGreaterThanOrEqual(0); // errs on the harder side…
    expect(avg("skill")).toBeLessThan(8); // …by a few points
    expect(Math.abs(avg("prep"))).toBeLessThan(1);
    expect(avg("price")).toBeGreaterThan(0.85);
    expect(avg("price")).toBeLessThan(1.05);
    expect(avg("appeal")).toBeLessThanOrEqual(0.02); // never more popular than the real thing on average
    expect(avg("appeal")).toBeGreaterThan(-0.08);
  });
});

describe("checking a recipe", () => {
  it("accepts the sensible ones and the shapes the sheet makes", () => {
    for (const s of SENSIBLE) expect(checkCustomDish(s, content)).toEqual([]);
  });
  it("refuses bad ids, names, courses, icons, counts, quantities and unknown ingredients", () => {
    const bad: [string, Partial<CustomDishSpec>][] = [
      ["id", { id: "tomato_soup" }], ["id", { id: "custom:../../x" }], ["name", { name: "" }], ["name", { name: "x".repeat(33) }],
      ["name", { name: "Evil‮name" }], ["course", { course: "side" as never }], ["icon", { icon: "💣" }],
      ["count", { ingredients: [{ id: "potatoes", qty: 1 }] }],
      ["count", { ingredients: ["potatoes", "onions", "leeks", "cream", "butter", "eggs"].map((id) => ({ id, qty: 1 })) }],
      ["qty", { ingredients: [{ id: "potatoes", qty: 0.1 }, { id: "onions", qty: 1 }] }],
      ["qty", { ingredients: [{ id: "potatoes", qty: 9 }, { id: "onions", qty: 1 }] }],
      ["qty", { ingredients: [{ id: "potatoes", qty: 1.3 }, { id: "onions", qty: 1 }] }],
      ["unknown", { ingredients: [{ id: "unobtainium", qty: 1 }, { id: "onions", qty: 1 }] }],
      ["not food", { ingredients: [{ id: "toy_surprise", qty: 1 }, { id: "onions", qty: 1 }] }],
      ["twice", { ingredients: [{ id: "onions", qty: 1 }, { id: "onions", qty: 1 }] }],
    ];
    for (const [why, over] of bad) expect(checkCustomDish(spec(over), content).length, why).toBeGreaterThan(0);
  });
  it("cleans a name like a restaurant name: no bidi, zero-width or control characters, 32 characters", () => {
    expect(cleanDishName("  Mum's‮ ​pie\n\tdeluxe ")).toBe("Mum's pie deluxe");
    expect([...cleanDishName("🍕".repeat(40))]).toHaveLength(32);
    expect(cleanDishName("Family 👨‍👩‍👧 feast")).toBe("Family 👨‍👩‍👧 feast"); // the joiner stays
  });
});

describe("the transform", () => {
  it("appends the derived dishes to a new pack that still validates; the shipped pack is untouched", () => {
    const before = content.dishes;
    const pack = withCustomDishes(content, SENSIBLE);
    expect(content.dishes).toBe(before);
    expect(pack.dishes.length).toBe(before.length + SENSIBLE.length);
    expect(validateContent(pack)).toEqual([]);
  });

  it("applyCustomDishes replaces the packs' dish arrays, is idempotent and can be emptied again", () => {
    const pack = { ...fullContent };
    const shipped = pack.dishes;
    expect(applyCustomDishes([pack], SENSIBLE, content)).toBe(true);
    const once = pack.dishes;
    expect(once).not.toBe(shipped);
    expect(once.filter((d) => d.id.startsWith("custom:"))).toHaveLength(3);
    expect(applyCustomDishes([pack], [...SENSIBLE], content)).toBe(false);
    expect(pack.dishes).toBe(once);
    expect(applyCustomDishes([pack], [], content)).toBe(true);
    expect(pack.dishes.map((d) => d.id)).toEqual(shipped.map((d) => d.id));
  });

  it("the sim cooks, prices, sells and reviews an invented dish like a shipped one", () => {
    const r = playTypical(content, 7, 10, SENSIBLE);
    expect(r.customSold).toBeGreaterThan(0);
    const lines = r.final.history.flatMap((h) => SENSIBLE.map((sp) => h.perDish?.[sp.id]).filter((x) => !!x));
    expect(lines.some((l) => l!.qualityMean > 0 && l!.revenue > 0 && (l!.foodCost ?? 0) > 0)).toBe(true);
    expect(r.final.menu.find((m) => m.dishId === SENSIBLE[0]!.id)?.price).toBe(deriveCustomDish(SENSIBLE[0]!, content).suggestedPrice);
  });
});

describe("the cookbook", () => {
  const meta = (dishes: CustomDishRecord[] = [], cookbookDay?: number) => ({ mode: "owner", customDishes: dishes, ...(cookbookDay !== undefined ? { cookbookDay } : {}) });

  it("makes a recipe with a stable hashed id and refuses duplicates and a full book", () => {
    const a = makeCustomDish([], 42, 3, { name: " Pie ", course: "main", icon: "🥧", ingredients: spec().ingredients }, content);
    expect("dish" in a && a.dish.id).toMatch(/^custom:[a-z0-9]{8}$/);
    expect("dish" in a && a.dish.name).toBe("Pie");
    const b = makeCustomDish([], 42, 3, { name: "Pie", course: "main", icon: "🥧", ingredients: spec().ingredients }, content);
    expect("dish" in a && "dish" in b && a.dish.id === b.dish.id).toBe(true);
    const have = "dish" in a ? [a.dish] : [];
    expect(makeCustomDish(have, 42, 3, { name: "pie", course: "main", icon: "🥧", ingredients: spec().ingredients }, content)).toHaveProperty("error");
    const full = Array.from({ length: CUSTOM_MAX_PER_GAME }, (_, i) => ({ ...spec({ id: customDishId(1, 0, i, `d${i}`), name: `d${i}` }), sold: 0 }));
    expect(makeCustomDish(full, 1, 0, { name: "One more", course: "main", icon: "🥧", ingredients: spec().ingredients }, content)).toHaveProperty("error");
    expect(addCustomDish(meta(full), { ...spec({ id: "custom:zzzzzzzz", name: "One more" }), sold: 0 }, 0, content).customDishes).toHaveLength(CUSTOM_MAX_PER_GAME);
  });

  it("folds each new day's sales once, records the first night, and the Evening's line is stable", () => {
    const d: CustomDishRecord = { ...SENSIBLE[0]!, sold: 0 };
    const h = (day: number, sold: number) => ({ day, perDish: sold ? { [d.id]: { sold, qualityMean: 70 } } : {} });
    let m = addCustomDish(meta(), d, 2, content);
    expect(m.cookbookDay).toBe(2);
    m = foldCookbook(m, [h(1, 9), h(2, 9), h(3, 0)]);
    expect(m.customDishes![0]!.sold).toBe(0);
    m = foldCookbook(m, [h(3, 0), h(4, 5)]);
    expect(m.customDishes![0]).toMatchObject({ sold: 5, firstSoldDay: 4 });
    expect(foldCookbook(m, [h(4, 5)])).toBe(m); // nothing new: same object
    m = foldCookbook(m, [h(4, 5), h(5, 3)]);
    expect(m.customDishes![0]).toMatchObject({ sold: 8, firstSoldDay: 4 });
    const line = newDishReview(m, 1, "Chez Test", h(4, 5));
    expect(line?.text).toContain(d.name);
    expect(NEW_DISH_REVIEWS.map((t) => t.replaceAll("{dish}", d.name).replaceAll("{restaurant}", "Chez Test"))).toContain(line!.text);
    expect(newDishReview(m, 1, "Chez Test", h(4, 5))).toEqual(line);
    expect(newDishReview(m, 1, "Chez Test", h(5, 3))).toBeNull();
    const reviews = withNewDishReview([], m, 1, "Chez Test", h(4, 5));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ source: "wordofmouth", dishId: d.id, rating: 4 });
  });

  it("the new-dish lines use only {dish} and {restaurant}, and there are eight", () => {
    expect(NEW_DISH_REVIEWS).toHaveLength(8);
    for (const l of NEW_DISH_REVIEWS) for (const ph of l.match(/\{[^}]*\}/g) ?? []) expect(["{dish}", "{restaurant}"]).toContain(ph);
  });
});
