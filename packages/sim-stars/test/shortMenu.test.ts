/**
 * Round 3 review P1: forgetting to restock in inspection season emptied the menu (4–6 dishes 86'd, then 0 covers),
 * and the Stars layer didn't notice: a short menu cooked fine plates, and a 0-cover night went in as a day off.
 * Now ≥ SHORT_MENU_MIN_86 food dishes 86'd is an off night in the consistency window, with a named reason.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "@full-plate/sim-core";
import { closedDay, inSeason, starsView, stepStarsDay, STARS_CONSTANTS as C } from "../src";
import { pulledFoodDishes } from "../src/proxies";
import { content, dayResult, eveningState, fresh, run } from "./helpers";

const MENU = ["duck_breast", "lamb_shoulder", "scallops_pea", "flat_white"];

/**
 * An evening state with MENU active (each usually sells 10 a night), `pulled` on today's 86 list and plating only
 * `platedPulled` each tonight; the other food dishes plate 20 at `quality`.
 */
function shortEvening(day: number, quality: number, pulled: string[], platedPulled = 1): GameState {
  const food = MENU.filter((id) => id !== "flat_white");
  const dishes = Object.fromEntries(food.map((id) => [id, pulled.includes(id) ? platedPulled : 20]).filter(([, n]) => (n as number) > 0));
  const base = eveningState(day, quality, dishes);
  const recent = Array.from({ length: 7 }, () => ({ sold: 10, margin: 0 }));
  return { ...base, menu: MENU.map((dishId) => ({ dishId, price: 3000, active: true, sold7d: 70, margin7d: 0, recent })), eightySixed: pulled };
}

describe("short menu → consistency hit", () => {
  it("counts only active food dishes on today's 86 list that were off for most of the night", () => {
    const st = shortEvening(400, 90, ["duck_breast", "flat_white", "not_on_menu"]);
    expect(pulledFoodDishes(content, st, 400)).toEqual(["duck_breast"]);
    // Sold out late on a busy night (plated 6 of a usual 10 ≥ half): not off.
    expect(pulledFoodDishes(content, shortEvening(400, 90, ["duck_breast"], 6), 400)).toEqual([]);
    // No history: off only if nothing at all was plated.
    const fresh0 = shortEvening(400, 90, ["duck_breast", "lamb_shoulder"], 0);
    const noHistory = { ...fresh0, menu: fresh0.menu.map((m) => ({ ...m, sold7d: 0, recent: [] })) };
    expect(pulledFoodDishes(content, noHistory, 400)).toEqual(["duck_breast", "lamb_shoulder"].sort((a, b) => content.dishes.findIndex((d) => d.id === a) - content.dishes.findIndex((d) => d.id === b)));
    expect(pulledFoodDishes(content, st, 401)).toEqual([]); // a different day's state says nothing
    expect(pulledFoodDishes(content, undefined, 400)).toEqual([]);
  });

  it("three food dishes off is an off night with a named reason; two is not", () => {
    const warm = run(fresh(365), 365, 20, 90).stars;
    const two = stepStarsDay(content, warm, dayResult(385), shortEvening(385, 90, ["duck_breast", "lamb_shoulder"]));
    expect(two.stars.consistencyWindow.at(-1)).toBe(90);
    expect(two.events.some((e) => e.type === "SHORT_MENU")).toBe(false);

    const three = stepStarsDay(content, warm, dayResult(385), shortEvening(385, 90, ["duck_breast", "lamb_shoulder", "scallops_pea"]));
    expect(three.stars.consistencyWindow.at(-1)).toBe(90 - 3 * C.SHORT_MENU_DROP_PER_DISH);
    const ev = three.events.find((e) => e.type === "SHORT_MENU");
    expect(ev && ev.type === "SHORT_MENU" && [...ev.dishIds].sort()).toEqual(["duck_breast", "lamb_shoulder", "scallops_pea"]);
    expect(ev && ev.type === "SHORT_MENU" && ev.text).toMatch(/3 dishes were off \(.+ and .+\)/);
    expect(three.events.some((e) => e.type === "LOG" && e.tone === "bad" && /short menu/i.test(e.text))).toBe(true);
    expect(starsView(three.stars, 386).steadiness).toBeLessThan(starsView(two.stars, 386).steadiness);
  });

  it("a night that ran out of everything is a failed service, not a day off", () => {
    const warm = run(fresh(365), 365, 20, 90).stars;
    const all = ["duck_breast", "lamb_shoulder", "scallops_pea"];
    const r = stepStarsDay(content, warm, { ...closedDay(385), covers: 0 }, shortEvening(385, 0, all, 0));
    expect(r.stars.consistencyWindow.length).toBe(warm.consistencyWindow.length + 1);
    expect(r.stars.consistencyWindow.at(-1)).toBe(90 - 3 * C.SHORT_MENU_DROP_PER_DISH);
    expect(r.stars.assessment.openDays).toBe(warm.assessment.openDays); // the Fat Duck count is open services only
    expect(r.events.find((e) => e.type === "SHORT_MENU" && /Nothing left to cook/.test(e.text))).toBeTruthy();
  });

  it("a CLOSE_TODAY night never takes the hit, whatever is on the 86 list", () => {
    const warm = run(fresh(365), 365, 20, 90).stars;
    const r = stepStarsDay(content, warm, { ...closedDay(385), closed: true }, shortEvening(385, 0, ["duck_breast", "lamb_shoulder", "scallops_pea"], 0));
    expect(r.stars.consistencyWindow).toEqual(warm.consistencyWindow);
    expect(r.events.some((e) => e.type === "SHORT_MENU")).toBe(false);
  });

  it("says so louder in inspection season", () => {
    const s0 = fresh(365);
    const g = s0.guides.michelin.nextGuideDay;
    const day = g - 30;
    const warm = run(s0, day - 15, 15, 90).stars;
    expect(inSeason(warm, day)).toBe(true);
    const r = stepStarsDay(content, warm, dayResult(day), shortEvening(day, 90, ["duck_breast", "lamb_shoulder", "scallops_pea"]));
    const ev = r.events.find((e) => e.type === "SHORT_MENU");
    expect(ev && ev.type === "SHORT_MENU" && ev.inspectionSeason).toBe(true);
    expect(ev && ev.type === "SHORT_MENU" && ev.text).toMatch(/inspection season/);
  });

  it("is deterministic and does not touch the RNG stream", () => {
    const warm = run(fresh(365), 365, 20, 90).stars;
    const st = shortEvening(385, 90, ["duck_breast", "lamb_shoulder", "scallops_pea"]);
    const a = stepStarsDay(content, warm, dayResult(385), st);
    const b = stepStarsDay(content, warm, dayResult(385), st);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plain = stepStarsDay(content, warm, dayResult(385), shortEvening(385, 90, []));
    expect(a.stars.rngState).toEqual(plain.stars.rngState);
  });
});
