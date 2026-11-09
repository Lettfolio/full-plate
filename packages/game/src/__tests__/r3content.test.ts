import { describe, expect, it } from "vitest";
import { content, deserialize, inLibrary, newGame, serialize, applyCommand } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { dishUnlocked, recipeBook } from "../lib/library";

const fresh = () => newGame(content, { type: "NEW_GAME", seed: 9, districtId: "business_park", restaurantName: "Lib", difficulty: "normal" });

describe("round 3 content", () => {
  it("cooks with the full pack, so a save naming path dishes round-trips", () => {
    expect(content.dishes.some((d) => d.id.startsWith("ff_"))).toBe(true);
    expect(content.dishes.some((d) => d.id.startsWith("fd_"))).toBe(true);
    let g = fresh();
    g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: "ff_classic_stacker", price: 499 }).state;
    expect(g.menu.map((m) => m.dishId)).toContain("ff_classic_stacker");
    expect(deserialize(serialize(g)).menu).toEqual(g.menu);
  });

  it("the suggested starter menu only uses library dishes", () => {
    for (const d of content.districts) {
      const g = newGame(content, { type: "NEW_GAME", seed: 1, districtId: d.id, restaurantName: "x", difficulty: "normal" });
      const picks = suggestedStarterMenu(content, g);
      expect(picks.length).toBe(7);
      expect(picks.every((p) => inLibrary(p.id))).toBe(true);
    }
  });

  it("path dishes appear in the recipe book only after the matching fork", () => {
    expect(recipeBook(content, undefined).every((d) => inLibrary(d.id))).toBe(true);
    expect(dishUnlocked("ff_classic_stacker", "empire")).toBe(true);
    expect(dishUnlocked("ff_classic_stacker", "stars")).toBe(false);
    expect(recipeBook(content, "stars").some((d) => d.id.startsWith("fd_"))).toBe(true);
    expect(recipeBook(content, "stars").some((d) => d.id.startsWith("ff_"))).toBe(false);
  });
});
