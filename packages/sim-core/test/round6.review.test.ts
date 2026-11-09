/**
 * Round 6 review: the over-stock tip's one-tap fix (CANCEL_ORDER, which trims tomorrow's pending order) and the
 * rota tip's rest (it lets a due tip through every third losing evening).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { actionWords, adviceSentences, adviceTextOf, eveningAdvice, overOrdered } from "../src/advice";
import { applyCommand, deserialize, newGame, serialize, suggestedOrder } from "../src/index";
import type { DayResult, GameState, Staff } from "../src/types";

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** A real game on its evening with a menu, a fortnight of cod binned, and `codOrdered` portions of cod on order. */
function overstockEvening(codOrdered: number): GameState {
  let g = newGame(content, { type: "NEW_GAME", seed: 7, districtId: "high_street", restaurantName: "Bin", difficulty: "normal" });
  g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: "fish_and_chips", price: 1245 }).state;
  g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: "beef_burger", price: 1245 }).state;
  const history = Array.from({ length: 14 }, (_, day) => ({
    day, covers: 40, walkouts: 0, revenue: 60_000, profit: 2_000, waste: { prep: 0, plate: 0, spoil: 0 }, perChef: {},
    perDish: { fish_and_chips: { sold: 10, plated: 10, qualityMean: 70, revenue: 12_450, foodCost: 4_000 } },
    spoiled: { cod: { qty: 6, cost: 600 } },
  }) as unknown as DayResult);
  g = { ...g, day: 13, phase: "evening", history };
  if (codOrdered) g = applyCommand(content, g, { type: "ORDER_STOCK", ingredientId: "cod", qty: codOrdered }).state;
  return g;
}

describe("CANCEL_ORDER", () => {
  it("takes portions off tomorrow's order, newest line first, and refunds them to the penny", () => {
    let g = overstockEvening(0);
    g = applyCommand(content, g, { type: "ORDER_STOCK", ingredientId: "cod", qty: 10 }).state;
    g = applyCommand(content, g, { type: "ORDER_STOCK", ingredientId: "beef_mince", qty: 5 }).state;
    g = applyCommand(content, g, { type: "ORDER_STOCK", ingredientId: "cod", qty: 7 }).state;
    const [c1, , c2] = g.orders;
    const r = applyCommand(content, g, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 9 });
    expect(r.state.orders.map((o) => [o.ingredientId, o.qty])).toEqual([["cod", 8], ["beef_mince", 5]]);
    // The 7-line went entirely (its full cost back), 2 of the 10-line pro rata.
    const back = c2!.cost + Math.round((c1!.cost * 2) / 10);
    expect(r.state.cash).toBe(g.cash + back);
    expect(r.state.orders[0]!.cost).toBe(c1!.cost - Math.round((c1!.cost * 2) / 10));
    // Cash + money still on order is unchanged: nothing is lost or made.
    const owed = (s: GameState) => s.cash + s.orders.reduce((a, o) => a + o.cost, 0);
    expect(owed(r.state)).toBe(owed(g));
  });

  it("more than is on order cancels all of it; nothing on order, a bad qty or service is refused", () => {
    const g = overstockEvening(12);
    const all = applyCommand(content, g, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 99 }).state;
    expect(all.orders).toEqual([]);
    expect(all.cash).toBe(overstockEvening(0).cash);
    const refused = (s: GameState, cmd: Parameters<typeof applyCommand>[2]) => {
      const r = applyCommand(content, s, cmd);
      return r.state.cash === s.cash && r.state.orders === s.orders && r.events.length === 1 && r.events[0]!.type === "LOG";
    };
    expect(refused(all, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 1 })).toBe(true);
    expect(refused(g, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 0 })).toBe(true);
    expect(refused(g, { type: "CANCEL_ORDER", ingredientId: "unicorn", qty: 1 })).toBe(true);
    expect(refused({ ...g, phase: "service" }, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 1 })).toBe(true);
  });

  it("is pure on a frozen state and the result round-trips through serialize byte-identically", () => {
    const g = deepFreeze(overstockEvening(30));
    const a = applyCommand(content, g, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 11 });
    const b = applyCommand(content, g, { type: "CANCEL_ORDER", ingredientId: "cod", qty: 11 });
    expect(serialize(a.state)).toBe(serialize(b.state));
    expect(serialize(deserialize(serialize(a.state)))).toBe(serialize(a.state));
  });
});

describe("the over-stock tip's one-tap fix", () => {
  it("with cod on order beyond tomorrow's need: one CANCEL_ORDER for the excess, applied tonight, with its own words", () => {
    const g = overstockEvening(60);
    const a = eveningAdvice(g, content)!;
    expect(a.kind).toBe("overstock");
    const without = { ...g, orders: [] };
    const need = suggestedOrder(content, without).find((l) => l.ingredientId === "cod")?.qty ?? 0;
    expect(need).toBeLessThan(60);
    expect(a.commands).toEqual([{ type: "CANCEL_ORDER", ingredientId: "cod", qty: 60 - need }]);
    expect(a.now).toBe(true);
    expect(adviceSentences(a, content).action).toBe(`Take ${60 - need} cod fillet off tomorrow's order`);
    // After the tap the order is exactly what tomorrow needs, and the tip goes back to a deep link.
    const after = applyCommand(content, g, a.commands[0]!).state;
    expect(after.orders.reduce((n, o) => n + (o.ingredientId === "cod" ? o.qty : 0), 0)).toBe(need);
    expect(overOrdered(content, after, "cod")).toBe(0);
    const again = eveningAdvice(after, content)!;
    expect(again.commands).toEqual([]);
    expect(again.now).toBeUndefined();
    expect(adviceSentences(again, content).action).toBe("Check the larder");
  });

  it("nothing on order: the larder deep link, as before; the words come from the content pack", () => {
    const a = eveningAdvice(overstockEvening(0), content)!;
    expect(a.commands).toEqual([]);
    expect(actionWords(a, adviceTextOf(content, "overstock"))).toBe("Check the larder");
  });
});

// ── the rota tip rests: every ROTA_REST_EVERY-th losing evening a due tip gets through ──
describe("the rota tip lets another tip through", () => {
  const FIRST = [false, false, true, true, true, true, true];
  const COVER_WEEKEND = [true, true, false, false, true, true, true];
  const person = (id: string, rota: boolean[]) => ({ id, name: id.toUpperCase(), role: "chef", rota, wage: 1300 }) as Staff;
  const day = (i: number): DayResult => ({
    day: i, covers: 40, walkouts: 0, revenue: 50_000, profit: -3_000, waste: { prep: 0, plate: 0, spoil: 0 }, perChef: {},
    perDish: { fish_and_chips: { sold: 10, plated: 10, qualityMean: 70, revenue: 12_450, foodCost: 4_000 } },
    spoiled: { cod: { qty: 6, cost: 600 } },
  }) as unknown as DayResult;
  const at = (n: number, adviceLog?: GameState["adviceLog"]) => ({
    history: Array.from({ length: n }, (_, i) => day(i)),
    staff: [person("c1", FIRST), person("c2", COVER_WEEKEND)],
    menu: [{ dishId: "fish_and_chips", price: 1245, active: true, sold7d: 0, margin7d: 0 }],
    reputation: { popularity: 50, prestige: 20 }, day: n - 1, ...(adviceLog ? { adviceLog } : {}),
  });

  it("two losing evenings of rota, then the over-stock tip; the rota tip again the next evening", () => {
    // Rota shown on the two evenings before tonight: tonight the due over-stock tip gets its turn.
    expect(eveningAdvice(at(16, { rota: { day: 14, count: 2, subject: "c2" } }), content)!.kind).toBe("overstock");
    // Rota shown only last night (the streak is one): rota again.
    expect(eveningAdvice(at(16, { rota: { day: 14, count: 1, subject: "c2" } }), content)!.kind).toBe("rota");
    // The over-stock tip was shown last night (it rests 7 days): rota, whatever the streak.
    expect(eveningAdvice(at(16, { rota: { day: 13, count: 2, subject: "c2" }, overstock: { day: 14, count: 1, subject: "cod" } }), content)!.kind).toBe("rota");
  });
});

// ── purity: sim-core had only a run-time Math.random/Date trap; scan every source file too (advice.ts included) ──
describe("purity (sim-core sources)", () => {
  /** Every .ts under src/ (recursively) except the headless CLI, which times itself. */
  function sources(dir = fileURLToPath(new URL("../src", import.meta.url)), rel = ""): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      if (statSync(p).isDirectory()) return sources(p, `${rel}${f}/`);
      return f.endsWith(".ts") && f !== "headless.ts" ? [`${rel}${f}`] : [];
    });
  }

  it("never read the clock or Math.random (advice, strategies and the systems included)", () => {
    const files = sources();
    expect(files).toEqual(expect.arrayContaining(["advice.ts", "strategies.ts", "commands.ts", "systems/waste.ts", "systems/kitchen.ts"]));
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(`${root}/${f}`, "utf8").split("\n").forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (/Math\.random|Date\.now|new Date\b|performance\.now/.test(code)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("eveningAdvice and the over-stock trim are pure on deep-frozen real states", () => {
    const g = deepFreeze(overstockEvening(60));
    const a = eveningAdvice(g, content);
    expect(eveningAdvice(g, content)).toEqual(a);
    expect(() => applyCommand(content, g, a!.commands[0]!)).not.toThrow();
  });
});
