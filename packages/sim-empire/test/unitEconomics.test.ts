/**
 * Round 5: the unit economics of one new site in its first year (src/unitEconomics.ts), against the brief's QSR anchors
 * (BRIEF "Unit economics the sim uses": food ~30%, labour ~25%, occupancy ~5%, margin ~25%; contract builder: royalty
 * 4–5%, ad fund 4–4.5%). A franchisee of a proven brand should clear a modest profit in year one.
 */
import { describe, expect, it } from "vitest";
import { EMPIRE as K, franchiseOutlook, maturity, openingFactor, openProbeSite, probeUnitEconomics, type EmpireState } from "../src/index";
import { runStyle } from "../src/strategies";
import { content, empire, must } from "./helpers";

const lockedHome = (): EmpireState => must(empire(), { type: "SET_FORMULA", locked: true });
const share = (x: number, of: number) => x / of;

describe("unit economics: a locked-formula franchise's first year", () => {
  const withDeals = probeUnitEconomics(content, lockedHome(), { districtId: "high_street", land: "hqLease", supplyDeals: true });
  const noDeals = probeUnitEconomics(content, lockedHome(), { districtId: "high_street", land: "hqLease" });

  it("clears a modest profit with the brand's supply deals (franchisee net 3–12% of net sales, in pence)", () => {
    expect(withDeals.days).toBe(K.DAYS_PER_YEAR);
    expect(withDeals.netPct).toBeGreaterThan(0.03);
    expect(withDeals.netPct).toBeLessThan(0.12);
    for (const v of [withDeals.net, withDeals.netSales, withDeals.rent, withDeals.royalty]) expect(Number.isInteger(v)).toBe(true);
  });

  it("only just gets by without them, but does not bleed (round 4: −14%)", () => {
    expect(noDeals.netPct).toBeGreaterThan(-0.02);
    expect(noDeals.netPct).toBeLessThan(withDeals.netPct - 0.02);
  });

  it("each line sits near the brief's anchors", () => {
    const u = withDeals;
    expect(share(u.food, u.netSales)).toBeGreaterThan(0.28);
    expect(share(u.food, u.netSales)).toBeLessThan(0.35);
    expect(share(u.labour, u.netSales)).toBeGreaterThan(0.24);
    expect(share(u.labour, u.netSales)).toBeLessThan(0.34);
    expect(share(u.royalty, u.netSales)).toBeCloseTo(K.DEFAULT_ROYALTY_PCT, 3);
    expect(share(u.adFund, u.netSales)).toBeCloseTo(K.DEFAULT_AD_FUND_PCT, 3);
    // Rent: the higher of 10% of sales and HQ's cost + markup. Round 4 charged a year-one unit the mature drive-thru
    // plot's rent + 40%: 18% of its sales.
    expect(share(u.rent, u.netSales)).toBeGreaterThanOrEqual(K.DEFAULT_RENT_PCT - 1e-9);
    expect(share(u.rent, u.netSales)).toBeLessThan(0.12);
  });

  it("the same site company-owned keeps the whole margin: no royalty, no markup, no build loan", () => {
    const co = probeUnitEconomics(content, lockedHome(), { districtId: "high_street", ownership: "company", supplyDeals: true });
    expect(co.royalty).toBe(0);
    expect(co.loan).toBe(0);
    expect(co.netPct).toBeGreaterThan(withDeals.netPct + 0.08);
  });

  it("a takeaway counter cover costs less labour than a dining-room cover", () => {
    // Same site unlocked (no counter) vs locked (+40% takeaway covers): labour rises far less than covers.
    const unlocked = probeUnitEconomics(content, empire(), { districtId: "high_street", supplyDeals: true });
    const coversUp = withDeals.coversPerDay / unlocked.coversPerDay;
    const labourUp = withDeals.labour / unlocked.labour;
    expect(coversUp).toBeGreaterThan(1.25);
    expect(labourUp - 1).toBeLessThan((coversUp - 1) * 0.6);
  });
});

describe("a new site's first year: ramp-up and honeymoon (round 5)", () => {
  it("openingFactor: the opening bump, a dip as the novelty fades, run-rate by month 9; none on the flagship", () => {
    const at = (age: number) => openingFactor({ openedTrading: 1000 }, 1000 + age);
    expect(at(0)).toBeCloseTo(K.RAMP_START * (1 + K.HONEYMOON), 6);
    expect(at(0)).toBeGreaterThan(1);
    const dip = Math.min(...[60, 75, 90, 120].map(at));
    expect(dip).toBeLessThan(0.9);
    expect(at(120)).toBeLessThan(at(240));
    expect(at(K.RAMP_DAYS)).toBe(1);
    expect(at(400)).toBe(1);
    expect(openingFactor({}, 5)).toBe(1);
  });

  it("is a shallow J: thinner months 2–5 than months 10–12, and a better second year", () => {
    const e = lockedHome();
    const y1 = probeUnitEconomics(content, e, { districtId: "high_street", supplyDeals: true });
    const y2 = probeUnitEconomics(content, e, { districtId: "high_street", supplyDeals: true, skipDays: K.DAYS_PER_YEAR });
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Compare against the same months of year two, so the district's seasons cancel out.
    const gap = (m: number) => y2.monthly[m]! - y1.monthly[m]!;
    expect(mean([1, 2, 3, 4].map(gap))).toBeGreaterThan(mean([9, 10, 11].map(gap)) + 50_000);
    expect(y2.netPct).toBeGreaterThan(y1.netPct);
    expect(y1.netPct).toBeGreaterThan(0.03);
  });

  it("new sites carry openedTrading from their first day; the flagship is a two-year-old room (round 6) and doesn't ramp", () => {
    const e = lockedHome();
    // Round 6 (R5 P3): the flagship ages too, from FLAGSHIP_AGE_DAYS before the empire starts — past its ramp.
    expect(e.sites[0]!.openedTrading).toBe(e.hq.day - K.FLAGSHIP_AGE_DAYS);
    expect(openingFactor(e.sites[0]!, e.hq.day)).toBe(1);
    const { e: opened, siteId } = openProbeSite(content, e, { districtId: "seaside" });
    expect(opened.sites.find((s) => s.id === siteId)!.openedTrading).toBe(opened.hq.day - 1);
  });
});

describe("franchiseOutlook: the contract panel's year-one line (round 5)", () => {
  it("agrees with the full probe within 2 points, with and without supply deals", () => {
    for (const supplyDeals of [false, true]) {
      let e = lockedHome();
      if (supplyDeals) for (const s of e.suppliers) e = must(e, { type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: s.failureRisk < 0.05 });
      const probe = probeUnitEconomics(content, e, { districtId: "high_street" });
      const o = franchiseOutlook(content, e, { districtId: "high_street" });
      expect(Math.abs(o.netPct - probe.netPct)).toBeLessThan(0.02);
      expect(Number.isInteger(o.net)).toBe(true);
    }
  });

  it("says fair for the default terms with supply deals, and 'loses' when the contract squeezes", () => {
    let e = lockedHome();
    for (const s of e.suppliers) e = must(e, { type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: s.failureRisk < 0.05 });
    expect(franchiseOutlook(content, e, { districtId: "high_street" }).verdict).toBe("fair");
    const squeezed = must(e, { type: "SET_CONTRACT", contract: { royaltyPct: 0.1, rentPctOfSales: 0.15 }, applyTo: "new" });
    const o = franchiseOutlook(content, squeezed, { districtId: "high_street" });
    expect(o.verdict).toBe("loses");
    expect(o.net).toBeLessThan(0);
    // Unlocked: the brand has no formula to sell yet.
    expect(franchiseOutlook(content, empire(), { districtId: "high_street" }).verdict).toBe("loses");
  });

  it("round 5 review: agrees with the probe on every district of every city, not only the home city's first", () => {
    let e = lockedHome();
    for (const s of e.suppliers) e = must(e, { type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: s.failureRisk < 0.05 });
    e = { ...e, hq: { ...e.hq, cash: 10_000_000_000 } };
    for (const c of e.cities) if (!c.entered) e = must(e, { type: "ENTER_CITY", cityId: c.id });
    const verdict = (x: number) => (x >= 0.04 ? "fair" : x >= 0 ? "thin" : "loses");
    let n = 0;
    for (const city of e.cities) for (const districtId of city.districts) {
      const o = franchiseOutlook(content, e, { cityId: city.id, districtId });
      const p = probeUnitEconomics(content, e, { cityId: city.id, districtId });
      // Measured (34 districts): the outlook reads 0.4–1.8 points under the probe where a franchise is viable, up to
      // 3.8 under where it loses a third of its sales (no localised menu). It is never the optimistic side.
      expect(o.netPct).toBeLessThanOrEqual(p.netPct + 0.002);
      expect(p.netPct - o.netPct).toBeLessThan(p.netPct > -0.1 ? 0.02 : 0.045);
      // Away from a verdict line, the panel's word is the probe's word.
      if (Math.abs(p.netPct - 0.04) > 0.02 && Math.abs(p.netPct) > 0.02) expect(o.verdict).toBe(verdict(p.netPct));
      n++;
    }
    expect(n).toBeGreaterThan(30);
  }, 120_000);

  it("is pure on a frozen empire", () => {
    const e = lockedHome();
    const before = JSON.stringify(e);
    franchiseOutlook(content, Object.freeze(e));
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("round 5 review: maturity drag (mature units were ~20% franchisee / ~31% company net)", () => {
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  it("maturity is 0 for two years of trading, then rises to 1 by year five; none without openedTrading", () => {
    expect(maturity({ openedTrading: 100 }, 100 + K.MATURE_FROM_DAYS)).toBe(0);
    expect(maturity({ openedTrading: 100 }, 100 + (K.MATURE_FROM_DAYS + K.MATURE_FULL_DAYS) / 2)).toBeCloseTo(0.5, 6);
    expect(maturity({ openedTrading: 100 }, 100 + K.MATURE_FULL_DAYS + 500)).toBe(1);
    expect(maturity({}, 5000)).toBe(0);
  });

  it("a brand with no tech tree keeps its mature franchisees in profit (the drag only takes margin above a healthy level)", () => {
    let e = lockedHome();
    for (const s of e.suppliers) e = must(e, { type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: s.failureRisk < 0.05 });
    const y1 = probeUnitEconomics(content, e, { districtId: "high_street" });
    const y6 = probeUnitEconomics(content, e, { districtId: "high_street", skipDays: K.MATURE_FULL_DAYS });
    expect(y6.netPct).toBeGreaterThan(0.03);
    expect(y6.netPct).toBeGreaterThan(y1.netPct - 0.01);
    const co6 = probeUnitEconomics(content, e, { districtId: "high_street", ownership: "company", skipDays: K.MATURE_FULL_DAYS });
    expect(co6.netPct).toBeGreaterThan(0.08);
  });

  it("10-year franchise run: a fully mature franchisee nets ~8–12%; company-owned run: a mature site ~15–20%", () => {
    const f = runStyle(content, "franchise", 1, 8).final;
    const age = (id: string) => { const s = f.sites.find((x) => x.id === id)!; return f.hq.day - (s.openedTrading ?? s.opened); };
    const frNet = f.franchisees.filter((x) => x.sites.length && x.sites.every((id) => age(id) > K.MATURE_FULL_DAYS)).map((x) => x.margin30d);
    expect(frNet.length).toBeGreaterThan(10);
    expect(med(frNet)).toBeGreaterThan(0.07);
    expect(med(frNet)).toBeLessThan(0.13);
    const c = runStyle(content, "company", 1, 8).final;
    const co = c.sites
      .filter((s) => s.ownership === "company" && s.status === "open" && !s.focused && s.openedTrading !== undefined && c.hq.day - s.openedTrading > K.MATURE_FULL_DAYS && s.revenue7d > 0)
      .map((s) => { const ns = s.revenue7d / 1.2; return (s.margin7d - ns * K.DEFAULT_AD_FUND_PCT) / ns; });
    expect(co.length).toBeGreaterThan(10);
    expect(med(co)).toBeGreaterThan(0.14);
    expect(med(co)).toBeLessThan(0.22);
  }, 120_000);
});
