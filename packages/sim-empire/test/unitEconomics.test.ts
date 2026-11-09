/**
 * Round 5: the unit economics of one new site in its first year (src/unitEconomics.ts), against the brief's QSR anchors
 * (BRIEF "Unit economics the sim uses": food ~30%, labour ~25%, occupancy ~5%, margin ~25%; contract builder: royalty
 * 4–5%, ad fund 4–4.5%). A franchisee of a proven brand should clear a modest profit in year one.
 */
import { describe, expect, it } from "vitest";
import { EMPIRE as K, openingFactor, openProbeSite, probeUnitEconomics, type EmpireState } from "../src/index";
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

  it("new sites carry openedTrading from their first day; the flagship and old saves do not ramp", () => {
    const e = lockedHome();
    expect(e.sites[0]!.openedTrading).toBeUndefined();
    const { e: opened, siteId } = openProbeSite(content, e, { districtId: "seaside" });
    expect(opened.sites.find((s) => s.id === siteId)!.openedTrading).toBe(opened.hq.day - 1);
  });
});
