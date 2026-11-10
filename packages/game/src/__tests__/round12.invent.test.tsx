/**
 * Round 12 (F): invent a dish — the reducer, the pack sync, the cookbook, the Evening's line, saves, and the sheet.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makeCustomDish, NEW_DISH_REVIEWS, type CustomDishDraft } from "@full-plate/content";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { content, customRef, serialize, suggestedOrder, syncCustomDishes } from "../sim";
import { encodeSave } from "../state/save";
import { checkedDecode, DAMAGED, tryDecode } from "../state/saveCheck";
import { Evening } from "../screens/Evening";
import { MenuTab } from "../screens/planning/MenuTab";
import type { CustomDish } from "../lib/customDish";

afterEach(cleanup);
const noop = () => {};

const RISOTTO: CustomDishDraft = { name: "Midnight risotto", course: "main", icon: "🍲", ingredients: [{ id: "rice", qty: 1.5 }, { id: "mushrooms", qty: 2 }, { id: "parmesan", qty: 1 }, { id: "butter", qty: 1 }] };
const SILLY: CustomDishDraft = { name: "The Big Spender", course: "main", icon: "🥩", ingredients: ["beef_steak", "scallops", "duck_breast", "lamb", "asparagus"].map((id) => ({ id, qty: 3 })) };

function newOwner(seed = 11): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "Test Kitchen", difficulty: "normal" } });
  for (const id of ["margherita", "fish_and_chips", "chunky_chips", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  return s;
}

/** What the Cookbook strip does: invent, then add it to the menu at her price. */
function invent(s: AppState, draft: CustomDishDraft, price?: number): { s: AppState; dish: CustomDish } {
  const made = makeCustomDish(s.meta.customDishes ?? [], s.game!.seed, s.game!.day, draft, customRef);
  if ("error" in made) throw new Error(made.error);
  let next = appReducer(s, { type: "invent", dish: made.dish });
  const def = content.dishes.find((d) => d.id === made.dish.id)!;
  next = appReducer(next, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: made.dish.id, price: price ?? def.suggestedPrice } });
  return { s: next, dish: made.dish };
}

/** Order stock, open, skip the shift, answer any card, next day. */
function day(s: AppState): AppState {
  for (const o of suggestedOrder(content, s.game!)) s = appReducer(s, { type: "command", cmd: { type: "ORDER_STOCK", ...o } });
  s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
  if (s.game!.phase === "service") s = appReducer(s, { type: "skipShift" });
  return s;
}
function next(s: AppState): AppState {
  if (s.game!.phase === "event") {
    const ev = content.events.find((e) => e.id === s.game!.activeEvent?.eventId)!;
    return appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: ev.choices[0]!.id } });
  }
  return appReducer(s, { type: "nextDay" });
}

describe("inventing a dish (reducer + pack)", () => {
  it("puts the dish in the cookbook and the pack; the sim adds it, cooks it and sells it", () => {
    let { s, dish } = invent(newOwner(), RISOTTO);
    expect(s.meta.customDishes).toHaveLength(1);
    expect(dish.id).toMatch(/^custom:/);
    expect(content.dishes.some((d) => d.id === dish.id)).toBe(true);
    expect(s.game!.menu.some((m) => m.dishId === dish.id)).toBe(true);
    let firstNight = -1;
    for (let i = 0; i < 6 && firstNight < 0; i++) {
      s = day(s);
      const c = s.meta.customDishes![0]!;
      if (c.firstSoldDay !== undefined) firstNight = c.firstSoldDay;
      else s = next(s);
    }
    expect(firstNight).toBeGreaterThanOrEqual(0);
    const c = s.meta.customDishes![0]!;
    const result = s.game!.history.at(-1)!;
    expect(c.sold).toBe(result.perDish![dish.id]!.sold);
    // Evening: one review line names it, the first night only.
    render(<Evening game={s.game!} result={result} onNext={noop} nextLabel="Next" send={noop} meta={s.meta} />);
    const lines = NEW_DISH_REVIEWS.map((t) => `“${t.replaceAll("{dish}", dish.name).replaceAll("{restaurant}", "Test Kitchen")}”`);
    const shown = [...document.querySelectorAll(".review__text")].map((e) => e.textContent);
    expect(shown.filter((t) => lines.includes(t ?? ""))).toHaveLength(1);
    cleanup();
    s = day(next(s));
    const later = s.game!.history.at(-1)!;
    render(<Evening game={s.game!} result={later} onNext={noop} nextLabel="Next" send={noop} meta={s.meta} />);
    expect([...document.querySelectorAll(".review__text")].filter((e) => lines.includes(e.textContent ?? ""))).toHaveLength(0);
    expect(s.meta.customDishes![0]!.sold).toBeGreaterThanOrEqual(c.sold);
  });

  it("refuses an invent outside planning, in a career, or past twelve; a duplicate name is refused", () => {
    let s = newOwner();
    s = day(s); // evening
    const made = makeCustomDish([], s.game!.seed, s.game!.day, RISOTTO, customRef);
    expect(appReducer(s, { type: "invent", dish: (made as { dish: CustomDish }).dish })).toBe(s);
    const career = appReducer(initialAppState, { type: "newCareer", seed: 3, track: "chef", strategy: "balanced", playerName: "Robin", difficulty: "cosy", districtId: "high_street", look: 1 });
    const m2 = makeCustomDish([], 3, 0, RISOTTO, customRef);
    expect(appReducer(career, { type: "invent", dish: (m2 as { dish: CustomDish }).dish })).toBe(career);
    let o = newOwner();
    o = invent(o, RISOTTO).s;
    expect(makeCustomDish(o.meta.customDishes!, o.game!.seed, o.game!.day, { ...RISOTTO, name: "midnight RISOTTO" }, customRef)).toHaveProperty("error");
  });

  it("is deterministic: the same seed and the same inventions give the same game", () => {
    const run = () => {
      let { s } = invent(newOwner(5), RISOTTO);
      s = invent(s, SILLY, 25000).s;
      for (let i = 0; i < 3; i++) s = next(day(s));
      return serialize(s.game!) + JSON.stringify(s.meta.customDishes);
    };
    expect(run()).toBe(run());
  });

  it("an absurdly expensive dish is no money printer", () => {
    let { s, dish } = invent(newOwner(9), SILLY);
    const def = content.dishes.find((d) => d.id === dish.id)!;
    expect(def.suggestedPrice).toBeGreaterThan(10_000);
    for (let i = 0; i < 4; i++) s = next(day(s));
    const sold = s.meta.customDishes![0]!.sold;
    const plain = s.game!.history.reduce((a, h) => a + (h.perDish?.margherita?.sold ?? 0), 0);
    expect(sold).toBeLessThan(plain);
  });
});

describe("saves carry the cookbook", () => {
  it("export → import in a fresh profile: the dishes are there and cook", () => {
    let { s, dish } = invent(newOwner(21), RISOTTO);
    s = next(day(s));
    const raw = encodeSave(s.game!, s.meta);
    // a fresh profile: nothing invented in the pack
    syncCustomDishes(undefined);
    expect(content.dishes.some((d) => d.id === dish.id)).toBe(false);
    const loaded = checkedDecode(raw);
    expect(loaded.meta.customDishes?.map((d) => d.name)).toEqual(["Midnight risotto"]);
    let t = appReducer({ ...initialAppState }, { type: "load", game: loaded.game, meta: loaded.meta });
    expect(content.dishes.some((d) => d.id === dish.id)).toBe(true);
    t = day(t);
    expect(t.game!.history.at(-1)!.day).toBe(s.game!.day);
    expect(encodeSave(t.game!, t.meta)).toContain(dish.id);
  });

  it("the save check cleans names, and refuses broken recipes and menus naming unknown inventions", () => {
    const { s, dish } = invent(newOwner(22), RISOTTO);
    const env = JSON.parse(encodeSave(s.game!, s.meta));
    const withDish = (d: unknown) => JSON.stringify({ ...env, meta: { ...env.meta, customDishes: [d] } });
    const cleaned = checkedDecode(withDish({ ...dish, name: "Midnight‮ risotto" }));
    expect(cleaned.meta.customDishes![0]!.name).toBe("Midnight risotto");
    for (const bad of [
      { ...dish, ingredients: [{ id: "unobtainium", qty: 1 }, { id: "rice", qty: 1 }] },
      { ...dish, ingredients: [{ id: "rice", qty: 1 }] },
      { ...dish, ingredients: [{ id: "rice", qty: 50 }, { id: "mushrooms", qty: 1 }] },
      { ...dish, id: "tomato_soup" },
      { ...dish, icon: "<img>" },
      { ...dish, sold: -4 },
    ]) expect(tryDecode(withDish(bad)), JSON.stringify(bad).slice(0, 80)).toBeNull();
    // the menu names an invented dish the cookbook doesn't have
    const orphan = JSON.stringify({ ...env, meta: { ...env.meta, customDishes: [] } });
    expect(() => checkedDecode(orphan)).toThrow();
    expect(tryDecode(JSON.stringify({ ...env, meta: { ...env.meta, customDishes: Array.from({ length: 13 }, () => dish) } }))).toBeNull();
    expect(DAMAGED).toMatch(/damaged/);
  });
});

describe("the Menu tab", () => {
  it("has Invent a dish; the sheet shows cost, suggested price, skill and the sell guess, and hands back a recipe", async () => {
    const s = newOwner(31);
    const got: CustomDish[] = [];
    const sent: unknown[] = [];
    render(<MenuTab game={s.game!} send={(c) => sent.push(c)} meta={s.meta} onInvent={(d) => got.push(d)} />);
    fireEvent.click(await screen.findByRole("button", { name: /Invent a dish/ }, { timeout: 15000 }));
    const dlg = await screen.findByRole("dialog", { name: "Invent a dish" }, { timeout: 15000 });
    const put = within(dlg).getByRole("button", { name: "Put it on the menu" }) as HTMLButtonElement;
    expect(put.disabled).toBe(true);
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "Midnight‮ risotto" } });
    const pick = within(dlg).getByRole("combobox", { name: "Ingredient to add" });
    for (const id of ["rice", "mushrooms", "parmesan"]) {
      fireEvent.change(pick, { target: { value: id } });
      fireEvent.click(within(dlg).getByRole("button", { name: "Add" }));
    }
    expect(within(dlg).getByText("Suggested price")).toBeTruthy();
    expect(within(dlg).getByText("Skill needed")).toBeTruthy();
    expect(within(dlg).getByText(/Likely a favourite|Should sell steadily|A slow seller|A hard sell/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "stew pot" }));
    expect(put.disabled).toBe(false);
    fireEvent.click(put);
    await waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]!.name).toBe("Midnight risotto");
    expect(got[0]!.ingredients.map((x) => x.id)).toEqual(["rice", "mushrooms", "parmesan"]);
    expect(sent).toEqual([expect.objectContaining({ type: "ADD_MENU_ITEM", dishId: got[0]!.id })]);
  });

  it("shows the cookbook with lifetime sales once a dish is invented", async () => {
    let { s, dish } = invent(newOwner(32), RISOTTO);
    s = { ...s, meta: { ...s.meta, customDishes: [{ ...s.meta.customDishes![0]!, sold: 37 }] } };
    render(<MenuTab game={s.game!} send={noop} meta={s.meta} onInvent={noop} />);
    const card = await screen.findByTestId("cookbook-card", {}, { timeout: 15000 });
    expect(within(card).getByText(dish.name)).toBeTruthy();
    expect(within(card).getByText("37")).toBeTruthy();
    expect(within(card).getByText("On the menu")).toBeTruthy();
    // the menu row shows the plate she chose, not the course icon
    expect(screen.getAllByText("🍲").length).toBeGreaterThan(0);
  });
});
