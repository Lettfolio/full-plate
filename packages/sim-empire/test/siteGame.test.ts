/** newGameFromSite (round 3, REVIEW P2): a promoted site's GameState matches what the model assumes for it. */
import { describe, expect, it } from "vitest";
import { serialize as serializeGame } from "@full-plate/sim-core";
import { boxTables, brandMenu, BRAND_PULL_SOURCE, EMPIRE, newGameFromSite, siteBrandPull, type EmpireState, type SiteSummary } from "../src/index";
import { Rng } from "../src/rng";
import { content, empire, must } from "./helpers";

function withSite(e: EmpireState, over: Partial<SiteSummary> = {}): { e: EmpireState; site: SiteSummary } {
  const site: SiteSummary = { ...e.sites[0]!, id: "s7", name: "Campus", districtId: "student_quarter", focused: false, staffQuality: 42, ...over };
  delete site.popularity;
  delete site.prestige;
  return { e: { ...e, sites: [...e.sites, site] }, site };
}

describe("newGameFromSite", () => {
  it("uses the site's district, the brand menu at the price index, the box and a local crew", () => {
    let e0 = must(empire(), { type: "SET_FORMULA", locked: true, priceIndex: 1.1 });
    e0 = { ...e0, hq: { ...e0.hq, day: 400 } };
    const { e, site } = withSite(e0);
    const g = newGameFromSite(content, e, site, new Rng([1, 2, 3, 4]));
    expect(g.districtId).toBe("student_quarter");
    expect(g.restaurantName).toBe("Campus");
    expect(g.day).toBe(400);
    expect(g.phase).toBe("planning");
    expect(g.menu.map((m) => [m.dishId, m.price])).toEqual(brandMenu(content, e.brand.formula).map((m) => [m.dishId, m.price]));
    expect(g.tables).toHaveLength(boxTables(content, e.brand.formula.standardisation));
    expect(g.tables.length).toBeGreaterThan(content.balance.startingTables); // locked formula: Speedee's bigger box
    expect(g.staff.map((x) => x.role).sort()).toEqual(["chef", "chef", "server", "server"]);
    for (const x of g.staff) {
      expect(Math.abs(x.skill - 42)).toBeLessThan(16);
      expect(Number.isInteger(x.wage)).toBe(true);
      expect(x.rota.filter(Boolean)).toHaveLength(5);
    }
    // Rotas A and B cover every day with at least one chef and one server.
    for (let wd = 0; wd < 7; wd++) for (const role of ["chef", "server"]) expect(g.staff.some((x) => x.role === role && x.rota[wd])).toBe(true);
    expect(g.loan.remaining).toBe(0);
    expect(g.loan.dailyPayment).toBe(0);
    expect(g.stock.length).toBeGreaterThan(0);
    expect(g.goals).toEqual([]);
  });

  it("carries the brand pull as a footfall mod and the model's popularity and prestige", () => {
    let e0 = must(empire({ cash: 2_000_000_000 }), { type: "ENTER_CITY", cityId: "kingsbridge" });
    e0 = { ...e0, brand: { ...e0.brand, recognition: { ...e0.brand.recognition, isles: 40 } } };
    const { e, site } = withSite(e0, { cityId: "kingsbridge" });
    const g = newGameFromSite(content, e, site, new Rng([5, 5, 5, 5]));
    const pull = siteBrandPull(content, e, site.id);
    expect(pull).not.toBeCloseTo(1, 2);
    expect(g.footfallMods.find((m) => m.source === BRAND_PULL_SOURCE)!.mult).toBeCloseTo(pull, 3);
    expect(g.reputation.popularity).toBeCloseTo(EMPIRE.POPULARITY_REF + EMPIRE.POPULARITY_PER_SKILL * (42 - 50), 0);
    expect(g.reputation.prestige).toBeCloseTo(EMPIRE.PRESTIGE_REF + EMPIRE.PRESTIGE_PER_SKILL * (42 - 50), 0);
    // A site that has been run hands-on keeps its own numbers.
    const own = newGameFromSite(content, e, { ...site, popularity: 91, prestige: 77 }, new Rng([5, 5, 5, 5]));
    expect(own.reputation).toEqual({ popularity: 91, prestige: 77 });
  });

  it("is deterministic in the rng and never mutates the empire", () => {
    const { e, site } = withSite(empire());
    const frozen = JSON.stringify(e);
    const a = serializeGame(newGameFromSite(content, e, site, new Rng([9, 8, 7, 6])));
    const b = serializeGame(newGameFromSite(content, e, site, new Rng([9, 8, 7, 6])));
    const c = serializeGame(newGameFromSite(content, e, site, new Rng([1, 1, 1, 1])));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(JSON.stringify(e)).toBe(frozen);
  });
});
