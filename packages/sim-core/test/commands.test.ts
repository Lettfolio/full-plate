import { describe, expect, it } from "vitest";
import { applyCommand, candidates, runDay, serialize, tick } from "../src/index";
import { RECRUITMENT_FEE, TABLE_COST, MAX_STAFF } from "../src/constants";
import type { Command, GameState, SimEvent } from "../src/types";
import { SERVICE_TICKS } from "../src/types";
import { C, fresh, ready, step } from "./helpers";

function expectRejected(state: GameState, cmd: Command): SimEvent[] {
  const r = applyCommand(C, state, cmd);
  const bad = r.events.filter((e) => e.type === "LOG" && e.entry.kind === "bad");
  expect(bad.length).toBe(1);
  // Only the log changes on rejection.
  expect(serialize({ ...r.state, log: [] })).toBe(serialize({ ...state, log: [] }));
  return r.events;
}

describe("menu commands", () => {
  it("add, price, deactivate and remove", () => {
    let s = step(fresh(), { type: "ADD_MENU_ITEM", dishId: "burger", price: 1500 });
    expect(s.menu).toHaveLength(1);
    s = step(s, { type: "SET_MENU_ITEM", dishId: "burger", price: 1600, active: false });
    expect(s.menu[0]).toMatchObject({ price: 1600, active: false });
    s = step(s, { type: "REMOVE_MENU_ITEM", dishId: "burger" });
    expect(s.menu).toHaveLength(0);
  });

  it("rejects bad menu input", () => {
    const s = step(fresh(), { type: "ADD_MENU_ITEM", dishId: "burger", price: 1500 });
    expectRejected(s, { type: "SET_MENU_ITEM", dishId: "burger", price: -1 });
    expectRejected(s, { type: "SET_MENU_ITEM", dishId: "burger", price: 12.5 });
    expectRejected(s, { type: "SET_MENU_ITEM", dishId: "nope", price: 100 });
    expectRejected(s, { type: "ADD_MENU_ITEM", dishId: "burger", price: 100 });
    expectRejected(s, { type: "ADD_MENU_ITEM", dishId: "unknown", price: 100 });
    expectRejected(s, { type: "ADD_MENU_ITEM", dishId: "steak", price: -5 });
    expectRejected(s, { type: "REMOVE_MENU_ITEM", dishId: "steak" });
  });
});

describe("staff commands", () => {
  it("hires a candidate once and charges the fee", () => {
    const s0 = fresh();
    const s1 = step(s0, { type: "HIRE", candidateIndex: 0 });
    expect(s1.staff).toHaveLength(1);
    expect(s1.cash).toBe(s0.cash - RECRUITMENT_FEE);
    expect(s1.staff[0]!.name).toBe(candidates(C, s0)[0]!.name);
    expect(candidates(C, s1)[0]!.hired).toBe(true);
    expectRejected(s1, { type: "HIRE", candidateIndex: 0 });
  });

  it("rejects hiring with no cash, bad index or a full roster", () => {
    const s = fresh();
    expectRejected({ ...s, cash: 0 }, { type: "HIRE", candidateIndex: 0 });
    expectRejected(s, { type: "HIRE", candidateIndex: 99 });
    expectRejected(s, { type: "HIRE", candidateIndex: -1 });
    const full = { ...s, staff: Array.from({ length: MAX_STAFF }, (_, i) => ({ ...ready().staff[0]!, id: `x${i}` })) };
    expectRejected(full, { type: "HIRE", candidateIndex: 1 });
  });

  it("fires staff (others lose a little mood) and sets rotas", () => {
    const s = ready();
    const [a, b] = s.staff;
    const fired = step(s, { type: "FIRE", staffId: a!.id });
    expect(fired.staff.map((x) => x.id)).toEqual([b!.id]);
    expect(fired.staff[0]!.mood).toBeLessThan(b!.mood);
    const rota = [true, false, true, false, true, false, true];
    expect(step(s, { type: "SET_ROTA", staffId: a!.id, rota }).staff[0]!.rota).toEqual(rota);
    expectRejected(s, { type: "FIRE", staffId: "ghost" });
    expectRejected(s, { type: "SET_ROTA", staffId: a!.id, rota: [true] });
    expectRejected(s, { type: "SET_ROTA", staffId: "ghost", rota });
  });

  it("candidates are deterministic per seed+day and mix roles", () => {
    const s = fresh(4);
    const a = candidates(C, s);
    expect(candidates(C, s)).toEqual(a);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(new Set(a.map((c) => c.role))).toEqual(new Set(["chef", "server"]));
    expect(candidates(C, { ...s, day: 1 })).not.toEqual(a);
    expect(candidates({ ...C, staffArchetypes: [] }, s)).toEqual([]);
  });
});

describe("stock and tables", () => {
  it("orders stock for tomorrow and delivers it at END_DAY", () => {
    let s = step(ready(), { type: "ORDER_STOCK", ingredientId: "beef", qty: 20 });
    expect(s.orders).toHaveLength(1);
    const before = s.stock.find((x) => x.ingredientId === "beef")!.qty;
    s = runDay(C, s).state;
    if (s.phase === "event") s = step(s, { type: "RESOLVE_EVENT", choiceId: C.events.find((e) => e.id === s.activeEvent!.eventId)!.choices[0]!.id });
    else s = step(s, { type: "END_DAY" });
    expect(s.orders).toHaveLength(0);
    expect(s.stock.find((x) => x.ingredientId === "beef")!.qty).toBeGreaterThan(before - 50 + 19);
    const batch = s.stock.find((x) => x.ingredientId === "beef")!.batches!.at(-1)!;
    // Day 0 is a fixture day with no short delivery for this seed; the batch keeps the pence paid per portion.
    expect(batch).toEqual({ qty: 20, day: 1, cost: 320 });
  });

  it("rejects bad stock orders and unaffordable tables", () => {
    const s = fresh();
    expectRejected(s, { type: "ORDER_STOCK", ingredientId: "beef", qty: 0 });
    expectRejected(s, { type: "ORDER_STOCK", ingredientId: "beef", qty: 2.5 });
    expectRejected(s, { type: "ORDER_STOCK", ingredientId: "caviar", qty: 1 });
    expectRejected({ ...s, cash: -10_000_000 }, { type: "ORDER_STOCK", ingredientId: "beef", qty: 1 });
    expectRejected({ ...s, cash: TABLE_COST - 1 }, { type: "BUY_TABLE" });
  });

  it("buys tables up to the max", () => {
    let s = { ...fresh(), cash: 100_000_000 };
    s = step(s, { type: "BUY_TABLE" });
    expect(s.tables).toHaveLength(C.balance.startingTables + 1);
    while (s.tables.length < C.balance.maxTables) s = step(s, { type: "BUY_TABLE" });
    expectRejected(s, { type: "BUY_TABLE" });
  });
});

describe("phases", () => {
  it("START_SERVICE → ticks → SERVICE_ENDED with a DayResult → END_DAY", () => {
    let s = step(ready(), { type: "START_SERVICE" });
    expect(s).toMatchObject({ phase: "service", tick: 0 });
    expectRejected(s, { type: "START_SERVICE" });
    expectRejected(s, { type: "HIRE", candidateIndex: 2 });
    let ended: SimEvent | undefined;
    for (let i = 0; i < SERVICE_TICKS; i++) {
      const r = tick(C, s);
      s = r.state;
      ended ??= r.events.find((e) => e.type === "SERVICE_ENDED");
    }
    expect(["evening", "event"]).toContain(s.phase);
    expect(ended).toBeDefined();
    if (ended?.type !== "SERVICE_ENDED") throw new Error("no result");
    expect(ended.result).toMatchObject({ day: 0 });
    expect(ended.result.covers).toBeGreaterThan(0);
    expect(s.history).toHaveLength(1);
    expect(tick(C, s).state).toBe(s); // no-op outside service
    if (s.phase === "evening") {
      const next = step(s, { type: "END_DAY" });
      expect(next).toMatchObject({ phase: "planning", day: 1, todays: { reviews: [] } });
    }
  });

  it("event phase resolves into the next day's planning", () => {
    const s0 = runDay(C, ready()).state;
    const s = { ...s0, phase: "event" as const, activeEvent: { eventId: "boiler" } };
    expectRejected(s, { type: "END_DAY" });
    expectRejected(s, { type: "RESOLVE_EVENT", choiceId: "nope" });
    const next = step(s, { type: "RESOLVE_EVENT", choiceId: "fix" });
    expect(next).toMatchObject({ phase: "planning", day: s.day + 1 });
    expect(next.activeEvent).toBeUndefined();
    expect(next.cash).toBe(s.cash - 25_000);
  });

  it("rejects out-of-phase and unknown commands", () => {
    const s = ready();
    expectRejected(s, { type: "END_DAY" });
    expectRejected(s, { type: "RESOLVE_EVENT", choiceId: "x" });
    expectRejected(s, { type: "COMP_TABLE", customerId: "c" });
    expectRejected(s, { type: "NEW_GAME", seed: 1, districtId: "highstreet", restaurantName: "x", difficulty: "cosy" });
    expectRejected(s, { type: "WHAT" } as unknown as Command);
    expectRejected({ ...s, phase: "gameover" }, { type: "START_SERVICE" });
  });
});

describe("service actions", () => {
  it("COMP_TABLE frees the meal for a seated party", () => {
    let s = step(ready(), { type: "START_SERVICE" });
    while (s.phase === "service" && !s.customers.some((c) => c.stage === "ordered")) s = tick(C, s).state;
    const target = s.customers.find((c) => c.stage === "ordered")!;
    s = step(s, { type: "COMP_TABLE", customerId: target.id });
    expect(s.customers.find((c) => c.id === target.id)!.comped).toBe(true);
    expectRejected(s, { type: "COMP_TABLE", customerId: target.id });
    expectRejected(s, { type: "COMP_TABLE", customerId: "ghost" });
    let paid: SimEvent | undefined;
    while (s.phase === "service" && !paid) {
      const r = tick(C, s);
      s = r.state;
      paid = r.events.find((e) => e.type === "CUSTOMER_PAID" && e.customerId === target.id);
    }
    expect(paid).toMatchObject({ spend: 0 });
  });

  it("EIGHTY_SIX pulls a dish so nobody orders it", () => {
    let s = step(ready(), { type: "EIGHTY_SIX", dishId: "burger" }, { type: "START_SERVICE" });
    expectRejected(s, { type: "EIGHTY_SIX", dishId: "burger" });
    expectRejected(s, { type: "EIGHTY_SIX", dishId: "caviar" });
    s = step(s, { type: "EIGHTY_SIX", dishId: "steak" });
    const ordered = new Set<string>();
    while (s.phase === "service") {
      s = tick(C, s).state;
      for (const c of s.customers) c.order.forEach((d) => ordered.add(d));
    }
    expect(ordered.has("burger")).toBe(false);
    expect(ordered.has("steak")).toBe(false);
    expect(ordered.size).toBeGreaterThan(0);
  });

  it("dishes with no stock are 86'd automatically at opening", () => {
    // Day 1 (not the first service, which would buy opening stock).
    const s = step({ ...ready(), day: 1, stats: { totalCovers: 1, totalRevenue: 1, daysOpen: 1 }, stock: [] }, { type: "START_SERVICE" });
    expect(s.eightySixed!.length).toBe(C.dishes.length);
    expect(s.service!.arrivals.every((a) => a.entryLogit < -10)).toBe(true);
  });
});
