import { describe, expect, it } from "vitest";
import { appReducer, initialAppState } from "../state/gameReducer";
import { content, SERVICE_TICKS } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { shortfall, stockNeeds } from "../screens/planning/stockNeeds";

describe("stock forecast", () => {
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
    // An empty larder means the shortfall covers every ingredient the dish needs.
    const empty = { ...g, stock: [] };
    const gap = shortfall(stockNeeds(content, empty));
    for (const id of ings) expect(gap[id]).toBeGreaterThan(0);
  });
});
