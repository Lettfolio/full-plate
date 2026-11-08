/** Focused tests for the per-tick service systems. */
import { describe, expect, it } from "vitest";
import { MENU_READ_TICKS, PATIENCE_DECAY, PATIENCE_SPEED_BASE } from "../src/constants";
import { arrivalSystem, entryLogit, expectedSpendPerHead, offeredDishes, planArrivals, potentialParties } from "../src/systems/arrival";
import { clearingSystem, dirtyTicksFor } from "../src/systems/clearing";
import { assignTickets, cookTicks, cooksOnShift, kitchenSystem, plateQuality } from "../src/systems/kitchen";
import { chooseForGuest, dishWeight, orderSystem } from "../src/systems/order";
import { paymentSystem, plateWasteOf, ratingOf, satisfactionOf, speedScore, tipOf, valueScore } from "../src/systems/payment";
import { findTable, seatingSystem } from "../src/systems/seating";
import { advanceCustomer, eatTicks, patienceDecay, serviceSystem } from "../src/systems/service";
import { frontCharm, moodMult, serverActionsPerTick } from "../src/systems/system";
import type { GameState, KitchenTicket } from "../src/types";
import { C, customer, inService, ready, rng, staffMember } from "./helpers";

const families = C.segments[0]!;
const foodies = C.segments[1]!;

describe("ArrivalSystem", () => {
  it("footfall scales with popularity and footfall mods", () => {
    const s = ready();
    const base = potentialParties(C, s);
    expect(potentialParties(C, { ...s, reputation: { ...s.reputation, popularity: 100 } })).toBeGreaterThan(base);
    expect(potentialParties(C, { ...s, footfallMods: [{ mult: 2, daysRemaining: 1 }] })).toBeCloseTo(base * 2);
  });

  it("over-priced menus lower the entry logit for price-sensitive segments", () => {
    const s = ready();
    const offered = offeredDishes(C, s);
    const pricey = offered.map((o) => ({ ...o, item: { ...o.item, price: o.item.price * 3 } }));
    expect(entryLogit(families, pricey, 30)).toBeLessThan(entryLogit(families, offered, 30) - 1);
    expect(entryLogit(families, [], 30)).toBeLessThan(-10);
    expect(expectedSpendPerHead(offered)).toBeGreaterThan(1500);
    expect(expectedSpendPerHead([])).toBe(0);
  });

  it("brings customers in over a service and respects the queue cap", () => {
    let s = inService(ready());
    s = { ...s, service: { ...s.service!, arrivals: planArrivals(C, s).map((a) => ({ ...a, potentialParties: a.potentialParties * 50, entryLogit: 5 })) } };
    const r = arrivalSystem(C, s, rng());
    expect(r.state.customers.length).toBeGreaterThan(0);
    expect(r.state.customers.length).toBeLessThanOrEqual(8);
    expect(r.events.every((e) => e.type === "CUSTOMER_ARRIVED")).toBe(true);
    expect(r.state.customers[0]!.stage).toBe("queue");
    expect(s.customers).toHaveLength(0); // input untouched
  });

  it("stops seating new parties after last orders", () => {
    const s = { ...inService(ready()), tick: 110 };
    expect(arrivalSystem(C, s, rng()).state).toBe(s);
  });
});

describe("SeatingSystem", () => {
  it("seats queued parties at the smallest free clean table", () => {
    const tables = [{ id: "A", seats: 6, dirtyTicks: 0 }, { id: "B", seats: 2, dirtyTicks: 0 }, { id: "C", seats: 2, dirtyTicks: 2 }];
    expect(findTable(tables, 2)!.id).toBe("B");
    expect(findTable(tables, 7)).toBeUndefined();
    const s: GameState = { ...inService(ready()), customers: [customer("q1"), customer("q2", { partySize: 4 })] };
    const r = seatingSystem(C, s, rng());
    expect(r.state.customers.every((c) => c.stage === "seated")).toBe(true);
    expect(r.state.tables.filter((t) => t.occupiedBy)).toHaveLength(2);
    expect(r.events.filter((e) => e.type === "CUSTOMER_SEATED")).toHaveLength(2);
  });

  it("is limited by front-of-house actions", () => {
    const base = inService(ready(), 0.5);
    const s: GameState = { ...base, service: { ...base.service!, actionsLeft: 0 }, customers: [customer("q1"), customer("q2")] };
    const r = seatingSystem(C, s, rng());
    expect(r.state.customers.filter((c) => c.stage === "seated")).toHaveLength(1);
  });
});

describe("OrderSystem", () => {
  it("weights dishes by appeal and price", () => {
    const [o] = offeredDishes(C, ready());
    const pricey = { ...o!, item: { ...o!.item, price: o!.dish.suggestedPrice * 2 } };
    expect(dishWeight(pricey, families)).toBeLessThan(dishWeight(o!, families));
    const picks = chooseForGuest(rng(), offeredDishes(C, ready()), foodies);
    expect(picks[0]!.dish.course).toBe("main");
  });

  it("takes orders after the menu is read, fires tickets and consumes stock", () => {
    const base = inService(ready());
    const s: GameState = { ...base, customers: [customer("c1", { stage: "seated", stageTick: base.tick - MENU_READ_TICKS, tableId: "T1" })] };
    const r = orderSystem(C, s, rng());
    const c = r.state.customers[0]!;
    expect(c.stage).toBe("ordered");
    expect(c.order.length).toBeGreaterThanOrEqual(2);
    expect(c.spend).toBeGreaterThan(0);
    expect(r.state.tickets).toHaveLength(c.order.length);
    const used = Object.values(r.state.service!.ingredientsUsed).reduce((a, b) => a + b, 0);
    const stockDrop = s.stock.reduce((a, x) => a + x.qty, 0) - r.state.stock.reduce((a, x) => a + x.qty, 0);
    expect(stockDrop).toBeCloseTo(used, 5);
  });

  it("parties who just sat down wait to read the menu", () => {
    const base = inService(ready());
    const s = { ...base, customers: [customer("c1", { stage: "seated", stageTick: base.tick })] };
    expect(orderSystem(C, s, rng()).state).toBe(s);
  });

  it("86s a dish that runs out and walks out a party that can't be fed", () => {
    const base = inService(ready());
    const s: GameState = { ...base, stock: [], customers: [customer("c1", { stage: "seated", stageTick: 0 })] };
    const r = orderSystem(C, s, rng());
    expect(r.state.eightySixed!.length).toBeGreaterThan(0);
    expect(r.state.customers[0]!.patience).toBe(0);
    expect(r.events.some((e) => e.type === "LOG" && e.entry.kind === "bad")).toBe(true);
  });
});

describe("KitchenSystem", () => {
  const dish = C.dishes.find((d) => d.id === "steak")!;
  const ticket = (over: Partial<KitchenTicket> = {}): KitchenTicket => ({
    id: "t1", customerId: "c1", dishId: "steak", createdTick: 0, ticksRemaining: 4, quality: 0, ...over,
  });

  it("quality follows skill, the dish ceiling and fatigue", () => {
    const cook = (skill: number, fatigue = 0) => ({ id: "k", skill, speed: 50, fatigue, mistakeMult: 0, capacity: 3, drinksOnly: false });
    const q = (skill: number, fatigue = 0) => plateQuality(rng(1), dish, cook(skill, fatigue), 0).quality;
    expect(q(90)).toBeGreaterThan(q(40));
    expect(q(100)).toBeLessThanOrEqual(dish.qualityCeiling + 15);
    expect(q(70, 100)).toBeLessThan(q(70, 0));
  });

  it("faster cooks need fewer ticks; the owner cooks when no chef is on", () => {
    expect(cookTicks(dish, 100)).toBeLessThan(cookTicks(dish, 0));
    const s = { ...ready(), staff: [] };
    expect(cooksOnShift(C, s).map((k) => k.id)).toEqual(["owner"]);
    const bar = { ...ready(), staff: [staffMember({ id: "b", role: "bar" })] };
    expect(cooksOnShift(C, bar).map((k) => k.drinksOnly)).toEqual([false, true]);
  });

  it("assigns tickets within cook capacity and plates when done", () => {
    const cooks = cooksOnShift(C, { ...ready(), staff: [] }); // owner, capacity 2
    const assigned = assignTickets(C, [ticket({ id: "a" }), ticket({ id: "b" }), ticket({ id: "c" })], cooks);
    expect(assigned.filter((t) => t.chefId)).toHaveLength(2);
    const s: GameState = {
      ...inService(ready()),
      customers: [customer("c1", { stage: "ordered", order: ["steak"] })],
      tickets: [ticket({ chefId: ready().staff[0]!.id, ticksRemaining: 1 })],
    };
    const r = kitchenSystem(C, s, rng());
    expect(r.state.tickets).toHaveLength(0);
    expect(r.events[0]).toMatchObject({ type: "DISH_PLATED" });
    expect(r.state.customers[0]).toMatchObject({ platesReady: 1, servedTick: s.tick });
    expect(r.state.service!.dishes.steak!.plated).toBe(1);
  });

  it("counts down unfinished tickets", () => {
    const s: GameState = { ...inService(ready()), tickets: [ticket({ chefId: ready().staff[0]!.id, ticksRemaining: 3 })] };
    expect(kitchenSystem(C, s, rng()).state.tickets[0]!.ticksRemaining).toBe(2);
    expect(kitchenSystem(C, { ...s, tickets: [] }, rng()).state.tickets).toEqual([]);
  });
});

describe("ServiceSystem", () => {
  it("patience falls faster for speed-sensitive segments and in the queue", () => {
    expect(patienceDecay("queue", families)).toBeCloseTo(PATIENCE_DECAY.queue * (PATIENCE_SPEED_BASE + families.speedWeight));
    expect(patienceDecay("queue", families)).toBeGreaterThan(patienceDecay("ordered", families));
    expect(patienceDecay("eating", families)).toBe(0);
    expect(eatTicks(4)).toBeGreaterThan(eatTicks(1));
  });

  it("walks out parties at zero patience and frees their table", () => {
    const base = inService(ready());
    const s: GameState = {
      ...base,
      tables: base.tables.map((t, i) => (i === 0 ? { ...t, occupiedBy: "c1" } : t)),
      customers: [customer("c1", { stage: "seated", tableId: base.tables[0]!.id, patience: 0.5 })],
    };
    const r = serviceSystem(C, s, rng());
    expect(r.state.customers[0]).toMatchObject({ stage: "left", walkedOut: true });
    expect(r.state.tables[0]!.occupiedBy).toBeUndefined();
    expect(r.state.todays.walkouts).toBe(2);
    expect(r.state.service!.walkoutParties).toBe(1);
    expect(r.events.some((e) => e.type === "CUSTOMER_WALKED_OUT")).toBe(true);
  });

  it("served parties eat and then ask for the bill", () => {
    let c = customer("c1", { stage: "ordered", order: ["burger"], platesReady: 1, servedTick: 5 });
    c = advanceCustomer(C, c, 5);
    expect(c.stage).toBe("eating");
    expect(advanceCustomer(C, c, 6).stage).toBe("eating");
    expect(advanceCustomer(C, c, c.eatUntil!).stage).toBe("paying");
    const s = inService(ready());
    expect(serviceSystem(C, s, rng()).state).toBe(s);
  });
});

describe("PaymentSystem", () => {
  it("satisfaction rises with quality, speed and value", () => {
    const x = { quality: 60, waitTicks: 10, spendPerHead: 1800, charm: 50, comped: false };
    const base = satisfactionOf(families, x);
    expect(satisfactionOf(families, { ...x, quality: 90 })).toBeGreaterThan(base);
    expect(satisfactionOf(families, { ...x, waitTicks: 40 })).toBeLessThan(base);
    expect(satisfactionOf(families, { ...x, spendPerHead: 3600 })).toBeLessThan(base);
    expect(satisfactionOf(families, { ...x, comped: true })).toBeGreaterThan(base + 20);
    expect(speedScore(0)).toBe(100);
    expect(valueScore(families, 0)).toBe(100);
  });

  it("rating bands, tips and plate waste", () => {
    expect([10, 40, 55, 70, 90].map(ratingOf)).toEqual([1, 2, 3, 4, 5]);
    expect(tipOf(families, 5000, 2)).toBe(0);
    expect(tipOf(families, 5000, 5)).toBeGreaterThan(tipOf(families, 5000, 3));
    expect(plateWasteOf(1000, 90)).toBe(0);
    expect(plateWasteOf(1000, 0)).toBe(500);
  });

  it("takes payment, books revenue and tips, and records dish sales", () => {
    const s: GameState = {
      ...inService(ready()),
      customers: [customer("c1", { stage: "paying", order: ["burger", "lemonade"], spend: 1800, qualitySum: 140, platesReady: 2, servedTick: 8, foodCost: 500 })],
    };
    const r = paymentSystem(C, s, rng());
    const paid = r.events.find((e) => e.type === "CUSTOMER_PAID");
    expect(paid).toMatchObject({ customerId: "c1", spend: 1800 });
    expect(r.state.cash).toBe(s.cash + 1800);
    expect(r.state.todays).toMatchObject({ revenue: 1800, covers: 2 });
    expect(r.state.customers[0]).toMatchObject({ stage: "left", leftTick: s.tick });
    expect(r.state.service!.dishes.burger!.sold).toBe(1);
    expect(r.state.service!.paid).toHaveLength(1);
    expect(paymentSystem(C, inService(ready()), rng()).events).toEqual([]);
  });
});

describe("ClearingSystem", () => {
  it("frees paid tables as dirty, counts down, and drops old leavers", () => {
    const base = inService(ready());
    const s: GameState = {
      ...base,
      tables: base.tables.map((t, i) => (i === 0 ? { ...t, occupiedBy: "now" } : i === 1 ? { ...t, dirtyTicks: 2 } : t)),
      customers: [customer("now", { stage: "left", leftTick: base.tick }), customer("old", { stage: "left", leftTick: base.tick - 1 })],
      tickets: [{ id: "t", customerId: "w", dishId: "burger", createdTick: 0, ticksRemaining: 2, quality: 0 }],
    };
    const withWalkout = { ...s, customers: [...s.customers, customer("w", { stage: "left", walkedOut: true, leftTick: base.tick })] };
    const r = clearingSystem(C, withWalkout, rng());
    expect(r.state.tables[0]).toMatchObject({ occupiedBy: undefined, dirtyTicks: dirtyTicksFor(s) });
    expect(r.state.tables[1]!.dirtyTicks).toBe(1);
    expect(r.state.customers.map((c) => c.id)).toEqual(["now", "w"]);
    expect(r.state.tickets).toHaveLength(0);
    expect(clearingSystem(C, base, rng()).state).toBe(base);
  });

  it("a porter clears tables faster", () => {
    const s = ready();
    const withPorter = { ...s, staff: [...s.staff, staffMember({ id: "p", role: "porter" })] };
    expect(dirtyTicksFor(withPorter)).toBeLessThan(dirtyTicksFor(s));
  });
});

describe("front-of-house helpers", () => {
  it("servers, managers and mood shape actions and charm", () => {
    const s = ready();
    expect(serverActionsPerTick(C, s)).toBeGreaterThan(serverActionsPerTick(C, { ...s, staff: [] }) - 1);
    const mgr = { ...s, staff: [...s.staff, staffMember({ id: "m", role: "manager", charm: 90 })] };
    expect(serverActionsPerTick(C, mgr)).toBeGreaterThan(serverActionsPerTick(C, s));
    expect(serverActionsPerTick(C, { ...s, staff: [staffMember({ id: "m", role: "manager" })] })).toBeGreaterThan(1.5);
    expect(frontCharm(C, { ...s, staff: [] })).toBeGreaterThan(0);
    expect(moodMult(100)).toBeGreaterThan(moodMult(0));
  });
});
