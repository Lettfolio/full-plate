import { describe, expect, it } from "vitest";
import { deserialize, serialize, stepEmpireDay, forkFromGameState, type EmpireState } from "../src/index";
import { benchmark, runStyle, summariseRun } from "../src/headless";
import { content, empire, focusedRun } from "./helpers";

const isIntPence = (e: EmpireState) =>
  [e.hq.cash, ...e.franchisees.map((f) => f.cash), ...e.property.map((p) => p.mortgageRemaining)].every(Number.isInteger);

describe("determinism and saves", () => {
  it("same seed and commands give byte-identical saves", () => {
    const a = runStyle(content, "franchise", 3, 2).final;
    const b = runStyle(content, "franchise", 3, 2).final;
    expect(serialize(a)).toBe(serialize(b));
    expect(serialize(runStyle(content, "franchise", 4, 2).final)).not.toBe(serialize(a));
  });

  it("round-trips through serialize/deserialize and keeps stepping identically", () => {
    const e = runStyle(content, "company", 5, 2).final;
    const back = deserialize(serialize(e));
    expect(serialize(back)).toBe(serialize(e));
    const a = stepEmpireDay(content, e).empire;
    const b = stepEmpireDay(content, back).empire;
    expect(serialize(a)).toBe(serialize(b));
  });

  it("rejects saves from the future and non-saves", () => {
    expect(() => deserialize(JSON.stringify({ ...empire(), version: 99 }))).toThrow(/newer/);
    expect(() => deserialize("{}")).toThrow(/Not an Empire save/);
  });

  it("never mutates its input", () => {
    const e = empire();
    const before = serialize(e);
    stepEmpireDay(content, e);
    expect(serialize(e)).toBe(before);
  });

  it("HQ and franchisee cash stay integer pence", () => {
    const e = runStyle(content, "franchise", 2, 3).final;
    expect(isIntPence(e)).toBe(true);
  });
});

describe("fork", () => {
  it("builds the empire from a sim-core GameState with the flagship focused", () => {
    const { state } = focusedRun(21, 90);
    const e = forkFromGameState(content, state, { brandName: "Fork Burgers", transfer: 1_000_000 });
    expect(e.hq.day).toBe(state.day);
    expect(e.sites).toHaveLength(1);
    expect(e.sites[0]!.name).toBe(state.restaurantName);
    expect(e.sites[0]!.districtId).toBe(state.districtId);
    expect(e.focusedSiteId).toBe("s1");
    expect(e.calibration.days).toBeGreaterThan(80);
    expect(e.brand.formula.menuDishIds.length).toBe(state.menu.filter((m) => m.active).length);
  });
});

describe("scale", () => {
  it("5,000 aggregate sites step in under 50 ms/day", () => {
    const r = benchmark(content, 5000, 20);
    expect(r.sites).toBeGreaterThan(4900);
    expect(r.msPerDay).toBeLessThan(50);
  });
});

describe("headless styles", () => {
  it("franchise-fast outgrows company-owned, which outgrows In-N-Out-slow, over 6 years", () => {
    const f = summariseRun(runStyle(content, "franchise", 1, 6));
    const c = summariseRun(runStyle(content, "company", 1, 6));
    const i = summariseRun(runStyle(content, "innout", 1, 6));
    expect(f.sites).toBeGreaterThan(c.sites);
    expect(c.sites).toBeGreaterThanOrEqual(i.sites);
    expect(i.avgSiteRevenue).toBeGreaterThan(c.avgSiteRevenue);
    for (const r of [f, c, i]) expect(r.bankrupt).toBe(false);
    // Round 5: franchising wins first (5-6 years), the company path is still on its way.
    expect(f.win).toBe(true);
    expect(f.winYear!).toBeGreaterThan(4.5);
    expect(c.win).toBe(false);
  });

  it("round 5: company-owned wins in ~7-8 years and In-N-Out-slow can win inside 10 (seed 1)", () => {
    const c = summariseRun(runStyle(content, "company", 1, 8));
    expect(c.win).toBe(true);
    expect(c.winYear!).toBeGreaterThan(6.5);
    const i = summariseRun(runStyle(content, "innout", 1, 10));
    expect(i.win).toBe(true);
    expect(i.winYear!).toBeGreaterThan(c.winYear!);
  });
});
