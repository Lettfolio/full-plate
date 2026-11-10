import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  careerText, cityById, content, countries, criticText, dishBreaksRule, dishCost, dishesWithTag, dishMargin, dishTags, extras, fill,
  formulas, fullContent, goalText, incidentText, inLibrary, LIBRARY_HIDDEN_DISH_IDS, libraryPack, rulesTextForCity, tagsOf,
  tastingMenus, validateContent, validateExtras, wineList, world,
} from "../src/index";
import type { Extras } from "../src/index";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const dish = (id: string) => fullContent.dishes.find((d) => d.id === id)!;
const ff = dishesWithTag("fast_food");
const fd = dishesWithTag("fine_dining");
const fdFood = fd.filter((d) => !tagsOf(d.id).includes("wine"));

describe("extras load and validate", () => {
  it("the shipped extras and full pack are valid", () => {
    expect(validateContent(fullContent)).toEqual([]);
    expect(validateExtras(extras, fullContent)).toEqual([]);
  });
  it("typed getters point at the validated extras", () => {
    expect(dishTags).toBe(extras.dishTags);
    expect(world.cities).toBe(extras.world.cities);
    expect(formulas).toBe(extras.formulas);
  });
});

describe("library vs full pack", () => {
  it("the default `content` pack hides every path dish and their exclusive ingredients", () => {
    for (const id of LIBRARY_HIDDEN_DISH_IDS) expect(content.dishes.some((d) => d.id === id), id).toBe(false);
    const used = new Set(content.dishes.flatMap((d) => d.ingredients.map((i) => i.id)));
    for (const i of content.ingredients) expect(used.has(i.id), i.id).toBe(true);
    expect(content.dishes).toHaveLength(71);
    expect(content.ingredients).toHaveLength(62);
  });
  it("the full pack is the library plus the path dishes", () => {
    expect(fullContent.dishes.length).toBe(content.dishes.length + LIBRARY_HIDDEN_DISH_IDS.length);
    for (const d of content.dishes) expect(fullContent.dishes.find((x) => x.id === d.id)).toEqual(d);
    const used = new Set(fullContent.dishes.flatMap((d) => d.ingredients.map((i) => i.id)));
    for (const i of fullContent.ingredients) expect(used.has(i.id), i.id).toBe(true);
  });
  it("every hidden dish is a tagged path dish, and inLibrary agrees", () => {
    for (const id of LIBRARY_HIDDEN_DISH_IDS) {
      expect(inLibrary(id)).toBe(false);
      expect(tagsOf(id).includes("fast_food") || tagsOf(id).includes("fine_dining"), id).toBe(true);
    }
    expect(inLibrary("beef_burger")).toBe(true);
    expect(libraryPack(fullContent).dishes.map((d) => d.id)).toEqual(content.dishes.map((d) => d.id));
  });
  it("the shipped library data is unchanged from round 2 (headless balance stays put)", () => {
    // ids only; prices/appeal are covered by content.test.ts
    expect(content.dishes.some((d) => d.id.startsWith("ff_") || d.id.startsWith("fd_"))).toBe(false);
  });
});

describe("fast-food set (Path A)", () => {
  it("has ~20 counter-service dishes across burgers, fries, wraps, shakes, breakfast and kids' meals", () => {
    expect(ff.length).toBeGreaterThanOrEqual(20);
    for (const t of ["burger", "fries", "wrap", "shake", "breakfast", "kids_meal"] as const) expect(ff.some((d) => tagsOf(d.id).includes(t)), t).toBe(true);
  });
  it("is easy, quick, capped and cheap to run", () => {
    for (const d of ff) {
      expect(d.skillRequired, d.id).toBeGreaterThanOrEqual(10);
      expect(d.skillRequired, d.id).toBeLessThanOrEqual(30);
      expect(d.prepTicks, d.id).toBeLessThanOrEqual(2);
      expect(d.qualityCeiling, d.id).toBeGreaterThanOrEqual(55);
      expect(d.qualityCeiling, d.id).toBeLessThanOrEqual(75);
      expect(["american", "cafe"]).toContain(d.cuisine);
      expect(dishMargin(fullContent, d), d.id).toBeGreaterThanOrEqual(0.65);
    }
  });
  it("appeals to students and families, not foodies", () => {
    for (const d of ff) {
      // the counter coffee is the one commuter item: it leans business instead
      const fans = d.id === "ff_counter_coffee" ? d.baseAppeal.business! : Math.max(d.baseAppeal.students!, d.baseAppeal.families!);
      expect(fans, d.id).toBeGreaterThanOrEqual(0.75);
      expect(d.baseAppeal.foodies!, d.id).toBeLessThanOrEqual(0.15);
    }
  });
  it("uses long-life ingredients (frozen, dry, mixes) for its core lines", () => {
    for (const id of ["frozen_fries", "beef_patty", "chicken_nuggets", "shake_mix", "hash_browns", "chicken_fillet_crumbed"]) {
      expect(fullContent.ingredients.find((i) => i.id === id)!.shelfLifeDays, id).toBeGreaterThanOrEqual(90);
    }
  });
  it("formulas: 3 presets of 4–8 fast-food dishes with a main, and dietary claims hold", () => {
    expect(formulas).toHaveLength(3);
    for (const f of formulas) {
      expect(f.menuDishIds.length).toBeGreaterThanOrEqual(4);
      expect(f.menuDishIds.length).toBeLessThanOrEqual(8);
      for (const id of f.menuDishIds) expect(tagsOf(id), id).toContain("fast_food");
      for (const r of f.dietarySafe ?? []) for (const id of f.menuDishIds) expect(dishBreaksRule(fullContent, countries, id, r), `${f.id} ${id} ${r}`).toBe(false);
    }
    expect(formulas.some((f) => f.dietarySafe?.includes("no-beef"))).toBe(true);
  });
});

describe("fine-dining set (Path B)", () => {
  it("has ~20 dishes covering amuse, starter, fish, meat, pre-dessert and dessert", () => {
    expect(fdFood.length).toBeGreaterThanOrEqual(20);
    for (const t of ["amuse", "starter_course", "fish_course", "meat_course", "pre_dessert", "dessert_course"] as const)
      expect(fdFood.some((d) => tagsOf(d.id).includes(t)), t).toBe(true);
    expect(fdFood.filter((d) => tagsOf(d.id).includes("signature_candidate")).length).toBeGreaterThanOrEqual(6);
  });
  it("is demanding, slow and has a high ceiling", () => {
    for (const d of fdFood) {
      expect(d.skillRequired, d.id).toBeGreaterThanOrEqual(65);
      expect(d.skillRequired, d.id).toBeLessThanOrEqual(90);
      expect(d.prepTicks, d.id).toBeGreaterThanOrEqual(3);
      expect(d.prepTicks, d.id).toBeLessThanOrEqual(6);
      expect(d.qualityCeiling, d.id).toBeGreaterThanOrEqual(88);
      expect(d.qualityCeiling, d.id).toBeLessThanOrEqual(98);
      expect(d.baseAppeal.foodies!, d.id).toBeGreaterThanOrEqual(0.85);
      expect(d.baseAppeal.business!, d.id).toBeGreaterThanOrEqual(0.6);
      expect(d.baseAppeal.students!, d.id).toBeLessThanOrEqual(0.15);
      expect(dishMargin(fullContent, d), d.id).toBeGreaterThanOrEqual(0.65);
    }
  });
  it("uses the seasonal luxury larder", () => {
    for (const id of ["scallops", "turbot", "venison_loin", "black_truffle", "wye_asparagus", "langoustines"]) {
      expect(fdFood.some((d) => d.ingredients.some((i) => i.id === id)), id).toBe(true);
    }
    for (const id of ["turbot", "venison_loin", "black_truffle", "wye_asparagus", "langoustines"])
      expect(fullContent.ingredients.find((i) => i.id === id)!.seasonality, id).toBeDefined();
  });
  it("wine list: 8 bottles at 2.5–4× cost, each with a region and note, graduated so cheaper bottles carry more", () => {
    expect(wineList).toHaveLength(8);
    for (const w of wineList) {
      const mk = w.bottlePrice / w.bottleCost;
      expect(mk, w.id).toBeGreaterThanOrEqual(2.5);
      expect(mk, w.id).toBeLessThanOrEqual(4);
      expect(w.region.length).toBeGreaterThan(2);
      expect(w.note.length).toBeGreaterThan(10);
      expect(tagsOf(w.glassDishId)).toContain("wine");
      expect(dish(w.glassDishId).blurb).toMatch(/Over-18s only/);
    }
    const sorted = [...wineList].sort((a, b) => a.bottleCost - b.bottleCost);
    expect(sorted[0]!.bottlePrice / sorted[0]!.bottleCost).toBeGreaterThan(sorted.at(-1)!.bottlePrice / sorted.at(-1)!.bottleCost);
  });
  it("tasting menus: 3 templates, every seasonal ingredient in season, priced above cost", () => {
    expect(tastingMenus).toHaveLength(3);
    for (const m of tastingMenus) {
      const food = m.courses.reduce((a, c) => a + dishCost(fullContent, dish(c.dishId)), 0);
      expect(m.pricePerHead, m.id).toBeGreaterThan(food * 2.5);
      expect(m.courses.length).toBeGreaterThanOrEqual(6);
      expect(m.winePairing.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("world", () => {
  it("mirrors sim-empire world.ts: same 12 city ids, 5 regions, 4 suppliers and core numbers", () => {
    const src = readFileSync(new URL("../../sim-empire/src/world.ts", import.meta.url), "utf8");
    const cityIds = [...src.matchAll(/\{ id: "([a-z_]+)", name: "[^"]+", country/g)].map((m) => m[1]);
    expect(world.cities.map((c) => c.id)).toEqual(cityIds);
    const regionIds = [...src.matchAll(/\{ id: "([a-z_]+)", name: "[^"]+", commissary/g)].map((m) => m[1]);
    expect(world.regions.map((r) => r.id)).toEqual(regionIds);
    const supplierIds = [...src.matchAll(/\{ id: "([a-z_]+)", name: "[^"]+", category/g)].map((m) => m[1]);
    expect(world.suppliers.map((s) => s.id)).toEqual(supplierIds);
    for (const c of world.cities) {
      const line = src.split("\n").find((l) => l.includes(`id: "${c.id}"`))!;
      expect(line, c.id).toContain(`population: ${c.population.toLocaleString("en-GB").replace(/,/g, "_")}`);
      expect(line, c.id).toContain(`costIndex: ${c.costIndex}`);
      expect(line, c.id).toContain(`dietaryRules: ${JSON.stringify(c.dietaryRules).replace(/,/g, ", ")}`);
      if (c.localChampion) expect(line, c.id).toContain(`localChampion: "${c.localChampion}", championStrength: ${c.championStrength}`);
      expect(line, c.id).toContain(`x: ${c.x}, y: ${c.y}`);
    }
  });
  it("city ids are unique, each has a blurb, and every country has rules text", () => {
    expect(new Set(world.cities.map((c) => c.id)).size).toBe(12);
    for (const c of world.cities) {
      expect(c.blurb.length, c.id).toBeGreaterThan(20);
      expect(rulesTextForCity(c.id).length, c.id).toBeGreaterThan(0);
    }
    expect(cityById("vasant")!.dietaryRules).toEqual(["no-beef", "no-pork"]);
  });
  it("dietary breakers cover sim-empire's lists and the new ingredients", () => {
    expect(countries.dietaryBreakers["no-beef"]).toEqual(expect.arrayContaining(["beef_steak", "beef_mince", "beef_patty"]));
    expect(dishBreaksRule(fullContent, countries, "ff_classic_stacker", "kosher")).toBe(true); // meat + cheese
    expect(dishBreaksRule(fullContent, countries, "ff_classic_stacker", "no-beef")).toBe(true);
    expect(dishBreaksRule(fullContent, countries, "ff_crispy_chicken_bun", "no-beef")).toBe(false);
    expect(dishBreaksRule(fullContent, countries, "ff_sausage_muffin", "halal")).toBe(true);
    expect(dishBreaksRule(fullContent, countries, "fd_lobster_peas", "kosher")).toBe(true);
    expect(dishBreaksRule(fullContent, countries, "fd_wine_rioja", "halal")).toBe(true);
  });
});

describe("text collections", () => {
  const strings = (v: unknown): string[] =>
    typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.entries(v).filter(([k]) => !k.startsWith("_")).flatMap(([, x]) => strings(x)) : [];
  it("critic text: every rating, guide-day outcome, track and ending is present", () => {
    for (const k of ["1", "2", "3", "4", "5"]) expect(criticText.localCritic[k]!.length).toBeGreaterThanOrEqual(4);
    expect(criticText.inspectorRumours.length).toBeGreaterThanOrEqual(8);
    expect(criticText.guideDay.gained.length + criticText.guideDay.kept.length + criticText.guideDay.lost.length).toBeGreaterThanOrEqual(6);
    expect(criticText.fiftyBest.numberOne).toMatch(/hall of fame/);
    expect(criticText.gaultMillau.toqueNote).toMatch(/20/);
    expect(criticText.headChef.wantsOwnPlace.length).toBeGreaterThanOrEqual(3);
    expect(criticText.endings.elBulli.body.join(" ")).toMatch(/Stopping can be winning/);
  });
  it("career text: every personality × band, every rung above 0 on every track, offers, raises, handover", () => {
    for (const o of ["balanced", "cheap", "premium"] as const) for (const b of ["great", "good", "ok", "poor"] as const) expect(careerText.ownerReview[o][b].length, `${o}.${b}`).toBeGreaterThanOrEqual(3);
    // rung ids mirror sim-career src/constants.ts LADDER
    const src = readFileSync(new URL("../../sim-career/src/constants.ts", import.meta.url), "utf8");
    for (const track of ["chef", "bar", "waiter", "manager"] as const) {
      const block = src.slice(src.indexOf(`  ${track}: [`), src.indexOf("],", src.indexOf(`  ${track}: [`)));
      const rungIds = [...block.matchAll(/\{ id: "([a-z_]+)"/g)].map((m) => m[1]!).slice(1);
      expect(Object.keys(careerText.promotion[track]).sort(), track).toEqual([...rungIds].sort());
    }
    expect(careerText.offers.letter).toMatch(/\{pitch\}/);
    expect(careerText.openOwnPlace.handover.length).toBeGreaterThanOrEqual(2);
    expect(careerText.raise.refused.length).toBeGreaterThanOrEqual(2);
  });
  it("incident and goal text match sim-core exactly", async () => {
    const inc = await import("../../sim-core/src/incidents/text");
    const goals = await import("../../sim-core/src/goals/text");
    expect(incidentText.INCIDENT_TEXT).toEqual(inc.INCIDENT_TEXT);
    expect(incidentText.INCIDENT_LINES).toEqual(inc.INCIDENT_LINES);
    expect(goalText.GOAL_LADDER).toEqual(goals.GOAL_LADDER);
    expect(goalText.GOAL_LINES).toEqual(goals.GOAL_LINES);
  });
  it("no real brand names, nothing snarky", () => {
    const all = [extras.criticText, extras.careerText, extras.countries, extras.world, extras.formulas, extras.tastingMenus, extras.wineList, fd, ff].flatMap(strings).join("\n");
    for (const banned of [/mcdonald/i, /michelin/i, /burger king/i, /kfc/i, /jollibee/i, /in-n-out/i, /subway/i, /gault/i, /50 best/i, /el bulli/i, /\bstupid\b/i, /\bidiot/i, /\bhate\b/i, /\bdisgusting\b/i])
      expect(all, String(banned)).not.toMatch(banned);
  });
  it("fill() replaces known placeholders and leaves unknown ones visible", () => {
    expect(fill("{owner}: 'Well done, {name}.' {nope}", { owner: "Ada", name: "Sam" })).toBe("Ada: 'Well done, Sam.' {nope}");
  });
});

describe("validateExtras catches problems", () => {
  it("reports broken references, bad placeholders, margins and duplicates", () => {
    const bad = clone(extras) as Extras;
    bad.dishTags["ghost_dish"] = ["fast_food"];
    bad.dishTags["beef_burger"] = ["not_a_tag" as never];
    bad.formulas[0]!.menuDishIds.push("beef_burger");
    bad.formulas[2]!.menuDishIds.push("ff_classic_stacker");
    bad.tastingMenus[0]!.courses = bad.tastingMenus[0]!.courses.filter((c) => c.course !== "fish");
    bad.tastingMenus[1]!.pricePerHead = 100;
    bad.wineList[0]!.bottlePrice = bad.wineList[0]!.bottleCost * 6;
    bad.world.cities[1]!.id = bad.world.cities[0]!.id;
    bad.world.cities[2]!.regionId = "atlantis";
    bad.world.suppliers[0]!.ingredientIds.push("moon_cheese");
    bad.criticText.localCritic["3"]!.push("Hello {pirate}");
    bad.careerText.raise.granted.push("Here's {money}");
    bad.countries.dietaryBreakers.halal.push("unicorn");
    const j = validateExtras(bad, fullContent).join("\n");
    expect(j).toMatch(/dishTags\.ghost_dish: unknown dish/);
    expect(j).toMatch(/unknown tag "not_a_tag"/);
    expect(j).toMatch(/beef_burger is not tagged fast_food/);
    expect(j).toMatch(/claims no-beef-safe but ff_classic_stacker breaks it/);
    expect(j).toMatch(/missing fish course/);
    expect(j).toMatch(/pricePerHead 100 does not cover/);
    expect(j).toMatch(/bottle markup 6\.00× outside/);
    expect(j).toMatch(/cities: duplicate id/);
    expect(j).toMatch(/unknown region "atlantis"/);
    expect(j).toMatch(/unknown ingredient "moon_cheese"/);
    expect(j).toMatch(/unknown placeholder \{pirate\}/);
    expect(j).toMatch(/unknown placeholder \{money\}/);
    expect(j).toMatch(/dietaryBreakers\.halal: unknown ingredient "unicorn"/);
  });
  it("catches a path dish sold below cost and out-of-band stats", () => {
    const pack = clone(fullContent);
    const d = pack.dishes.find((x) => x.id === "ff_classic_stacker")!;
    d.suggestedPrice = 50;
    d.prepTicks = 4;
    const t = pack.dishes.find((x) => x.id === "fd_turbot_mussels")!;
    t.skillRequired = 20;
    const j = validateExtras(extras, pack).join("\n");
    expect(j).toMatch(/ff_classic_stacker: no positive margin/);
    expect(j).toMatch(/ff_classic_stacker: fast_food prepTicks 4 > 2/);
    expect(j).toMatch(/fd_turbot_mussels: fine_dining skillRequired 20/);
  });
  it("catches an out-of-season tasting menu", () => {
    const bad = clone(extras) as Extras;
    bad.tastingMenus[2]!.months = [7];
    expect(validateExtras(bad, fullContent).join("\n")).toMatch(/never in season/);
  });
});
