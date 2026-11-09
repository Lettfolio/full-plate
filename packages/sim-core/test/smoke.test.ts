import { describe, expect, it } from "vitest";
import { applyCommand, classifyMenu, newGame, runDay, serialize } from "../src/index";
import { playOne, STRATEGIES, summarise, toCsv, parseArgs, percentile } from "../src/headless";
import { addStock, canPlate, spoil, takeStock, freshnessScore, purchaseCost } from "../src/stock";
import type { GameState } from "../src/types";
import { C, fresh, playDays, ready, step } from "./helpers";

describe("365-day smoke run", () => {
  it("plays a full year quickly with sane numbers and no NaNs", () => {
    const t0 = performance.now();
    // The scripted balanced owner (hires cover for days off, restocks, reacts to incidents).
    const s = playOne(C, 11, 365, STRATEGIES.balanced, "normal").final!;
    const ms = performance.now() - t0;
    // Soft benchmark (round 3): wall-clock under a loaded CI box is noise, so log it; only a pathological slowdown fails.
    console.info(`[bench] 365-day balanced run: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(30_000);
    expect(s.day).toBeGreaterThan(300);
    const json = serialize(s);
    expect(json).not.toMatch(/NaN|null|Infinity/);
    for (const h of s.history) {
      expect(Number.isInteger(h.revenue)).toBe(true);
      expect(Number.isInteger(h.profit)).toBe(true);
      expect(h.averageRating).toBeGreaterThanOrEqual(0);
      expect(h.averageRating).toBeLessThanOrEqual(5);
    }
    expect(Number.isInteger(s.cash)).toBe(true);
    expect(s.stats.totalCovers).toBeGreaterThan(1000);
    expect(s.log.length).toBeLessThanOrEqual(200);
    expect(s.reputation.popularity).toBeGreaterThanOrEqual(0);
  });

  it("a restaurant with no menu and no staff goes bust on normal but not on cosy", () => {
    const loop = (s0: GameState) => {
      let s = s0;
      for (let d = 0; d < 400 && s.phase !== "gameover"; d++) {
        s = runDay(C, s).state;
        s = step(s, s.phase === "event" ? { type: "RESOLVE_EVENT", choiceId: C.events.find((e) => e.id === s.activeEvent!.eventId)!.choices.at(-1)!.id } : { type: "END_DAY" });
      }
      return s;
    };
    const normal = loop(fresh(3, "normal"));
    expect(normal.phase).toBe("gameover");
    expect(normal.gameOverReason).toMatch(/14 days/);
    const cosy = loop(fresh(3, "cosy"));
    expect(cosy.phase).not.toBe("gameover");
    expect(cosy.cash).toBeGreaterThanOrEqual(0);
    expect(applyCommand(C, normal, { type: "END_DAY" }).events[0]).toMatchObject({ type: "LOG" });
  });
});

describe("classifyMenu", () => {
  it("places dishes in Kasavana–Smith quadrants", () => {
    const s = ready();
    const menu = [
      { dishId: "a", price: 0, active: true, sold7d: 100, margin7d: 100_000 }, // popular, 1000/plate
      { dishId: "b", price: 0, active: true, sold7d: 100, margin7d: 20_000 },  // popular, 200/plate
      { dishId: "c", price: 0, active: true, sold7d: 10, margin7d: 15_000 },   // rare, 1500/plate
      { dishId: "d", price: 0, active: true, sold7d: 10, margin7d: 1_000 },    // rare, 100/plate
      { dishId: "e", price: 0, active: true, sold7d: 0, margin7d: 0 },
      { dishId: "f", price: 0, active: false, sold7d: 50, margin7d: 50_000 },
    ];
    expect(classifyMenu(C, { ...s, menu })).toEqual({ a: "star", b: "ploughhorse", c: "puzzle", d: "dog", e: "dog" });
    expect(classifyMenu(C, { ...s, menu: [] })).toEqual({});
  });

  it("is populated from real play", () => {
    const s = playDays(ready(4), 8);
    const q = classifyMenu(C, s);
    expect(Object.keys(q).length).toBe(C.dishes.length);
    expect(Object.values(q)).toContain("star");
  });
});

describe("newGame", () => {
  it("sets up loan, deposit, fit-out, an empty larder and the first goals", () => {
    const s = fresh();
    expect(s).toMatchObject({ version: 1, day: 0, phase: "planning", menu: [], staff: [] });
    expect(s.tables).toHaveLength(C.balance.startingTables);
    expect(s.loan.remaining).toBe(C.balance.loanPrincipal);
    expect(s.cash).toBeLessThan(C.balance.startingCash + C.balance.loanPrincipal - C.balance.fitOutCost);
    expect(s.stock).toEqual([]);
    expect(s.cash).toBe(C.balance.startingCash + C.balance.loanPrincipal - C.balance.fitOutCost - 350_000 * 3); // 3 months' deposit
    expect(s.goals!.every((g) => g.tier === 0 && !g.done)).toBe(true);
    expect(s.ownerFatigue).toBe(0);
    const fallback = newGame(C, { type: "NEW_GAME", seed: 1, districtId: "nowhere", restaurantName: "  ", difficulty: "hard" });
    expect(fallback.districtId).toBe("highstreet");
    expect(fallback.restaurantName).toBe("The Full Plate");
    expect(() => newGame({ ...C, districts: [] }, { type: "NEW_GAME", seed: 1, districtId: "x", restaurantName: "x", difficulty: "normal" })).toThrow();
  });
});

describe("stock", () => {
  it("is FIFO, spoils by shelf life and scores freshness", () => {
    let st = addStock([], "beef", 5, 0);
    st = addStock(st, "beef", 5, 3);
    expect(addStock(st, "beef", 0, 4)).toEqual(st);
    const t = takeStock(st, "beef", 6, 4);
    expect(t.taken).toBe(6);
    expect(t.meanAge).toBeCloseTo((5 * 4 + 1 * 1) / 6);
    expect(t.stock[0]!.batches).toEqual([{ qty: 4, day: 3 }]);
    expect(takeStock(st, "ghost", 1, 0).taken).toBe(0);
    const sp = spoil(C, st, 4); // beef life 4: day-0 batch expires
    expect(sp.binned).toEqual([{ id: "beef", qty: 5, cost: 1600 }]); // no batch cost ⇒ valued at unitCost
    expect(sp.stock[0]!.qty).toBe(5);
    const beef = C.ingredients[0]!;
    expect(freshnessScore(beef, 0, 1)).toBeGreaterThan(freshnessScore(beef, 4, 1));
    expect(freshnessScore(undefined, 0, 1)).toBe(0);
    const fish = C.ingredients[1]!;
    expect(purchaseCost(fish, 10, 6, 1)).toBeLessThan(purchaseCost(fish, 10, 1, 1));
    expect(canPlate([], C.dishes[0]!)).toBe(false);
  });
});

describe("headless", () => {
  it("plays scripted owners and reports", () => {
    const r = playOne(C, 1, 60, STRATEGIES.balanced, "normal");
    expect(r.covers).toHaveLength(60);
    expect(r.monthEndCash).toHaveLength(2);
    const text = summarise([r], 2);
    expect(text).toMatch(/survival: 1\/1/);
    expect(toCsv([r], "balanced", "normal").split("\n")[1]).toMatch(/^1,balanced,normal,true/);
    expect(parseArgs(["--days", "10", "--strategy", "premium"])).toMatchObject({ days: 10, strategy: "premium", seeds: 100 });
    expect(() => parseArgs(["--strategy", "silly"])).toThrow();
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
});
