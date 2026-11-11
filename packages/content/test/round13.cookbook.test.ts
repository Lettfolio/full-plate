/** Round 13 (D): the cookbook's edits — rename / plate / price, new versions, rest, delete, reorder, the Stars refine. */
import { describe, expect, it } from "vitest";
import {
  applyCustomDishes, content, cookbookOp, CUSTOM_MAX_PER_GAME, CUSTOM_MAX_RECORDS, deriveCustomDish, fullContent, isLive, liveDishes, makeCustomDish,
  olderVersions, REFINE_PROSE, REFINE_SUFFIXES, refineWords, versionName, withCustomDishes, type CookbookCtx, type CookbookMeta, type CookbookUse, type CustomDishRecord,
} from "../src/index";

const rec = (name: string, n = 0, over: Partial<CustomDishRecord> = {}): CustomDishRecord => {
  const made = makeCustomDish([], 7, n, { name, course: "main", icon: "🥧", ingredients: [{ id: "potatoes", qty: 2 }, { id: "cheddar", qty: 1 }] }, content);
  if ("error" in made) throw new Error(made.error);
  return { ...made.dish, ...over };
};
const ctx = (use: Record<string, CookbookUse> = {}, day = 10): CookbookCtx => ({ seed: 7, day, use: (id) => use[id] ?? {} });
const ok = <M extends CookbookMeta>(r: ReturnType<typeof cookbookOp<M>>) => { if ("error" in r) throw new Error(r.error); return r; };

describe("editing a recipe", () => {
  it("renames, re-plates and re-prices in place (same id), and a price on today's menu changes there too", () => {
    const a = rec("Pie");
    const r = ok(cookbookOp<CookbookMeta>({ customDishes: [a] }, { op: "edit", id: a.id, name: "  Big   pie ", icon: "🍲", price: 1295 }, ctx({ [a.id]: { menu: { price: 995, active: true } } }), content));
    expect(r.meta.customDishes).toHaveLength(1);
    expect(r.meta.customDishes![0]).toMatchObject({ id: a.id, name: "Big pie", icon: "🍲", price: 1295, ingredients: a.ingredients });
    expect(r.commands).toEqual([{ type: "SET_MENU_ITEM", dishId: a.id, price: 1295 }]);
    expect(r.meta.cookbookRev).toBe(1);
  });

  it("refuses a name another live recipe has, an empty name, a plate off the list and a silly price", () => {
    const a = rec("Pie"), b = rec("Stew", 1);
    const m = { customDishes: [a, b] };
    expect(cookbookOp(m, { op: "edit", id: b.id, name: "pie" }, ctx(), content)).toEqual({ error: "You already have a dish called pie." });
    expect("error" in cookbookOp(m, { op: "edit", id: b.id, name: "   " }, ctx(), content)).toBe(true);
    expect("error" in cookbookOp(m, { op: "edit", id: b.id, icon: "🐙" }, ctx(), content)).toBe(true);
    expect("error" in cookbookOp(m, { op: "edit", id: b.id, price: 3 }, ctx(), content)).toBe(true);
    expect("error" in cookbookOp(m, { op: "edit", id: b.id, price: 12.5 }, ctx(), content)).toBe(true);
  });

  it("new ingredients make version 2: a new id, sales from zero; v1 keeps its name and lifetime sales", () => {
    const a = rec("Pie", 0, { sold: 34, firstSoldDay: 3, price: 1095 });
    const r = ok(cookbookOp({ customDishes: [a] }, { op: "edit", id: a.id, ingredients: [{ id: "potatoes", qty: 2 }, { id: "cheddar", qty: 1 }, { id: "onions", qty: 1 }] }, ctx({ [a.id]: { menu: { price: 1095, active: true } } }), content));
    const [old, fresh] = r.meta.customDishes!;
    expect(old).toMatchObject({ id: a.id, name: "Pie v1", sold: 34, oldOf: fresh!.id, ingredients: a.ingredients });
    expect(fresh).toMatchObject({ name: "Pie", v: 2, sold: 0, createdDay: 10, price: 1095 });
    expect(fresh!.firstSoldDay).toBeUndefined();
    expect(fresh!.id).not.toBe(a.id);
    expect(r.commands).toEqual([{ type: "REMOVE_MENU_ITEM", dishId: a.id }, { type: "ADD_MENU_ITEM", dishId: fresh!.id, price: 1095 }]);
    expect(liveDishes(r.meta).map((d) => d.id)).toEqual([fresh!.id]);
    expect(olderVersions(r.meta, fresh!.id).map((d) => d.name)).toEqual(["Pie v1"]);
    // a third version keeps the chain, newest first
    const r3 = ok(cookbookOp(r.meta, { op: "edit", id: fresh!.id, ingredients: [{ id: "potatoes", qty: 3 }, { id: "cheddar", qty: 1 }] }, ctx({}, 20), content));
    const v3 = liveDishes(r3.meta)[0]!;
    expect(v3).toMatchObject({ name: "Pie", v: 3 });
    expect(olderVersions(r3.meta, v3.id).map((d) => d.name)).toEqual(["Pie v2", "Pie v1"]);
    expect(r3.commands).toEqual([]);
  });

  it("an off-tonight menu row stays off tonight on the new version", () => {
    const a = rec("Pie");
    const r = ok(cookbookOp({ customDishes: [a] }, { op: "edit", id: a.id, ingredients: [{ id: "potatoes", qty: 1 }, { id: "cheddar", qty: 1 }] }, ctx({ [a.id]: { menu: { price: 900, active: false } } }), content));
    const fresh = r.meta.customDishes![1]!;
    expect(r.commands.at(-1)).toEqual({ type: "SET_MENU_ITEM", dishId: fresh.id, active: false });
  });

  it("won't change the ingredients of a dish on the set menu, in the brand formula or in a parked shop", () => {
    const a = rec("Pie");
    const ing = [{ id: "potatoes", qty: 1 }, { id: "cheddar", qty: 1 }];
    for (const use of [{ setMenu: true }, { formula: true }, { parked: true }]) {
      expect("error" in cookbookOp({ customDishes: [a] }, { op: "edit", id: a.id, ingredients: ing }, ctx({ [a.id]: use }), content)).toBe(true);
      // the name can still change
      expect("error" in cookbookOp({ customDishes: [a] }, { op: "edit", id: a.id, name: "Pie two" }, ctx({ [a.id]: use }), content)).toBe(false);
    }
  });

  it("versionName keeps within 32 characters", () => {
    expect(versionName("A".repeat(32), 3)).toHaveLength(32);
    expect(versionName("Pie", 1)).toBe("Pie v1");
  });
});

describe("rest, delete, move", () => {
  it("rest takes it off today's menu and shelves it; bring back unshelves it", () => {
    const a = rec("Pie");
    const r = ok(cookbookOp({ customDishes: [a] }, { op: "rest", id: a.id, resting: true }, ctx({ [a.id]: { menu: { price: 900, active: true } } }), content));
    expect(r.commands).toEqual([{ type: "REMOVE_MENU_ITEM", dishId: a.id }]);
    expect(r.meta.customDishes![0]!.resting).toBe(true);
    const back = ok(cookbookOp(r.meta, { op: "rest", id: a.id, resting: false }, ctx(), content));
    expect(back.meta.customDishes![0]!.resting).toBeUndefined();
    expect(back.commands).toEqual([]);
  });

  it("delete is refused while the dish is in use anywhere, and otherwise hides it but keeps it in the pack", () => {
    const a = rec("Pie"), b = rec("Stew", 1);
    for (const use of [{ menu: { price: 900, active: false } }, { setMenu: true }, { formula: true }, { parked: true }])
      expect("error" in cookbookOp({ customDishes: [a] }, { op: "delete", id: a.id }, ctx({ [a.id]: use }), content)).toBe(true);
    const r = ok(cookbookOp({ customDishes: [a, b], cookbookOrder: [b.id, a.id] }, { op: "delete", id: a.id }, ctx(), content));
    expect(r.meta.customDishes!.find((d) => d.id === a.id)!.deleted).toBe(true);
    expect(r.meta.cookbookOrder).toEqual([b.id]);
    expect(liveDishes(r.meta).map((d) => d.id)).toEqual([b.id]);
    // still cooked: the transform keeps the dish so old history resolves
    const pack = withCustomDishes(content, r.meta.customDishes!);
    expect(pack.dishes.some((d) => d.id === a.id)).toBe(true);
    expect("error" in cookbookOp(r.meta, { op: "delete", id: a.id }, ctx(), content)).toBe(true);
  });

  it("a deleted dish frees its place: twelve live recipes again, and its name can be reused", () => {
    const twelve = Array.from({ length: CUSTOM_MAX_PER_GAME }, (_, i) => rec(`Dish ${i}`, i));
    expect("error" in makeCustomDish(twelve, 7, 30, { name: "One more", course: "main", icon: "🍲", ingredients: [{ id: "potatoes", qty: 1 }, { id: "onions", qty: 1 }] }, content)).toBe(true);
    const gone = twelve.map((d, i) => (i === 0 ? { ...d, deleted: true } : d));
    const again = makeCustomDish(gone, 7, 30, { name: "Dish 0", course: "main", icon: "🍲", ingredients: [{ id: "potatoes", qty: 1 }, { id: "onions", qty: 1 }] }, content);
    expect("error" in again).toBe(false);
  });

  it("move changes the display order only (the pack's order is the order they were made)", () => {
    const a = rec("Pie"), b = rec("Stew", 1), c = rec("Bake", 2);
    const m = { customDishes: [a, b, c] };
    const r = ok(cookbookOp(m, { op: "move", id: c.id, by: -1 }, ctx(), content));
    expect(liveDishes(r.meta).map((d) => d.name)).toEqual(["Pie", "Bake", "Stew"]);
    expect(r.meta.customDishes).toBe(m.customDishes);
    const edge = ok(cookbookOp(m, { op: "move", id: a.id, by: -1 }, ctx(), content));
    expect(edge.meta).toBe(m);
  });

  it("the archive is capped (live + old versions + deleted)", () => {
    const full = Array.from({ length: CUSTOM_MAX_RECORDS }, (_, i) => rec(`Dish ${i}`, i, i > 0 ? { deleted: true } : {}));
    expect(cookbookOp({ customDishes: full }, { op: "edit", id: full[0]!.id, ingredients: [{ id: "potatoes", qty: 1 }, { id: "onions", qty: 1 }] }, ctx(), content))
      .toEqual({ error: "The cookbook's archive is full: delete an old version first." });
    expect(full.filter(isLive)).toHaveLength(1);
  });
});

describe("the Stars refine", () => {
  it("adds a suffix, a line of menu prose and exactly +1 skill; every other number is the same", () => {
    const a = rec("Pie");
    const r = ok(cookbookOp({ customDishes: [a] }, { op: "refine", id: a.id, season: 4, suffix: 0, prose: 1 }, ctx(), content));
    const d = r.meta.customDishes![0]!;
    expect(refineWords(d)).toEqual({ suffix: REFINE_SUFFIXES[0], prose: REFINE_PROSE[1] });
    const before = deriveCustomDish(a, content);
    const after = deriveCustomDish(d, content);
    expect(after.name).toBe(`Pie, ${REFINE_SUFFIXES[0]}`);
    expect(after.blurb).toBe(REFINE_PROSE[1]);
    expect(after.skillRequired).toBe(before.skillRequired + 1);
    const { name: _n, blurb: _b, skillRequired: _s, ...restAfter } = after;
    const { name: _n2, blurb: _b2, skillRequired: _s2, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
  });

  it("one dish a season, each dish once; pools have enough to pick from", () => {
    expect(REFINE_SUFFIXES.length).toBeGreaterThanOrEqual(6);
    expect(REFINE_PROSE.length).toBeGreaterThanOrEqual(8);
    const a = rec("Pie"), b = rec("Stew", 1);
    const r = ok(cookbookOp({ customDishes: [a, b] }, { op: "refine", id: a.id, season: 4, suffix: 0, prose: 0 }, ctx(), content));
    expect("error" in cookbookOp(r.meta, { op: "refine", id: b.id, season: 4, suffix: 1, prose: 1 }, ctx(), content)).toBe(true);
    expect("error" in cookbookOp(r.meta, { op: "refine", id: a.id, season: 5, suffix: 1, prose: 1 }, ctx(), content)).toBe(true);
    expect("error" in cookbookOp(r.meta, { op: "refine", id: b.id, season: 5, suffix: 99, prose: 1 }, ctx(), content)).toBe(true);
    expect("error" in cookbookOp(r.meta, { op: "refine", id: b.id, season: 5, suffix: 1, prose: 1 }, ctx(), content)).toBe(false);
  });

  it("the packs pick up a refine (the transform re-derives on a changed recipe)", () => {
    const a = rec("Pie");
    const roots = [{ ...fullContent, dishes: [...fullContent.dishes] }];
    applyCustomDishes(roots, [a], content);
    const plain = roots[0]!.dishes.find((d) => d.id === a.id)!;
    applyCustomDishes(roots, [{ ...a, refined: { season: 1, suffix: 2, prose: 3 } }], content);
    const fancy = roots[0]!.dishes.find((d) => d.id === a.id)!;
    expect(fancy.skillRequired).toBe(plain.skillRequired + 1);
    expect(fancy.name).toContain(REFINE_SUFFIXES[2]!);
    applyCustomDishes(roots, [], content);
  });
});
