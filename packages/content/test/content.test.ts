import { describe, expect, it } from "vitest";
import { ALCOHOLIC_DISH_IDS, content, dishCost, dishMargin, NATIONAL_LIVING_WAGE, validateContent } from "../src/index";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("shipped content", () => {
  it("passes validation", () => {
    expect(validateContent(content)).toEqual([]);
  });

  it("has the expected collection sizes", () => {
    expect(content.ingredients.length).toBeGreaterThanOrEqual(45);
    expect(content.dishes.length).toBeGreaterThanOrEqual(60);
    expect(content.segments.map((s) => s.id).sort()).toEqual(["business", "families", "foodies", "students", "tourists"]);
    expect(content.districts).toHaveLength(4);
    expect(content.traits.length).toBeGreaterThanOrEqual(16);
    expect(content.events.length).toBeGreaterThanOrEqual(24);
    for (const role of ["chef", "server", "bar", "porter", "manager"]) {
      expect(content.staffArchetypes.some((a) => a.role === role)).toBe(true);
    }
  });

  it("covers every course and cuisine, with kids' dishes and 6–8 alcoholic drinks", () => {
    for (const c of ["starter", "main", "dessert", "drink", "side"]) expect(content.dishes.some((d) => d.course === c)).toBe(true);
    for (const c of ["british", "italian", "american", "asian", "french", "cafe"]) expect(content.dishes.some((d) => d.cuisine === c)).toBe(true);
    expect(content.dishes.filter((d) => d.id.startsWith("kids_")).length).toBeGreaterThanOrEqual(1);
    expect(ALCOHOLIC_DISH_IDS.length).toBeGreaterThanOrEqual(6);
    expect(ALCOHOLIC_DISH_IDS.length).toBeLessThanOrEqual(8);
    const ids = new Set(content.dishes.map((d) => d.id));
    for (const id of ALCOHOLIC_DISH_IDS) expect(ids.has(id)).toBe(true);
  });
});

describe("referential integrity", () => {
  const ingredientIds = new Set(content.ingredients.map((i) => i.id));
  const segmentIds = new Set(content.segments.map((s) => s.id));
  const traitIds = new Set(content.traits.map((t) => t.id));

  it("every dish ingredient exists", () => {
    for (const d of content.dishes) for (const i of d.ingredients) expect(ingredientIds.has(i.id), `${d.id} → ${i.id}`).toBe(true);
  });
  it("every dish's appeal keys match the segments exactly", () => {
    for (const d of content.dishes) expect(new Set(Object.keys(d.baseAppeal)), d.id).toEqual(segmentIds);
  });
  it("every district's segment mix keys match the segments exactly", () => {
    for (const d of content.districts) expect(new Set(Object.keys(d.segmentMix)), d.id).toEqual(segmentIds);
  });
  it("every archetype trait exists", () => {
    for (const a of content.staffArchetypes) for (const t of a.traits) expect(traitIds.has(t), `${a.id} → ${t}`).toBe(true);
  });
  it("every ingredient is used by at least one dish", () => {
    const used = new Set(content.dishes.flatMap((d) => d.ingredients.map((i) => i.id)));
    for (const i of content.ingredients) expect(used.has(i.id), i.id).toBe(true);
  });
  it("ids are unique within each collection", () => {
    for (const [name, xs] of Object.entries({
      ingredients: content.ingredients, dishes: content.dishes, segments: content.segments, districts: content.districts,
      staffArchetypes: content.staffArchetypes, traits: content.traits, events: content.events,
    })) {
      const ids = xs.map((x: { id: string }) => x.id);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });
});

describe("economics", () => {
  it("every dish has a positive gross margin at its suggested price", () => {
    for (const d of content.dishes) expect(dishMargin(content, d), d.id).toBeGreaterThan(0);
  });
  it("food sits at 65–74% GP (mains, starters) and nothing is sold below 65%", () => {
    for (const d of content.dishes) {
      const m = dishMargin(content, d);
      expect(m, d.id).toBeGreaterThanOrEqual(0.65);
      if (d.course === "main" || d.course === "starter") expect(m, d.id).toBeLessThanOrEqual(0.74);
    }
  });
  it("wine sells at 2–4× cost", () => {
    for (const id of ["house_wine", "fine_red", "prosecco"]) {
      const d = content.dishes.find((x) => x.id === id)!;
      const markup = d.suggestedPrice / dishCost(content, d);
      expect(markup, id).toBeGreaterThanOrEqual(2);
      expect(markup, id).toBeLessThanOrEqual(4);
    }
  });
  it("each district's segmentMix sums to 1", () => {
    for (const d of content.districts) {
      const s = Object.values(d.segmentMix).reduce((a, b) => a + b, 0);
      expect(s, d.id).toBeCloseTo(1, 6);
    }
  });
  it("arrival curves have 120 ticks and sum to ~1", () => {
    for (const s of content.segments) {
      expect(s.arrivalCurve, s.id).toHaveLength(120);
      expect(s.arrivalCurve.reduce((a, b) => a + b, 0), s.id).toBeCloseTo(1, 3);
    }
  });
  it("segment arrival peaks land in the intended windows", () => {
    const peakHour = (id: string) => {
      const c = content.segments.find((s) => s.id === id)!.arrivalCurve;
      return 12 + (c.indexOf(Math.max(...c)) * 5) / 60;
    };
    expect(peakHour("business")).toBeGreaterThanOrEqual(12.5);
    expect(peakHour("business")).toBeLessThanOrEqual(13.5);
    expect(peakHour("families")).toBeGreaterThanOrEqual(17.5);
    expect(peakHour("families")).toBeLessThanOrEqual(19.5);
    expect(peakHour("foodies")).toBeGreaterThanOrEqual(19);
    expect(peakHour("foodies")).toBeLessThanOrEqual(21);
    expect(peakHour("students")).toBeGreaterThanOrEqual(17);
  });
  it("all wages respect the National Living Wage and experienced chefs top out at £18/h", () => {
    for (const a of content.staffArchetypes) expect(a.wageRange[0], a.id).toBeGreaterThanOrEqual(NATIONAL_LIVING_WAGE);
    expect(content.staffArchetypes.find((a) => a.id === "chef_experienced")!.wageRange[1]).toBeLessThanOrEqual(1800);
  });
  it("rents are £2–5k/month with 3 months' deposit", () => {
    for (const d of content.districts) {
      expect(d.monthlyRent, d.id).toBeGreaterThanOrEqual(200_000);
      expect(d.monthlyRent, d.id).toBeLessThanOrEqual(500_000);
      expect(d.depositMonths, d.id).toBe(3);
    }
  });
  it("starting position leaves ~£25k after fit-out", () => {
    const b = content.balance;
    const afterFitOut = b.startingCash + b.loanPrincipal - b.fitOutCost;
    expect(afterFitOut).toBe(2_500_000);
  });
  it("event cash effects stay within ±£2,000", () => {
    for (const e of content.events) for (const c of e.choices) if (c.effects.cash !== undefined) expect(Math.abs(c.effects.cash), `${e.id}.${c.id}`).toBeLessThanOrEqual(200_000);
  });
});

describe("review templates", () => {
  it("has ~8 lines for each rating 1–5 (and round 11's \"rough\" night) using only known placeholders", () => {
    const rt = content.reviewTemplates!;
    expect(Object.keys(rt).sort()).toEqual(["1", "2", "3", "4", "5", "rough"]);
    for (const k of Object.keys(rt)) {
      expect(rt[k]!.length, k).toBeGreaterThanOrEqual(8);
      for (const line of rt[k]!) for (const ph of line.match(/\{[^}]*\}/g) ?? []) expect(["{dish}", "{restaurant}", "{segment}"]).toContain(ph);
    }
  });
  it("flags bad keys, empty pools and unknown placeholders", () => {
    const bad = clone(content);
    bad.reviewTemplates = { "1": [], "2": ["Hello {chef}"], "3": ["ok"], "4": ["ok"], "5": ["ok"], "6": ["too good"] };
    const joined = validateContent(bad).join("\n");
    expect(joined).toMatch(/reviewTemplates\.1: expected a non-empty array/);
    expect(joined).toMatch(/unknown placeholder \{chef\}/);
    expect(joined).toMatch(/unknown rating key "6"/);
  });
});

describe("validateContent catches problems", () => {
  it("reports every problem, not just the first", () => {
    const bad = clone(content);
    bad.dishes[0]!.ingredients[0]!.id = "unicorn_tears";
    bad.dishes[1]!.suggestedPrice = -5;
    delete (bad.dishes[2]!.baseAppeal as Record<string, number>).students;
    bad.segments[0]!.arrivalCurve = bad.segments[0]!.arrivalCurve.slice(0, 100);
    bad.districts[0]!.segmentMix.students = 0.9;
    bad.staffArchetypes[0]!.traits.push("not_a_trait");
    bad.staffArchetypes[0]!.wageRange = [1000, 1200];
    bad.events[0]!.choices = bad.events[0]!.choices.slice(0, 1);
    bad.balance.wasteShares.prep = 0.9;
    const problems = validateContent(bad);
    const joined = problems.join("\n");
    expect(joined).toMatch(/unknown ingredient "unicorn_tears"/);
    expect(joined).toMatch(/suggestedPrice: -5 is outside/);
    expect(joined).toMatch(/missing segment "students"/);
    expect(joined).toMatch(/arrivalCurve: expected length 120/);
    expect(joined).toMatch(/segmentMix: sums to/);
    expect(joined).toMatch(/unknown trait "not_a_trait"/);
    expect(joined).toMatch(/below the National Living Wage/);
    expect(joined).toMatch(/expected 2–3 choices/);
    expect(joined).toMatch(/wasteShares: sums to/);
    expect(problems.length).toBeGreaterThanOrEqual(9);
  });
  it("flags unknown appeal keys and a price below cost", () => {
    const bad = clone(content);
    (bad.dishes[0]!.baseAppeal as Record<string, number>).pirates = 0.5;
    bad.dishes[3]!.suggestedPrice = 1;
    const joined = validateContent(bad).join("\n");
    expect(joined).toMatch(/unknown segment "pirates"/);
    expect(joined).toMatch(/does not cover ingredient cost/);
  });
  it("rejects non-objects", () => {
    expect(validateContent(null)).toEqual(["content pack: expected an object"]);
  });
});
