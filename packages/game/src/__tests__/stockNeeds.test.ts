import { describe, expect, it } from "vitest";
import { appReducer, initialAppState } from "../state/gameReducer";
import { content, SERVICE_TICKS, suggestedOrder } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { restockLines, stockNeeds } from "../screens/planning/stockNeeds";

describe("stock forecast (sim-core suggestedOrder / forecastNeeds)", () => {
  it("still orders for dishes that were 86'd today (the evening restock case)", () => {
    let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 9, districtId: content.districts[0]!.id, restaurantName: "T", difficulty: "normal" } });
    for (const d of suggestedStarterMenu(content, s.game!)) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice } });
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    const dish = s.game!.menu[0]!.dishId;
    s = appReducer(s, { type: "command", cmd: { type: "EIGHTY_SIX", dishId: dish } });
    while (s.game!.phase === "service") s = appReducer(s, { type: "ticks", n: SERVICE_TICKS });
    const g = s.game!;
    expect(g.eightySixed).toContain(dish);
    const ings = content.dishes.find((d) => d.id === dish)!.ingredients.map((i) => i.id);
    const needs = stockNeeds(content, g);
    expect(needs.filter((n) => ings.includes(n.ingredientId)).every((n) => n.need > 0)).toBe(true);
    // An empty larder means the restock covers every ingredient the dish needs.
    const gap = Object.fromEntries(restockLines({ ...g, stock: [] }));
    for (const id of ings) expect(gap[id]).toBeGreaterThan(0);
  });

  it("the Stock tab's 'needed' column agrees with suggestedOrder (order = need − on hand − incoming, in 5s)", () => {
    let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 3, districtId: content.districts[1]!.id, restaurantName: "T", difficulty: "normal" } });
    for (const d of suggestedStarterMenu(content, s.game!)) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice } });
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    while (s.game!.phase === "service") s = appReducer(s, { type: "ticks", n: SERVICE_TICKS });
    const g = s.game!;
    const order = new Map(suggestedOrder(content, g).map((l) => [l.ingredientId, l.qty]));
    for (const n of stockNeeds(content, g)) {
      const gap = n.need - n.onHand - n.incoming;
      expect(order.get(n.ingredientId) ?? 0).toBe(gap > 0 ? Math.ceil(gap / 5) * 5 : 0);
    }
  });
});
