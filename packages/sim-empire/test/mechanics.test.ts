/** One test (or a few) per Path A mechanic listed in docs/ROUND3.md Package 1. */
import { describe, expect, it } from "vitest";
import * as K from "../src/constants";
import {
  associationBlocks,
  contractAttractiveness,
  expectedSiteDay,
  forceEvent,
  menuBreaksRules,
  openSites,
  propertyPrice,
  saturationPenalty,
  standardisation,
  stepEmpireDay,
  type EmpireState,
  type SiteSummary,
} from "../src/index";
import { content, days, empire, must, rejected, withApplicant } from "./helpers";

/** Opens a site and fast-forwards past the build so it's trading. */
function openAndBuild(e: EmpireState, cmd: Parameters<typeof must>[1]): { e: EmpireState; id: string } {
  const before = new Set(e.sites.map((s) => s.id));
  let cur = must(e, cmd);
  const id = cur.sites.find((s) => !before.has(s.id))!.id;
  cur = days(cur, 91);
  return { e: cur, id };
}
const site = (e: EmpireState, id: string): SiteSummary => e.sites.find((s) => s.id === id)!;

describe("ownership slider", () => {
  it("company sites cost HQ the build; franchise sites earn the fee and the operator pays the build", () => {
    const e0 = withApplicant(empire());
    const co = must(e0, { type: "OPEN_SITE", cityId: "harbourton", districtId: "student_quarter", ownership: "company", land: "hqLease" });
    expect(e0.hq.cash - co.hq.cash).toBe(K.SITE_BUILD_COST);
    const fr = must(e0, { type: "OPEN_SITE", cityId: "harbourton", districtId: "student_quarter", ownership: "franchise", land: "thirdParty", applicantId: "a_test" });
    expect(fr.hq.cash - e0.hq.cash).toBe(K.DEFAULT_FRANCHISE_FEE);
    const f = fr.franchisees[0]!;
    expect(f.cash).toBe(40_000_000 - K.DEFAULT_FRANCHISE_FEE - K.SITE_BUILD_COST * K.FRANCHISEE_EQUITY_SHARE);
    expect(fr.sites.at(-1)!.operatorLoan!.remaining).toBeGreaterThan(K.SITE_BUILD_COST * 0.7);
  });

  it("licences pay a 10% royalty and run less consistently", () => {
    let e = withApplicant(empire());
    const r = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "business_park", ownership: "licence", land: "hqOwned", applicantId: "a_test" });
    e = days(r.e, 300);
    const s = site(e, r.id);
    expect(s.land).toBe("thirdParty");
    expect(s.contract!.royaltyPct).toBe(K.LICENCE_ROYALTY_PCT);
    expect(s.brandConsistency).toBeLessThan(site(e, "s1").brandConsistency);
  });

  it("refranchising sells a company site; buying back returns it", () => {
    let e = withApplicant(empire());
    const r = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" });
    e = r.e;
    const cash = e.hq.cash;
    e = must(e, { type: "SELL_FRANCHISE", siteId: r.id, applicantId: "a_test" });
    expect(site(e, r.id).ownership).toBe("franchise");
    expect(e.hq.cash).toBeGreaterThan(cash + K.DEFAULT_FRANCHISE_FEE);
    e = days(e, 30);
    e = must(e, { type: "BUY_BACK", siteId: r.id });
    expect(site(e, r.id).ownership).toBe("company");
    expect(site(e, r.id).franchisee).toBeUndefined();
    expect(e.franchisees[0]!.sites).toEqual([]);
  });
});

describe("contract builder and franchisee mood", () => {
  it("higher take makes the contract less attractive to applicants", () => {
    const e = empire();
    const base = contractAttractiveness(e.contract);
    expect(base).toBeCloseTo(1, 5);
    expect(contractAttractiveness({ ...e.contract, royaltyPct: 0.08 })).toBeLessThan(base);
    expect(contractAttractiveness({ ...e.contract, fee: 7_000_000 })).toBeLessThan(base);
    expect(contractAttractiveness({ ...e.contract, royaltyPct: 0.04, rentPctOfSales: 0.08 })).toBeGreaterThan(base);
  });

  it("raising the royalty on everyone hits mood at once and keeps it lower", () => {
    let e = withApplicant(empire());
    e = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "student_quarter", ownership: "franchise", land: "thirdParty", applicantId: "a_test" }).e;
    e = days(e, 120);
    const calm = days(e, 120);
    const squeezed0 = must(e, { type: "SET_CONTRACT", contract: { royaltyPct: 0.08 }, applyTo: "all" });
    expect(squeezed0.franchisees[0]!.mood).toBeCloseTo(e.franchisees[0]!.mood - 3 * K.MOOD_ROYALTY_RISE_SHOCK, 5);
    const squeezed = days(squeezed0, 120);
    expect(squeezed.franchisees[0]!.mood).toBeLessThan(calm.franchisees[0]!.mood - 5);
    // New-only terms don't touch existing agreements.
    const newOnly = must(e, { type: "SET_CONTRACT", contract: { royaltyPct: 0.08 }, applyTo: "new" });
    expect(newOnly.sites.find((s) => s.ownership === "franchise")!.contract!.royaltyPct).toBe(K.DEFAULT_ROYALTY_PCT);
    expect(newOnly.franchisees[0]!.mood).toBe(e.franchisees[0]!.mood);
  });

  it("HQ earns royalty and ad fund on franchise sales", () => {
    let e = withApplicant(empire());
    const r = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "student_quarter", ownership: "franchise", land: "thirdParty", applicantId: "a_test" });
    e = r.e;
    const day = stepEmpireDay(content, e, undefined, { noEvents: true }).empire;
    const s = site(day, r.id);
    expect(s.revenue7d).toBeGreaterThan(0);
    expect(day.brand.adSpend30d.isles!).toBeGreaterThan(e.brand.adSpend30d.isles! * (29 / 30));
  });
});

describe("landlord mode", () => {
  it("rent on HQ land is the higher of a share of sales and cost + 40%", () => {
    let e = withApplicant(empire());
    const r = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "high_street", ownership: "franchise", land: "hqOwned", applicantId: "a_test" });
    e = days(r.e, 60);
    const p = e.property.find((h) => h.siteId === r.id)!;
    const s = site(e, r.id);
    expect(p.purchasePrice).toBe(propertyPrice(s));
    const marketMonthly = s.rent;
    const salesShareMonthly = ((s.revenue7d / 7) * (1 - 1 / 6)) * 30 * K.DEFAULT_RENT_PCT;
    expect(p.rentIncome).toBeGreaterThanOrEqual(Math.min(salesShareMonthly, marketMonthly * 1.4) * 0.85);
    expect(p.rentIncome).toBeGreaterThanOrEqual(marketMonthly * (1 + K.RENT_COST_MARKUP) * 0.85);
  });

  it("owning the land beats leasing it over time: mortgage is fixed while rent tracks sales", () => {
    const run = (land: "hqLease" | "hqOwned") => {
      let e = withApplicant(empire());
      e = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "high_street", ownership: "franchise", land, applicantId: "a_test" }).e;
      const start = e.hq.cash;
      e = days(e, 360 * 6);
      return e.hq.cash - start;
    };
    const lease = run("hqLease");
    const own = run("hqOwned");
    expect(own).toBeGreaterThan(lease);
  });

  it("buying a plot needs the deposit", () => {
    // HQ can draw half its credit line for development; below that, no deal.
    const e = empire({ cash: -K.HQ_CREDIT_LINE * K.DEVELOPMENT_FACILITY_SHARE });
    expect(rejected(e, { type: "BUY_PROPERTY", siteId: "s1" })).toMatch(/deposit/);
    const rich = must(empire(), { type: "BUY_PROPERTY", siteId: "s1" });
    expect(rich.sites[0]!.land).toBe("hqOwned");
    expect(rich.property[0]!.mortgageDaily).toBeGreaterThan(0);
  });
});

describe("standardisation tech tree", () => {
  it("formula → academy → drive-thru → app, in order, each raising standardisation", () => {
    let e = empire();
    expect(rejected(e, { type: "RESEARCH", tech: "academy" })).toMatch(/Lock the formula/);
    e = must(e, { type: "SET_FORMULA", locked: true });
    const s0 = e.brand.formula.standardisation;
    expect(s0).toBe(K.STD_BASE + K.STD_FORMULA_LOCKED);
    expect(rejected(e, { type: "RESEARCH", tech: "driveThru" })).toMatch(/needs The training academy/);
    e = must(e, { type: "RESEARCH", tech: "academy" });
    expect(rejected(e, { type: "RESEARCH", tech: "appOrdering" })).toMatch(/Already researching/);
    e = days(e, K.TECH.academy.days);
    expect(e.brand.formula.academy).toBe(true);
    expect(e.brand.formula.standardisation).toBe(s0 + K.STD_ACADEMY);
    e = days(must(e, { type: "RESEARCH", tech: "driveThru" }), K.TECH.driveThru.days);
    e = days(must(e, { type: "RESEARCH", tech: "appOrdering" }), K.TECH.appOrdering.days);
    expect(e.brand.formula.standardisation).toBe(K.STD_BASE + K.STD_FORMULA_LOCKED + K.STD_ACADEMY + K.STD_DRIVE_THRU + K.STD_APP);
  });

  it("a long menu costs standardisation; consistency drifts up to the formula's target", () => {
    const base = { locked: true, academy: false, driveThru: false, appOrdering: false };
    expect(standardisation({ ...base, menuDishIds: Array(8).fill("x") })).toBeGreaterThan(standardisation({ ...base, menuDishIds: Array(14).fill("x") }));
    let e = must(empire(), { type: "SET_FORMULA", locked: true });
    e = days(e, 200);
    expect(e.sites[0]!.brandConsistency).toBeGreaterThan(K.REF_CONSISTENCY + 15);
  });

  it("standardisation, drive-thru and app raise a site's covers", () => {
    let e = must(empire(), { type: "SET_FORMULA", locked: true });
    const before = expectedSiteDay(content, e, "s1").covers;
    e = { ...e, brand: { ...e.brand, formula: { ...e.brand.formula, academy: true, driveThru: true, appOrdering: true, standardisation: 85 } } };
    e = { ...e, sites: e.sites.map((s) => ({ ...s, driveThru: true })) };
    // +50 standardisation over the locked formula, × drive-thru × app: about double.
    expect(expectedSiteDay(content, e, "s1").covers).toBeGreaterThan(before * 1.8);
  });
});

describe("exclusive suppliers", () => {
  it("cut food costs, and an exclusive supplier failing hits demand harder", () => {
    let e = empire();
    const food0 = expectedSiteDay(content, e, "s1").foodCost;
    const ex = must(e, { type: "SIGN_SUPPLIER", supplierId: "meadow_beef", exclusive: true });
    const nx = must(e, { type: "SIGN_SUPPLIER", supplierId: "meadow_beef", exclusive: false });
    expect(expectedSiteDay(content, ex, "s1").foodCost).toBeLessThan(expectedSiteDay(content, nx, "s1").foodCost);
    expect(expectedSiteDay(content, nx, "s1").foodCost).toBeLessThan(food0);
    const exOut = forceEvent(content, ex, { kind: "supplier_failure", supplierId: "meadow_beef" }).empire;
    const nxOut = forceEvent(content, nx, { kind: "supplier_failure", supplierId: "meadow_beef" }).empire;
    const c0 = expectedSiteDay(content, ex, "s1").covers;
    const scandalFree = (x: EmpireState) => ({ ...x, effects: x.effects.filter((f) => f.kind !== "scandal") });
    expect(expectedSiteDay(content, scandalFree(exOut), "s1").covers).toBeLessThan(expectedSiteDay(content, scandalFree(nxOut), "s1").covers);
    expect(expectedSiteDay(content, scandalFree(exOut), "s1").covers).toBeLessThan(c0);
  });

  it("a supplier failure can turn into a scandal", () => {
    const e = must(empire(), { type: "SIGN_SUPPLIER", supplierId: "greenleaf", exclusive: true });
    const r = forceEvent(content, e, { kind: "supplier_failure", supplierId: "greenleaf", withScandal: true });
    expect(r.events.map((x) => x.kind)).toEqual(["supplier_outage", "scandal"]);
  });
});

describe("saturation", () => {
  it("each new site in a city trims its neighbours", () => {
    expect(saturationPenalty(1, 2_500_000)).toBe(0);
    const p5 = saturationPenalty(5, 2_500_000);
    const p20 = saturationPenalty(20, 2_500_000);
    expect(p5).toBeGreaterThan(0);
    expect(p20).toBeGreaterThan(p5);
    expect(saturationPenalty(20, 10_000_000)).toBeLessThan(p20); // bigger cities hold more
    let e = empire();
    const solo = expectedSiteDay(content, e, "s1").covers;
    for (let i = 0; i < 6; i++) e = must(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: i % 2 ? "high_street" : "student_quarter", ownership: "company", land: "hqLease" });
    expect(e.sites[0]!.saturationPenalty).toBeGreaterThan(0.05);
    expect(expectedSiteDay(content, e, "s1").covers).toBeLessThan(solo);
  });

  it("sites below the collapse line hand back the keys (Subway)", () => {
    let e = must(withApplicant(empire()), { type: "ENTER_CITY", cityId: "glenmoor" });
    e = must(e, { type: "OPEN_SITE", cityId: "glenmoor", districtId: "high_street", ownership: "franchise", land: "thirdParty", applicantId: "a_test" });
    const id = e.sites.at(-1)!.id;
    // A terrible location: a bypass takes 70% of its passing trade for good.
    e = { ...e, sites: e.sites.map((s) => (s.id === id ? { ...s, footfallMods: [{ mult: 0.3, daysRemaining: 99999, reason: "bypass" }] } : s)) };
    e = days(e, 91 + 180 + 290);
    const s = site(e, id);
    expect(s.revenueYear).toBeLessThan(K.COLLAPSE_REVENUE_YEAR);
    expect(s.ownership === "company" || s.status === "closed").toBe(true);
    expect(e.events.some((ev) => ev.kind === "site_failing")).toBe(true);
  });
});

describe("franchisee association", () => {
  function unhappy(): EmpireState {
    let e = empire();
    for (let i = 0; i < 6; i++) {
      e = withApplicant(e, `a${i}`);
      e = must(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: ["high_street", "student_quarter", "business_park", "seaside"][i % 4]!, ownership: "franchise", land: "thirdParty", applicantId: `a${i}` });
    }
    e = days(e, 95);
    return { ...e, franchisees: e.franchisees.map((f) => ({ ...f, mood: 20, margin30d: -0.05 })) };
  }

  it("forms below the mood threshold and blocks fee rises, forced remodels and discounts", () => {
    let e = days(unhappy(), 1);
    expect(e.association.active).toBe(true);
    expect(e.events.some((ev) => ev.kind === "association")).toBe(true);
    expect(associationBlocks(e, { type: "SET_CONTRACT", contract: { royaltyPct: 0.07 }, applyTo: "all" })).toMatch(/blocks/);
    expect(rejected(e, { type: "LAUNCH_CAMPAIGN", kind: "discount", budget: 1_000_000 })).toMatch(/association/);
    const fsite = e.sites.find((s) => s.ownership === "franchise")!;
    expect(rejected(e, { type: "REMODEL", siteId: fsite.id })).toMatch(/association/);
    expect(rejected(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: fsite.districtId, ownership: "company", land: "hqLease" })).toMatch(/encroachment/);
    // Lowering fees is still allowed, and so are company remodels.
    expect(rejected(e, { type: "SET_CONTRACT", contract: { royaltyPct: 0.04 }, applyTo: "all" })).toBeUndefined();
    expect(rejected(e, { type: "REMODEL", siteId: "s1" })).toBeUndefined();
  });

  it("stands down once mood recovers", () => {
    let e = days(unhappy(), 1);
    e = { ...e, franchisees: e.franchisees.map((f) => ({ ...f, mood: 70, margin30d: 0.2 })) };
    e = days(e, 1);
    expect(e.association.active).toBe(false);
  });
});

describe("country entry puzzle", () => {
  it("dietary rules: a beef menu loses appeal in a no-beef city until localised", () => {
    expect(menuBreaksRules(content, ["beef_burger"], ["no-beef"])).toBe(true);
    expect(menuBreaksRules(content, ["chicken_burger"], ["no-beef", "no-pork"])).toBe(false);
    expect(menuBreaksRules(content, ["beef_burger"], ["kosher"])).toBe(true); // cheddar on beef
    expect(menuBreaksRules(content, ["lager"], ["halal"])).toBe(true);
    let e = must(empire({ cash: 2_000_000_000 }), { type: "ENTER_CITY", cityId: "vasant" });
    e = must(e, { type: "OPEN_SITE", cityId: "vasant", districtId: "high_street", ownership: "company", land: "hqLease" });
    const id = e.sites.at(-1)!.id;
    e = days(e, 91);
    const before = expectedSiteDay(content, e, id).covers;
    e = must(e, { type: "LOCALISE_MENU", cityId: "vasant" });
    expect(expectedSiteDay(content, e, id).covers).toBeGreaterThan(before / K.DIETARY_PENALTY - 2);
  });

  it("local champions take a share that shrinks as recognition grows", () => {
    const e = must(empire({ cash: 2_000_000_000 }), { type: "ENTER_CITY", cityId: "manara" });
    const e2 = must(e, { type: "OPEN_SITE", cityId: "manara", districtId: "high_street", ownership: "company", land: "hqLease" });
    const id = e2.sites.at(-1)!.id;
    const opened = { ...e2, sites: e2.sites.map((s) => (s.id === id ? { ...s, status: "open" as const } : s)) };
    const low = expectedSiteDay(content, opened, id).covers;
    const famous = { ...opened, brand: { ...opened.brand, recognition: { ...opened.brand.recognition, sunrise: 90 } } };
    // Recognition helps on its own; the champion's bite also shrinks.
    expect(expectedSiteDay(content, famous, id).covers).toBeGreaterThan(low);
    const noChampion = { ...opened, cities: opened.cities.map((c) => (c.id === "manara" ? { ...c, championStrength: 0 } : c)) };
    expect(expectedSiteDay(content, noChampion, id).covers).toBeGreaterThan(low * 1.2);
  });

  it("new countries cost more to enter than new cities at home", () => {
    const e = empire();
    const home = must(e, { type: "ENTER_CITY", cityId: "kingsbridge" });
    const abroad = must(e, { type: "ENTER_CITY", cityId: "velmont" });
    expect(e.hq.cash - abroad.hq.cash).toBeGreaterThan(e.hq.cash - home.hq.cash);
    expect(rejected(e, { type: "OPEN_SITE", cityId: "velmont", districtId: "high_street", ownership: "company", land: "hqLease" })).toMatch(/Enter Velmont/);
  });

  it("forced exit sells every site in the country at a discount and bars re-entry", () => {
    let e = must(empire({ cash: 2_000_000_000 }), { type: "ENTER_CITY", cityId: "kaito" });
    e = must(e, { type: "OPEN_SITE", cityId: "kaito", districtId: "high_street", ownership: "company", land: "hqLease" });
    e = days(e, 91);
    const r = forceEvent(content, e, { kind: "forced_exit", country: "Nihara" });
    expect(r.empire.sites.at(-1)!.status).toBe("closed");
    expect(rejected(r.empire, { type: "ENTER_CITY", cityId: "kaito" })).toMatch(/closed its doors/);
  });
});

describe("product launch gamble", () => {
  it("core products succeed more often than stretches; flops cost recognition", () => {
    const tally = (fit: "core" | "stretch") => {
      let hits = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const r = must(empire({ seed }), { type: "LAUNCH_PRODUCT", name: "Thing", budget: 10_000_000, fit });
        if (r.effects.some((f) => f.kind === "product" && f.demand > 0)) hits++;
      }
      return hits;
    };
    const core = tally("core");
    const stretch = tally("stretch");
    expect(core).toBeGreaterThan(stretch + 30);
    expect(rejected(empire(), { type: "LAUNCH_PRODUCT", name: "x", budget: 1, fit: "franchiseeIdea" })).toMatch(/No franchisee idea/);
  });
});

describe("scandals", () => {
  it("cut same-store sales ~20% and recover over 4–12 quarters", () => {
    let e = empire();
    const before = expectedSiteDay(content, e, "s1").covers;
    const r = forceEvent(content, e, { kind: "scandal", siteId: "s1" });
    e = r.empire;
    const fx = e.effects.find((f) => f.kind === "scandal")!;
    expect(-fx.demand).toBeGreaterThanOrEqual(K.SCANDAL_DEPTH[0]);
    expect(-fx.demand).toBeLessThanOrEqual(K.SCANDAL_DEPTH[1]);
    expect(fx.endDay - fx.startDay).toBeGreaterThanOrEqual(4 * 90);
    expect(fx.endDay - fx.startDay).toBeLessThanOrEqual(12 * 90);
    const hit = expectedSiteDay(content, e, "s1").covers;
    expect(hit / before).toBeLessThan(0.87);
    expect(hit / before).toBeGreaterThan(0.73);
    const half = days(e, Math.round((fx.endDay - fx.startDay) / 2));
    const mid = expectedSiteDay(content, { ...half, hq: { ...half.hq, day: e.hq.day } }, "s1").covers;
    expect(mid).toBeGreaterThan(hit);
    const after = days(e, fx.endDay - fx.startDay + 1);
    expect(after.effects.some((f) => f.kind === "scandal")).toBe(false);
  });

  it("spills over to other regions at a fraction of the depth", () => {
    let e = must(empire({ cash: 2_000_000_000 }), { type: "ENTER_CITY", cityId: "velmont" });
    e = must(e, { type: "OPEN_SITE", cityId: "velmont", districtId: "high_street", ownership: "company", land: "hqLease" });
    e = days(e, 91);
    const id = e.sites.at(-1)!.id;
    const before = expectedSiteDay(content, e, id).covers;
    const s = forceEvent(content, e, { kind: "scandal", siteId: "s1" }).empire;
    const ratio = expectedSiteDay(content, s, id).covers / before;
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(0.88);
  });
});

describe("win condition", () => {
  it("tracks meals served and regions with recognition ≥ 60", () => {
    let e = empire();
    e = days(e, 1);
    expect(e.win.achieved).toBe(false);
    expect(e.win.mealsTarget).toBe(1_000_000_000);
    const rec = Object.fromEntries(e.regions.map((r) => [r.id, 80]));
    e = { ...e, brand: { ...e.brand, recognition: rec } };
    e = days(e, 1);
    // Recognised everywhere but present only at home.
    expect(e.win.regionsWon).toEqual(["isles"]);
    e = { ...e, mealsServedTotal: 999_999_990 };
    e = days(e, 1);
    expect(e.win.achieved).toBe(true);
    expect(e.win.reason).toBe("meals");
    expect(e.events.some((ev) => ev.kind === "win")).toBe(true);
  });

  it("is not achieved while the association is in revolt", () => {
    let e: EmpireState = { ...empire(), mealsServedTotal: 2_000_000_000, association: { active: true, formedDay: 0 } };
    e = { ...e, franchisees: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, name: "x", competence: 50, honesty: 50, mood: 10, cash: 1e8, sites: ["s1"], joinedDay: 0, margin30d: -0.1 })) };
    e = stepEmpireDay(content, e, undefined, { noEvents: true }).empire;
    expect(e.win.moodOk).toBe(false);
    expect(e.win.achieved).toBe(false);
  });
});

describe("remodels and inspections", () => {
  it("remodels cost £130k–£600k and add a drive-thru once researched", () => {
    let e = withApplicant(empire());
    const r = openAndBuild(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "high_street", ownership: "franchise", land: "thirdParty", applicantId: "a_test" });
    e = { ...r.e, brand: { ...r.e.brand, formula: { ...r.e.brand.formula, locked: true, academy: true, driveThru: true } } };
    const fcash = e.franchisees[0]!.cash;
    const mood = e.franchisees[0]!.mood;
    e = must(e, { type: "REMODEL", siteId: r.id });
    const paid = fcash - e.franchisees[0]!.cash;
    expect(paid).toBeGreaterThanOrEqual(K.REMODEL_COST_MIN);
    expect(paid).toBeLessThanOrEqual(K.REMODEL_COST_MAX);
    expect(e.franchisees[0]!.mood).toBe(mood - K.MOOD_FORCED_REMODEL);
    expect(site(e, r.id).driveThru).toBe(true);
  });

  it("inspections catch skimming franchisees", () => {
    let e = withApplicant(empire(), "crook", { honesty: 10 });
    e = must(e, { type: "SET_INSPECTIONS", everyDays: 60 });
    e = must(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "student_quarter", ownership: "franchise", land: "thirdParty", applicantId: "crook" });
    let caught = false;
    for (let i = 0; i < 6 && !caught; i++) {
      e = days(e, 61);
      caught = e.events.some((ev) => ev.kind === "skimming");
    }
    expect(caught).toBe(true);
  });

  it("tired sites lose demand until remodelled", () => {
    let e = empire();
    const fresh = expectedSiteDay(content, e, "s1").covers;
    // 3605 days later: same month and weekday, ten years without a remodel.
    e = { ...e, hq: { ...e.hq, day: e.hq.day + 3605 } };
    const tired = expectedSiteDay(content, { ...e, sites: e.sites.map((s) => ({ ...s })) }, "s1").covers;
    expect(tired).toBeLessThan(fresh);
  });
});

describe("HQ", () => {
  it("goes bankrupt beyond the credit line and stops stepping", () => {
    let e = { ...empire(), hq: { ...empire().hq, cash: -K.HQ_CREDIT_LINE - 1_000_000 } };
    const r = stepEmpireDay(content, e, undefined, { noEvents: true });
    expect(r.empire.status).toBe("bankrupt");
    e = r.empire;
    expect(stepEmpireDay(content, e).empire).toBe(e);
    expect(rejected(e, { type: "SET_INSPECTIONS", everyDays: 90 })).toMatch(/bankrupt/);
  });

  it("transfer from the focused till and focus switching", () => {
    let e = must(empire(), { type: "TRANSFER_FROM_FOCUSED", amount: 1_000_000 });
    expect(e.hq.cash).toBe(empire().hq.cash + 1_000_000);
    e = must(e, { type: "FOCUS_SITE", siteId: "s1" });
    expect(e.focusedSiteId).toBe("s1");
    expect(e.sites[0]!.focused).toBe(true);
    e = must(e, { type: "FOCUS_SITE" });
    expect(e.focusedSiteId).toBeUndefined();
    expect(openSites(e).every((s) => !s.focused)).toBe(true);
  });

  it("capital spending can draw on half the credit line; losses accrue overdraft interest", () => {
    const e = empire({ cash: 0 });
    const built = must(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" });
    expect(built.hq.cash).toBe(-K.SITE_BUILD_COST);
    const broke = empire({ cash: -K.HQ_CREDIT_LINE * K.DEVELOPMENT_FACILITY_SHARE + 1 });
    expect(rejected(broke, { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" })).toMatch(/can spend/);
  });

  it("fresh formula needs a commissary in the region", () => {
    let e = must(empire(), { type: "SET_FORMULA", fresh: true });
    expect(rejected(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" })).toMatch(/commissary/);
    e = must(e, { type: "BUILD_COMMISSARY", regionId: "isles" });
    expect(rejected(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" })).toBeUndefined();
  });
});
