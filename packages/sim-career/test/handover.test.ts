import { describe, expect, it } from "vitest";
import { applyCommand, candidates, RECRUITMENT_FEE, serialize } from "@full-plate/sim-core";
import { applyCareerCommand, applyWithPerks, canOpenOwn, handoverToOwner, LADDER, NLW, openingBudget, type CareerGame, type CareerState } from "../src/index";
import { content, played } from "./helpers";

function rich(g: CareerGame, rung?: number): CareerGame {
  const r = rung ?? LADDER[g.career.track].length - 1;
  return { ...g, career: { ...g.career, rung: r, role: LADDER[g.career.track][r]!.simRole, savings: 3_000_000 } };
}

describe("opening your own place", () => {
  it("the budget covers fit-out, deposit and a reserve; the loan scales with savings", () => {
    const g = played("chef", 0);
    const b = openingBudget(content, g.career);
    expect(b.fitOut).toBe(content.balance.fitOutCost);
    expect(b.savingsNeeded).toBeGreaterThan(0);
    expect(b.shortfall).toBe(b.savingsNeeded);
    expect(b.rungOk).toBe(false);
    const richer = openingBudget(content, { ...g.career, savings: 1_000_000 });
    expect(richer.loan).toBeGreaterThan(b.loan);
    expect(richer.loan).toBeLessThanOrEqual(content.balance.loanPrincipal);
  });

  it("canOpenOwn needs the rung and the money", () => {
    const g = played("chef", 0);
    expect(canOpenOwn(content, g.career)).toBe(false);
    expect(canOpenOwn(content, { ...g.career, savings: 3_000_000 })).toBe(false); // still a commis
    expect(canOpenOwn(content, rich(g).career)).toBe(true);
    const r = applyCareerCommand(content, g, { type: "OPEN_OWN_PLACE" });
    expect(r.rejected).toMatch(/sous chef/i);
  });

  it("a year as a waiter or manager earns the right to open (savings + loan)", () => {
    for (const track of ["waiter", "manager"] as const) {
      const g = played(track, 365);
      expect(g.career.canOpenOwn).toBe(true);
      expect(g.career.savings).toBeGreaterThan(openingBudget(content, g.career).savingsNeeded);
    }
  });
});

describe("handoverToOwner", () => {
  it("builds a fresh owner game with sim-core newGame: savings in, a loan, day 0 planning", () => {
    const g = rich(played("chef", 120));
    const h = handoverToOwner(content, g.career, g.state, { restaurantName: "Alex's" });
    expect(h.state.day).toBe(0);
    expect(h.state.phase).toBe("planning");
    expect(h.state.restaurantName).toBe("Alex's");
    expect(h.state.loan.principal).toBe(h.summary.loan);
    const d = content.districts.find((x) => x.id === h.state.districtId)!;
    expect(h.state.cash).toBe(g.career.savings + h.summary.loan - content.balance.fitOutCost - d.monthlyRent * d.depositMonths);
    expect(h.perks.length).toBe(h.summary.perks.length);
    expect(() => serialize(h.state)).not.toThrow();
    // The game runs normally from here.
    expect(applyCommand(content, h.state, { type: "START_SERVICE" }).state.phase).toBe("service");
  });

  it("a chef start brings the old head chef on day 1 at a discount", () => {
    const g = rich(played("chef", 120));
    const head = g.career.relationships.find((r) => r.wasHeadChef)!;
    expect(head).toBeDefined();
    const career: CareerState = { ...g.career, relationships: g.career.relationships.map((r) => (r === head ? { ...r, bond: 40 } : { ...r, bond: Math.min(r.bond, 20) })) };
    const h = handoverToOwner(content, career, g.state);
    const hired = h.state.staff.find((s) => s.name === head.name)!;
    expect(hired).toBeDefined();
    expect(hired.role).toBe("chef");
    const live = g.state.staff.find((s) => s.id === head.staffId) ?? head.snapshot;
    expect(hired.wage).toBeLessThan(live.wage);
    expect(hired.wage).toBeGreaterThanOrEqual(NLW);
    expect(h.summary.colleague!.discountPct).toBeGreaterThan(0);
    expect(h.summary.perks.some((p) => p.id === "colleague" && p.label.includes("head chef"))).toBe(true);
    // No recruitment fee: cash is exactly savings + loan − fit-out − deposit.
    const d = content.districts.find((x) => x.id === h.state.districtId)!;
    expect(h.state.cash).toBe(career.savings + h.summary.loan - content.balance.fitOutCost - d.monthlyRent * d.depositMonths);
  });

  it("no colleague when nobody likes you enough", () => {
    const g = rich(played("chef", 30));
    const career = { ...g.career, relationships: g.career.relationships.map((r) => ({ ...r, bond: 0 })) };
    const h = handoverToOwner(content, career, g.state);
    expect(h.state.staff).toHaveLength(0);
    expect(h.summary.colleague).toBeUndefined();
  });

  it("a bar start opens with a better drinks list, via ADD_MENU_ITEM", () => {
    const g = rich(played("bar", 30));
    const h = handoverToOwner(content, g.career, g.state);
    const drinks = h.state.menu.filter((m) => content.dishes.find((d) => d.id === m.dishId)!.course === "drink");
    expect(drinks.length).toBe(3);
    for (const m of drinks) expect(m.price).toBeGreaterThan(content.dishes.find((d) => d.id === m.dishId)!.suggestedPrice);
    expect(h.summary.perks.some((p) => p.id === "drinks_menu" && p.via === "command")).toBe(true);
  });

  it("a manager start gets lower hiring fees through applyWithPerks", () => {
    const g = rich(played("manager", 30));
    const h = handoverToOwner(content, g.career, g.state);
    expect(h.ownerPerks.hireRebatesLeft).toBe(3);
    let s = h.state;
    let perks = h.ownerPerks;
    const idx = candidates(content, s).findIndex((c) => !c.hired);
    const plain = applyCommand(content, s, { type: "HIRE", candidateIndex: idx }).state;
    const r = applyWithPerks(content, s, perks, { type: "HIRE", candidateIndex: idx });
    expect(r.state.cash - plain.cash).toBe(Math.round(RECRUITMENT_FEE / 2));
    expect(r.perks.hireRebatesLeft).toBe(2);
    // Non-hire commands pass straight through.
    s = r.state;
    perks = r.perks;
    const t = applyWithPerks(content, s, perks, { type: "BUY_TABLE" });
    expect(t.perks).toEqual(perks);
  });

  it("a waiter start's regulars follow (footfallMods) and reputation lifts popularity", () => {
    const g = rich(played("waiter", 30));
    const h = handoverToOwner(content, { ...g.career, reputation: 50 }, g.state);
    expect(h.state.footfallMods.some((m) => m.mult > 1)).toBe(true);
    expect(h.state.reputation.popularity).toBeGreaterThan(40);
    expect(h.summary.perks.find((p) => p.id === "owner_skills")!.via).toBe("needs_hook");
  });

  it("OPEN_OWN_PLACE ends the career and swaps in the owner game", () => {
    const g = rich(played("manager", 30));
    const r = applyCareerCommand(content, g, { type: "OPEN_OWN_PLACE", restaurantName: "Taylor's" });
    expect(r.rejected).toBeUndefined();
    expect(r.game.career.handover!.restaurantName).toBe("Taylor's");
    expect(r.game.career.employer.status).toBe("left");
    expect(r.game.career.jobs.at(-1)!.leftBecause).toBe("opened_own");
    expect(r.game.state.restaurantName).toBe("Taylor's");
    expect(r.events.some((e) => e.type === "OPENED_OWN_PLACE")).toBe(true);
    expect(applyCareerCommand(content, r.game, { type: "ASK_FOR_RAISE" }).rejected).toBeTruthy();
  });
});
