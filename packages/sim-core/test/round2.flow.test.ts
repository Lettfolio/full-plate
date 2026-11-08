/**
 * Round 2: goals, opening stock + suggestedOrder, food-cost reconciliation, short deliveries, and the
 * tricky-path tests REVIEW.md asked for (event day end-to-end, game over through play, cosy clamp over
 * several days, spoilage with several batches, stale event ids).
 */
import { describe, expect, it } from "vitest";
import { applyCommand, candidates, deserialize, expectedCovers, newGame, openingStockBudget, runDay, serialize, suggestedOrder } from "../src/index";
import { OPENING_STOCK_BUDGET } from "../src/constants";
import { advanceDay, shortLine } from "../src/engine";
import { GOAL_LADDER } from "../src/goals/text";
import { addStock, spoil, stockValue } from "../src/stock";
import { goalsForTier, updateGoals } from "../src/systems/goals";
import type { DayResult, GameState } from "../src/types";
import { C, fresh, playDays, ready, readyEmpty, step, stocked } from "./helpers";

const finishDay = (s: GameState): GameState => {
  const ev = C.events.find((e) => e.id === s.activeEvent?.eventId);
  if (s.phase === "event") return step(s, { type: "RESOLVE_EVENT", choiceId: ev ? ev.choices.at(-1)!.id : "" });
  return s.phase === "evening" ? step(s, { type: "END_DAY" }) : s;
};

describe("goals", () => {
  it("newGame seeds tier 0; the ladder has 4 tiers with text and targets", () => {
    const s = fresh();
    expect(s.goals!.map((g) => g.id)).toEqual(GOAL_LADDER.filter((g) => g.tier === 0).map((g) => g.id));
    expect(new Set(GOAL_LADDER.map((g) => g.tier))).toEqual(new Set([0, 1, 2, 3]));
    for (const t of [0, 1, 2, 3]) for (const g of goalsForTier(C, t)) expect(g.title).not.toMatch(/\{target\}/);
    expect(goalsForTier(C, 3).find((g) => g.id === "t3-tables")!.target).toBe(8);
  });

  it("tier 0 completes through commands, emits GOAL_COMPLETED and unlocks tier 1", () => {
    let s = fresh();
    const events: string[] = [];
    const run = (cmd: Parameters<typeof applyCommand>[2]) => {
      const r = applyCommand(C, s, cmd);
      for (const e of r.events) if (e.type === "GOAL_COMPLETED") events.push(e.goalId);
      s = r.state;
    };
    for (const d of C.dishes) run({ type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
    expect(events).toEqual(["t0-dishes"]);
    const pool = candidates(C, s);
    run({ type: "HIRE", candidateIndex: pool.findIndex((c) => c.role === "chef") });
    run({ type: "HIRE", candidateIndex: pool.findIndex((c) => c.role === "server") });
    expect(events).toContain("t0-chef");
    expect(events).toContain("t0-server");
    run({ type: "ORDER_STOCK", ingredientId: "beef", qty: 10 });
    expect(events).toContain("t0-stock");
    const popBefore = s.reputation.popularity;
    run({ type: "START_SERVICE" });
    expect(events).toContain("t0-open");
    expect(s.reputation.popularity).toBeCloseTo(popBefore + 1);
    expect(s.goals!.some((g) => g.tier === 1)).toBe(true);
    expect(s.goals!.filter((g) => g.tier === 0).every((g) => g.done)).toBe(true);
  });

  it("evening goals: covers, rating, profit; cash rewards are paid once", () => {
    const s = { ...ready(), goals: goalsForTier(C, 1) };
    const day: DayResult = { ...runDay(C, ready()).state.history.at(-1)!, covers: 35, averageRating: 4.2, profit: 100 };
    const r = updateGoals(C, { ...s, history: [day] });
    const done = r.state.goals!.filter((g) => g.done).map((g) => g.id);
    expect(done).toEqual(["t1-covers", "t1-rating", "t1-profit"]);
    expect(r.state.cash).toBe(s.cash + 10_000 + 10_000 + 15_000);
    expect(updateGoals(C, r.state).state).toBe(r.state);
  });

  it("the profit streak resets on a losing day; survive/popularity/tables measure state", () => {
    const base = { ...ready(), goals: goalsForTier(C, 3) };
    const win = { ...runDay(C, ready()).state.history.at(-1)!, profit: 1 };
    const lose = { ...win, profit: -1 };
    const streak = (h: DayResult[]) => updateGoals(C, { ...base, history: h }).state.goals!.find((g) => g.id === "t3-streak")!.progress;
    expect(streak([win, win, win])).toBe(3);
    expect(streak([win, win, lose, win])).toBe(1);
    const big = updateGoals(C, { ...base, stats: { ...base.stats, daysOpen: 90 }, reputation: { popularity: 80, prestige: 50 } }).state;
    expect(big.goals!.filter((g) => g.done).map((g) => g.id)).toEqual(["t3-survive", "t3-pop"]);
  });

  it("an incident handled counts toward its goal", () => {
    const s = { ...ready(), goals: goalsForTier(C, 1), incidentsHandled: 1 };
    expect(updateGoals(C, s).state.goals!.find((g) => g.id === "t1-incident")!.done).toBe(true);
  });

  it("a whole first fortnight of real play completes the opening goals", () => {
    const s = playDays(ready(5), 14);
    const done = s.goals!.filter((g) => g.done).map((g) => g.id);
    expect(done).toEqual(expect.arrayContaining(["t0-dishes", "t0-chef", "t0-server", "t0-open", "t1-covers"]));
  });
});

describe("opening stock and suggestedOrder", () => {
  it("starts empty and buys a budgeted opening stock for the menu at the first START_SERVICE", () => {
    const s = readyEmpty();
    expect(s.stock).toEqual([]);
    expect(openingStockBudget(C)).toBe(OPENING_STOCK_BUDGET);
    const open = step(s, { type: "START_SERVICE" });
    const spent = s.cash - open.cash;
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(OPENING_STOCK_BUDGET);
    expect(stockValue(C, open.stock)).toBeCloseTo(spent, -1);
    expect(open.eightySixed).toEqual([]);
    // Only ingredients the menu uses.
    const used = new Set(C.dishes.flatMap((d) => d.ingredients.map((i) => i.id)));
    for (const row of open.stock) expect(used.has(row.ingredientId)).toBe(true);
  });

  it("respects BalanceDef.openingStockBudget, including 0, and never buys again on later days", () => {
    const pack = { ...C, balance: { ...C.balance, openingStockBudget: 0 } };
    let s = newGame(pack, { type: "NEW_GAME", seed: 1, districtId: "highstreet", restaurantName: "x", difficulty: "normal" });
    for (const d of C.dishes) s = applyCommand(pack, s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
    expect(applyCommand(pack, s, { type: "START_SERVICE" }).state.stock).toEqual([]);
    const day1 = { ...readyEmpty(), day: 1, stats: { totalCovers: 5, totalRevenue: 1, daysOpen: 1 } };
    expect(step(day1, { type: "START_SERVICE" }).stock).toEqual([]);
  });

  it("first day with opening stock: no £1k spoilage, and days 1-3 can be stocked from suggestedOrder", () => {
    let s = readyEmpty(7);
    let spoiled = 0;
    for (let d = 0; d < 4; d++) {
      s = runDay(C, s).state;
      spoiled += s.history.at(-1)!.waste.spoil;
      for (const line of suggestedOrder(C, s)) s = step(s, { type: "ORDER_STOCK", ...line });
      s = finishDay(s);
    }
    expect(spoiled).toBeLessThan(10_000);
    expect(s.history.every((h) => h.covers > 10)).toBe(true);
  });

  it("suggestedOrder covers the forecast net of stock and orders, in multiples of 5", () => {
    const s = readyEmpty();
    expect(expectedCovers(C, s)).toBeGreaterThanOrEqual(20);
    const lines = suggestedOrder(C, s);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.qty % 5).toBe(0);
    const ordered = lines.reduce((acc, l) => step(acc, { type: "ORDER_STOCK", ...l }), s);
    expect(suggestedOrder(C, ordered)).toEqual([]);
    expect(suggestedOrder(C, { ...s, menu: [] })).toEqual([]);
    // After a day, the forecast follows demand (covers + walk-outs).
    const after = runDay(C, ready()).state;
    const h = after.history.at(-1)!;
    expect(expectedCovers(C, after)).toBe(Math.max(20, Math.round((h.covers + h.walkouts) * 1.1)));
  });
});

describe("P&L reconciliation", () => {
  it("food cost + prep + spoil waste = cash spent on stock − change in stock value", () => {
    let s = ready(9);
    const v0 = stockValue(C, s.stock);
    let spent = 0;
    let booked = 0;
    let refunds = 0;
    for (let d = 0; d < 6 && s.phase !== "gameover"; d++) {
      const beforeOpen = stockValue(C, s.stock);
      s = step(s, { type: "START_SERVICE" }); // day 0 buys the opening stock top-up (goal rewards also land here)
      spent += stockValue(C, s.stock) - beforeOpen;
      s = runDay(C, s).state;
      const short = shortLine(s, s.day + 1);
      if (short) refunds += Math.round((s.orders[short.index]!.cost * short.missing) / s.orders[short.index]!.qty);
      s = finishDay(s);
      const h = s.history.at(-1)!;
      booked += h.foodCost + h.waste.prep + h.waste.spoil;
      for (const line of suggestedOrder(C, s)) {
        s = step(s, { type: "ORDER_STOCK", ...line });
        spent += s.orders.at(-1)!.cost; // (not Δcash: a goal reward can land on the same command)
      }
    }
    const v1 = stockValue(C, s.stock) + s.orders.reduce((a, o) => a + o.cost, 0);
    expect(booked).toBeCloseTo(spent - refunds - (v1 - v0), -2);
  });

  it("the DayResult lines sum to profit, including incident costs", () => {
    const s = playDays(ready(4), 10);
    for (const h of s.history) {
      const sum = h.revenue - (h.vat ?? 0) - h.foodCost - h.waste.prep - h.waste.spoil - h.labourCost - h.rent - (h.overheads ?? 0) - (h.incidentCosts ?? 0) - h.loanPayment;
      expect(sum).toBe(h.profit);
    }
  });
});

describe("short deliveries", () => {
  it("are deterministic, refund the missing part and set shortDelivery for the morning", () => {
    let found: { s: GameState; day: number } | undefined;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const s = step({ ...ready(seed), phase: "evening" }, { type: "ORDER_STOCK", ingredientId: "beef", qty: 40 });
      if (shortLine(s, s.day + 1)) found = { s, day: s.day + 1 };
    }
    const { s } = found!;
    const short = shortLine(s, s.day + 1)!;
    const next = advanceDay(s, C).state;
    expect(next.shortDelivery).toEqual({ ingredientId: "beef", missing: short.missing });
    expect(next.cash).toBe(s.cash + Math.round((s.orders[0]!.cost * short.missing) / 40));
    expect(next.stock.find((x) => x.ingredientId === "beef")!.qty).toBe(40 + 40 - short.missing);
    expect(next.log.some((l) => /came .* short/.test(l.text))).toBe(true);
    expect(advanceDay({ ...next, phase: "evening" }, C).state.shortDelivery).toBeUndefined();
  });
});

describe("tricky paths (REVIEW.md)", () => {
  it("a full day ending in an event → RESOLVE_EVENT → deliveries landed and the 86 list cleared", () => {
    let hit: GameState | undefined;
    for (let seed = 1; seed < 300 && !hit; seed++) {
      let s = step({ ...ready(seed), day: 5 }, { type: "ORDER_STOCK", ingredientId: "veg", qty: 30 }, { type: "EIGHTY_SIX", dishId: "soup" });
      s = runDay(C, s).state;
      if (s.phase === "event") hit = s;
    }
    const s = hit!;
    expect(s.history.at(-1)!.day).toBe(5);
    const ev = C.events.find((e) => e.id === s.activeEvent!.eventId)!;
    const vegBefore = s.stock.find((x) => x.ingredientId === "veg")?.qty ?? 0;
    const next = step(s, { type: "RESOLVE_EVENT", choiceId: ev.choices[0]!.id });
    expect(next.phase).toBe("planning");
    expect(next.day).toBe(6);
    expect(next.eightySixed).toEqual([]);
    expect(next.orders).toEqual([]);
    expect(next.stock.find((x) => x.ingredientId === "veg")!.qty).toBeGreaterThan(vegBefore);
    expect(next.activeEvent).toBeUndefined();
  });

  it("an old save whose event id no longer exists is dismissed instead of getting stuck", () => {
    const s = { ...runDay(C, ready()).state, phase: "event" as const, activeEvent: { eventId: "removed-from-content" } };
    const loaded = deserialize(serialize(s));
    const r = applyCommand(C, loaded, { type: "RESOLVE_EVENT", choiceId: "" });
    expect(r.state.phase).toBe("planning");
    expect(r.state.day).toBe(s.day + 1);
    // A real event still needs a real choice.
    const real = { ...s, activeEvent: { eventId: "boiler" } };
    expect(applyCommand(C, real, { type: "RESOLVE_EVENT", choiceId: "nope" }).state.phase).toBe("event");
  });

  it("game over through real play: no event is drawn after phase gameover, and commands are refused", () => {
    let s: GameState = { ...ready(2), cash: -2_000_000, staff: [] };
    let days = 0;
    while (s.phase !== "gameover" && days++ < 40) s = finishDay(runDay(C, stocked(s, 20)).state);
    expect(s.phase).toBe("gameover");
    expect(s.activeEvent).toBeUndefined();
    expect(s.gameOverReason).toMatch(/14 days/);
    expect(applyCommand(C, s, { type: "END_DAY" }).state.phase).toBe("gameover");
    expect(runDay(C, s).state).toBe(s);
  });

  it("cosy floor over several days: cash clamps at 0 every evening with a warning", () => {
    let s: GameState = { ...ready(3, "cosy"), cash: 0 };
    let warnings = 0;
    for (let d = 0; d < 5; d++) {
      const r = runDay(C, s);
      warnings += r.events.filter((e) => e.type === "CASH_LOW").length;
      s = finishDay(r.state);
      expect(s.cash).toBeGreaterThanOrEqual(0);
      expect(s.phase).not.toBe("gameover");
    }
    expect(warnings).toBeGreaterThanOrEqual(3);
  });

  it("spoilage with several batches bins exactly the expired ones and values them at the price paid", () => {
    // beef shelf life 4: batches from day 0 and 1 expire by day 5; day-3 batch survives.
    let st = addStock([], "beef", 5, 0, 300);
    st = addStock(st, "beef", 4, 1, 320);
    st = addStock(st, "beef", 3, 3, 400);
    const at4 = spoil(C, st, 4);
    expect(at4.binned).toEqual([{ id: "beef", qty: 5, cost: 1500 }]);
    const at5 = spoil(C, st, 5);
    expect(at5.binned).toEqual([{ id: "beef", qty: 9, cost: 1500 + 1280 }]);
    expect(at5.stock[0]!.batches).toEqual([{ qty: 3, day: 3, cost: 400 }]);
    expect(at5.stock[0]!.oldestDay).toBe(3);
    expect(spoil(C, st, 3).binned).toEqual([]);
  });
});
