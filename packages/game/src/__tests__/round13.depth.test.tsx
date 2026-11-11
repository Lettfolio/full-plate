/**
 * Round 13 (D): depth for what Round 12 added — the cookbook's edits (versions, rest, delete, order) through the reducer
 * and the strip; the Empire formula picker; the Stars refine and the guide envelope; the regulars' memo past day 400;
 * the visited room in the owner's brand; the house brand on MyShift and the challenge; regular of the month and the
 * thank-you notes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { liveDishes, makeCustomDish, olderVersions, REFINE_PROSE, REFINE_SUFFIXES, type CustomDishDraft } from "@full-plate/content";
import { loadVoices, THANKS_MIN } from "@full-plate/content/voices";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { content, customRef, runStrategyDay, serialize, STRATEGIES, suggestedOrder } from "../sim";
import { encodeSave } from "../state/save";
import { checkedDecode, tryDecode } from "../state/saveCheck";
import { FORK_DAY, initialMeta, type PathMeta } from "../state/paths";
import { autosaveKey } from "../state/useSaves";
import CookbookStrip from "../screens/planning/CookbookStrip";
import { FormulaPicker } from "../screens/paths/FormulaPicker";
import { RefineCard } from "../screens/paths/RefineCard";
import { refinedOnInspection } from "../screens/paths/GuideEnvelope";
import { seasonOf } from "../lib/calendar";
import { regularOfMonth, regularsFrom, storyOf, thanksNote } from "../lib/regulars";
import { memoFrom } from "../lib/voicesMemo";
import { clipFrom, clippingDay, weekScores } from "../lib/rival";
import { visitBrand, visitLook } from "../screens/VisitRoom";
import { HouseBrandCard } from "../components/HouseBrandCard";
import { defaultBrand, encodeBrand, resolveBrand } from "../lib/brand";
import type { CustomDish } from "../lib/customDish";

afterEach(cleanup);
const noop = () => {};

const PIE: CustomDishDraft = { name: "Cottage pie deluxe", course: "main", icon: "🥧", ingredients: [{ id: "potatoes", qty: 2 }, { id: "cheddar", qty: 1 }, { id: "onions", qty: 1 }] };
const STEW: CustomDishDraft = { name: "Harbour stew", course: "main", icon: "🍲", ingredients: [{ id: "potatoes", qty: 1 }, { id: "onions", qty: 1 }] };

function newOwner(seed = 13): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "Depth Kitchen", difficulty: "normal" } });
  for (const id of ["margherita", "fish_and_chips", "chunky_chips", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  return s;
}
function invent(s: AppState, draft: CustomDishDraft, onMenu = true): { s: AppState; dish: CustomDish } {
  const made = makeCustomDish(s.meta.customDishes ?? [], s.game!.seed, s.game!.day, draft, customRef);
  if ("error" in made) throw new Error(made.error);
  let next = appReducer(s, { type: "invent", dish: made.dish });
  if (onMenu) next = appReducer(next, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: made.dish.id, price: content.dishes.find((d) => d.id === made.dish.id)!.suggestedPrice } });
  return { s: next, dish: made.dish };
}
function day(s: AppState): AppState {
  for (const o of suggestedOrder(content, s.game!)) s = appReducer(s, { type: "command", cmd: { type: "ORDER_STOCK", ...o } });
  s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
  if (s.game!.phase === "service") s = appReducer(s, { type: "skipShift" });
  if (s.game!.phase === "event") {
    const ev = content.events.find((e) => e.id === s.game!.activeEvent?.eventId)!;
    s = appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: ev.choices[0]!.id } });
  }
  return s.game!.phase === "evening" ? appReducer(s, { type: "nextDay" }) : s;
}
const roundTrip = (s: AppState) => checkedDecode(encodeSave(s.game!, s.meta));

describe("cookbook edits through the reducer", () => {
  it("rename + price on today's menu, then new ingredients → v2 on the menu, v1 keeps its sales; saves and loads", () => {
    let { s, dish } = invent(newOwner(), PIE);
    s = day(s); s = day(s);
    const sold = s.meta.customDishes![0]!.sold;
    const k0 = autosaveKey(s.game!, s.meta);
    s = appReducer(s, { type: "cookbook", op: { op: "edit", id: dish.id, name: "Cottage pie royale", price: 1495 } });
    expect(s.meta.customDishes![0]!.name).toBe("Cottage pie royale");
    expect(s.game!.menu.find((m) => m.dishId === dish.id)!.price).toBe(1495);
    expect(content.dishes.find((d) => d.id === dish.id)!.name).toBe("Cottage pie royale");
    expect(autosaveKey(s.game!, s.meta)).not.toBe(k0);
    s = appReducer(s, { type: "cookbook", op: { op: "edit", id: dish.id, ingredients: [...PIE.ingredients, { id: "leeks", qty: 1 }] } });
    const [v1, v2] = s.meta.customDishes!;
    expect(v1).toMatchObject({ id: dish.id, name: "Cottage pie royale v1", sold, oldOf: v2!.id });
    expect(v2).toMatchObject({ name: "Cottage pie royale", v: 2, sold: 0, price: 1495 });
    expect(s.game!.menu.some((m) => m.dishId === dish.id)).toBe(false);
    expect(s.game!.menu.find((m) => m.dishId === v2!.id)!.price).toBe(1495);
    expect(s.toast?.text).toContain(`keeps its ${sold} sold`);
    s = day(s);
    expect(s.meta.customDishes![0]!.sold).toBe(sold);
    const back = roundTrip(s);
    expect(back.meta.customDishes).toEqual(s.meta.customDishes);
    expect(olderVersions(back.meta, v2!.id).map((d) => d.name)).toEqual(["Cottage pie royale v1"]);
  });

  it("rest takes it off the menu; delete is refused while it's on the menu, then hides it; order and saves hold", () => {
    let { s, dish: pie } = invent(newOwner(14), PIE);
    let stew: CustomDish;
    ({ s, dish: stew } = invent(s, STEW, false));
    s = appReducer(s, { type: "cookbook", op: { op: "delete", id: pie.id } });
    expect(s.toast?.tone).toBe("bad");
    expect(s.meta.customDishes!.find((d) => d.id === pie.id)!.deleted).toBeUndefined();
    s = appReducer(s, { type: "cookbook", op: { op: "rest", id: pie.id, resting: true } });
    expect(s.game!.menu.some((m) => m.dishId === pie.id)).toBe(false);
    expect(s.meta.customDishes!.find((d) => d.id === pie.id)!.resting).toBe(true);
    s = appReducer(s, { type: "cookbook", op: { op: "move", id: stew.id, by: -1 } });
    expect(liveDishes(s.meta).map((d) => d.id)).toEqual([stew.id, pie.id]);
    s = appReducer(s, { type: "cookbook", op: { op: "delete", id: pie.id } });
    expect(liveDishes(s.meta).map((d) => d.id)).toEqual([stew.id]);
    expect(content.dishes.some((d) => d.id === pie.id)).toBe(true); // still in the pack for old history
    const back = roundTrip(s);
    expect(back.meta.cookbookOrder).toEqual([stew.id]);
    expect(back.meta.customDishes!.find((d) => d.id === pie.id)!.deleted).toBe(true);
  });

  it("only in planning", () => {
    const { s, dish } = invent(newOwner(15), PIE);
    const served = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    expect(served.game!.phase).toBe("service");
    expect(appReducer(served, { type: "cookbook", op: { op: "rest", id: dish.id, resting: true } })).toBe(served);
  });

  it("the save check covers every new field", () => {
    const { s } = invent(newOwner(16), PIE);
    const enc = (meta: PathMeta) => encodeSave(s.game!, meta);
    const d = s.meta.customDishes![0]!;
    const good = { ...s.meta, customDishes: [{ ...d, price: 1200, resting: true, refined: { season: 2, suffix: 1, prose: 2 } }], cookbookOrder: [d.id, "custom:nothere"], cookbookRev: 3 };
    const ok = tryDecode(enc(good))!;
    expect(ok.meta.cookbookOrder).toEqual([d.id]);
    expect(ok.meta.customDishes![0]!.refined).toEqual({ season: 2, suffix: 1, prose: 2 });
    for (const bad of [
      { ...s.meta, customDishes: [{ ...d, refined: { season: 2, suffix: REFINE_SUFFIXES.length, prose: 0 } }] },
      { ...s.meta, customDishes: [{ ...d, refined: { season: 2, suffix: 0, prose: REFINE_PROSE.length } }] },
      { ...s.meta, customDishes: [{ ...d, price: 3 }] },
      { ...s.meta, customDishes: [{ ...d, oldOf: "custom:nothere1" }] },
      { ...s.meta, customDishes: [{ ...d, v: 1 }] },
      { ...s.meta, cookbookRev: -1 },
      { ...s.meta, voices: { v: 1, seed: 1, day: 3, regs: [{ id: "x", done: [[0, 1, 2]] }] } },
      { ...s.meta, voices: { v: 2, seed: 1, day: 3, regs: [] } },
    ]) expect(tryDecode(enc(bad as PathMeta))).toBeNull();
    // thirteen live recipes is too many; twelve live plus old versions is fine
    const many = Array.from({ length: 13 }, (_, i) => (i === 0 ? d : { ...d, id: `custom:aaaa${String(i).padStart(4, "0")}`, name: `Dish ${i}` }));
    expect(tryDecode(enc({ ...s.meta, customDishes: many }))).toBeNull();
    const archived = many.map((x, i) => (i === 12 ? { ...x, deleted: true } : x));
    expect(() => checkedDecode(enc({ ...s.meta, customDishes: archived }))).not.toThrow();
  });
});

describe("the cookbook strip", () => {
  it("edit opens the sheet in edit mode; delete asks first, or says where it's in use; move buttons", async () => {
    let { s, dish: pie } = invent(newOwner(17), PIE);
    let stew: CustomDish;
    ({ s, dish: stew } = invent(s, STEW, false));
    const ops: unknown[] = [];
    render(<CookbookStrip meta={s.meta} game={s.game!} send={noop} onInvent={noop} onCookbook={(o) => ops.push(o)} />);
    const cards = screen.getAllByTestId("cookbook-card");
    expect(cards).toHaveLength(2);
    fireEvent.click(within(cards[0]!).getByRole("button", { name: `Delete ${pie.name}` }));
    expect(within(cards[0]!).getByText(/on today's menu: take it off there first/)).toBeTruthy();
    fireEvent.click(within(cards[1]!).getByRole("button", { name: `Delete ${stew.name}` }));
    fireEvent.click(within(cards[1]!).getByRole("button", { name: "Delete" }));
    expect(ops).toEqual([{ op: "delete", id: stew.id }]);
    fireEvent.click(within(cards[1]!).getByRole("button", { name: `Move ${stew.name} earlier` }));
    expect((within(cards[0]!).getByRole("button", { name: `Move ${pie.name} earlier` }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(cards[0]!).getByRole("button", { name: `Rest ${pie.name}` }));
    expect(ops.slice(1)).toEqual([{ op: "move", id: stew.id, by: -1 }, { op: "rest", id: pie.id, resting: true }]);
    fireEvent.click(within(cards[0]!).getByRole("button", { name: `Edit ${pie.name}` }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Edit recipe")).toBeTruthy();
    expect((within(dlg).getByPlaceholderText(/Midnight/) as HTMLInputElement).value).toBe(pie.name);
    fireEvent.click(within(dlg).getByRole("button", { name: "Increase amount of Potatoes" }));
    expect(within(dlg).getByTestId("invent-foot").textContent).toContain("version 2");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save as v2" }));
    await waitFor(() => expect(ops.at(-1)).toMatchObject({ op: "edit", id: pie.id, name: pie.name, ingredients: [{ id: "potatoes", qty: 2.25 }, { id: "cheddar", qty: 1 }, { id: "onions", qty: 1 }] }));
  });

  it("an old save's cookbook (Round 12, no new fields) renders as before", () => {
    const { s } = invent(newOwner(18), PIE);
    render(<CookbookStrip meta={s.meta} game={s.game!} send={noop} onInvent={noop} />);
    expect(screen.getAllByTestId("cookbook-card")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull(); // read-only without the action
  });
});

// ── Empire ──
function yearTwoOwner(withDish: boolean): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 23, districtId: "high_street", restaurantName: "Formula Test", difficulty: "cosy" } });
  for (const id of ["beef_burger", "chicken_burger", "chunky_chips", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id)!;
    s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  if (withDish) s = invent(s, PIE, false).s;
  let g = s.game!;
  for (let d = 0; d < 20 && g.phase !== "gameover"; d++) g = runStrategyDay(content, g, STRATEGIES.typical);
  s = { ...s, game: { ...g, day: FORK_DAY }, meta: { ...initialMeta("owner"), ...(s.meta.customDishes ? { customDishes: s.meta.customDishes } : {}), lastPathDay: FORK_DAY - 1 } };
  return appReducer(s, { type: "fork", choice: "empire", brandName: "Formula Burgers" });
}
function empireDays(s: AppState, n: number): AppState {
  for (let i = 0; i < n && s.game!.phase !== "gameover"; i++) s = day(s);
  return s;
}

describe("an invented dish in the Empire formula", () => {
  it("doesn't change a thing for an Empire that doesn't use it; once in, every site cooks it for 30 days", () => {
    const plain = empireDays(yearTwoOwner(false), 30);
    const unused = empireDays(yearTwoOwner(true), 30);
    expect(JSON.stringify(unused.meta.empire)).toBe(JSON.stringify(plain.meta.empire));
    expect(serialize({ ...unused.game! })).toBe(serialize({ ...plain.game! }));

    let s = yearTwoOwner(true);
    const id = s.meta.customDishes![0]!.id;
    const ids = s.meta.empire!.brand.formula.menuDishIds;
    s = appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", menuDishIds: [...ids, id] } });
    expect(s.meta.empire!.brand.formula.menuDishIds).toContain(id);
    // delete and new ingredients are refused while it's in the formula
    s = appReducer(s, { type: "cookbook", op: { op: "delete", id } });
    expect(s.toast?.text).toContain("brand formula");
    s = appReducer(s, { type: "cookbook", op: { op: "edit", id, ingredients: STEW.ingredients } });
    expect(s.toast?.text).toContain("brand formula");
    s = empireDays(s, 30);
    expect(s.meta.empire!.brand.formula.menuDishIds).toContain(id);
    expect(s.meta.empire!.status).toBe("running");
    const back = roundTrip(s);
    expect(back.meta.empire!.brand.formula.menuDishIds).toContain(id);
  }, 120_000);

  it("the picker puts a recipe in and takes it out with SET_FORMULA", () => {
    const s = yearTwoOwner(true);
    const sent: unknown[] = [];
    render(<FormulaPicker e={s.meta.empire!} meta={s.meta} send={(c) => sent.push(c)} />);
    fireEvent.click(screen.getByRole("button", { name: `Put ${PIE.name} in the formula` }));
    expect(sent[0]).toEqual({ type: "SET_FORMULA", menuDishIds: [...s.meta.empire!.brand.formula.menuDishIds, s.meta.customDishes![0]!.id] });
  });
});

// ── Stars ──
describe("the Stars refine", () => {
  it("refines one dish a season (+1 skill, a suffix, a line) and the envelope names it on an inspection night", () => {
    let { s, dish } = invent(newOwner(19), PIE);
    ({ s } = invent(s, STEW, false));
    const skill = content.dishes.find((d) => d.id === dish.id)!.skillRequired;
    const season = seasonOf(s.game!.day);
    s = appReducer(s, { type: "cookbook", op: { op: "refine", id: dish.id, season, suffix: 0, prose: 4 } });
    const def = content.dishes.find((d) => d.id === dish.id)!;
    expect(def.skillRequired).toBe(skill + 1);
    expect(def.name).toBe(`${PIE.name}, ${REFINE_SUFFIXES[0]}`);
    const other = s.meta.customDishes![1]!;
    const again = appReducer(s, { type: "cookbook", op: { op: "refine", id: other.id, season, suffix: 1, prose: 1 } });
    expect(again.toast?.text).toMatch(/One dish a season/);
    s = day(s);
    const night = s.game!.history.at(-1)!;
    const lines = refinedOnInspection(s.game!, [{ day: night.day }], s.meta.customDishes);
    if ((night.perDish?.[dish.id]?.sold ?? 0) > 0) expect(lines[0]).toMatchObject({ day: night.day, name: def.name, prose: REFINE_PROSE[4] });
    else expect(lines).toEqual([]);
    expect(refinedOnInspection({ history: [{ day: 5, perDish: { [dish.id]: { sold: 2 } } } as unknown as DayResult] }, [{ day: 5 }], s.meta.customDishes)).toHaveLength(seasonOf(5) >= season ? 1 : 0);
  });

  it("the card offers the pools and sends one refine", () => {
    const { s, dish } = invent(newOwner(20), PIE);
    const ops: unknown[] = [];
    render(<RefineCard game={s.game!} meta={s.meta} chefName="Sam" hasHeadChef onCookbook={(o) => ops.push(o)} />);
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "2" } });
    expect(screen.getByTestId("refine-preview").textContent).toContain(REFINE_SUFFIXES[2]);
    fireEvent.click(screen.getByRole("button", { name: "Refine it" }));
    expect(ops).toEqual([{ op: "refine", id: dish.id, season: seasonOf(s.game!.day), suffix: 2, prose: 0 }]);
    cleanup();
    render(<RefineCard game={s.game!} meta={s.meta} chefName="Sam" hasHeadChef={false} />);
    expect(screen.getByText(/You need a head chef/)).toBeTruthy();
  });
});

// ── regulars past day 400 ──
function scripted(seed: number, days: number): GameState {
  let g = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "Long Haul", difficulty: "normal" } }).game!;
  for (let d = 0; d < days && g.phase !== "gameover"; d++) g = runStrategyDay(content, g, STRATEGIES.typical);
  return g;
}

describe("the regulars' memo", () => {
  it("resuming from a memo gives the same book as folding the whole history", () => {
    const g = scripted(31, 120);
    let memo: PathMeta["voices"];
    // as the app does it: one memo per evening, each resumed from the last
    for (let n = 1; n <= g.history.length; n += 9) memo = memoFrom({ ...g, history: g.history.slice(0, n) }, memo);
    memo = memoFrom(g, memo);
    const full = regularsFrom(g.seed, g.history);
    const resumed = regularsFrom(g.seed, g.history, memo);
    const strip = (xs: typeof full) => xs.map((x) => ({ id: x.def.id, joined: x.joined, done: x.done, open: x.open }));
    expect(strip(resumed)).toEqual(strip(full));
    expect(full.some((x) => x.done.length > 1)).toBe(true);
    expect(memo!.clip).toBe(clippingDay(weekScores(g)));
    // a memo from another seed, or ahead of the history, is ignored
    expect(strip(regularsFrom(g.seed + 1, g.history, memo))).toEqual(strip(regularsFrom(g.seed + 1, g.history)));
    expect(strip(regularsFrom(g.seed, g.history.slice(0, 50), memo))).toEqual(strip(regularsFrom(g.seed, g.history.slice(0, 50))));
  });

  it("a beat from before day 50 is still in the book at day 450; without the memo it drops out (and backfills once)", () => {
    const g = scripted(31, 450);
    expect(g.history[0]!.day).toBeGreaterThan(40); // the sim kept only 400 days
    // what the app does every evening, with the full history it had at the time
    let memo: PathMeta["voices"];
    let all: DayResult[] = [];
    let h = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 31, districtId: "high_street", restaurantName: "Long Haul", difficulty: "normal" } }).game!;
    for (let d = 0; d < 450 && h.phase !== "gameover"; d++) {
      h = runStrategyDay(content, h, STRATEGIES.typical);
      all = [...all.filter((x) => x.day !== h.history.at(-1)?.day), ...(h.history.at(-1) ? [h.history.at(-1)!] : [])];
      memo = memoFrom(h, memo);
    }
    const early = regularsFrom(g.seed, all).flatMap((x) => x.done.filter((b) => b.day < 50).map((b) => ({ id: x.def.id, ...b })));
    expect(early.length).toBeGreaterThan(0);
    const withMemo = regularsFrom(g.seed, g.history, memo).flatMap((x) => x.done.filter((b) => b.day < 50).map((b) => ({ id: x.def.id, ...b })));
    expect(withMemo).toEqual(early);
    const book = regularsFrom(g.seed, g.history, memo).find((x) => x.def.id === early[0]!.id)!;
    expect(storyOf(g, book).some((b) => b.day < 50)).toBe(true);
    // the same save without a memo: the early beats are gone from a fresh fold; the backfill keeps what's left
    const fresh = regularsFrom(g.seed, g.history).flatMap((x) => x.done.filter((b) => b.day < 50));
    expect(fresh).toEqual([]);
    const backfill = memoFrom(g);
    expect(backfill.day).toBe(g.history.at(-1)!.day);
    expect(clipFrom(memo, g.seed, weekScores(g))).toBe(memo!.clip ?? clippingDay(weekScores(g)));
    // and it survives a save round trip
    const meta = { ...initialMeta("owner"), voices: memo, lastPathDay: g.history.at(-1)!.day };
    const back = checkedDecode(encodeSave(g, meta));
    expect(back.meta.voices).toEqual(memo);
  }, 120_000);

  it("the reducer keeps the newest memo and the App hook's action stores it", () => {
    const s = newOwner(33);
    const m1 = { v: 1 as const, seed: s.game!.seed, day: 4, regs: [] };
    const a = appReducer(s, { type: "voicesMemo", memo: m1 });
    expect(a.meta.voices).toEqual(m1);
    expect(appReducer(a, { type: "voicesMemo", memo: { ...m1, day: 3 } })).toBe(a);
  });
});

describe("regulars: the month and the notes", () => {
  it("regular of the month is whoever's story moved most; a finished story leaves a note (≥ 20 to pick from)", () => {
    expect(loadVoices().regulars.thanks.length).toBeGreaterThanOrEqual(THANKS_MIN);
    const g = scripted(34, 240);
    const regs = regularsFrom(g.seed, g.history);
    const top = regularOfMonth(regs, 0, 29);
    if (regs.some((r) => r.done.some((b) => b.day < 30))) expect(top).toBeDefined();
    expect(regularOfMonth(regs, 10_000, 10_029)).toBeUndefined();
    const done = regs.find((r) => r.done.some((b) => b.beat === r.def.beats.length));
    for (const r of regs) {
      const note = thanksNote(g, r);
      if (r === done) expect(note!.text).not.toMatch(/[{}]/);
      if (!r.done.some((b) => b.beat === r.def.beats.length)) expect(note).toBeUndefined();
    }
    // the same regular always leaves the same note
    if (done) expect(thanksNote(g, done)).toEqual(thanksNote(g, done));
  }, 60_000);
});

// ── brand ──
describe("brand in the places it was missing", () => {
  it("a visited room wears the owner's awning and uniform, not the visitor's", () => {
    const owner = { name: "Chez Owner", brand: { shape: "shield", motif: "chilli", letter: "caps", primary: "1f3a5f", accent: "f2d16b", uniform: "waistcoat", uniformColour: "b3261e", menu: "chalkboard" } };
    const b = visitBrand(owner);
    expect(b).toMatchObject({ primary: "#1f3a5f", accent: "#f2d16b", uniform: "waistcoat", uniformColour: "#b3261e" });
    const look = visitLook(b);
    expect(look.awning).toContain("#1f3a5f");
    expect(look.canvas).toEqual({ uniform: "waistcoat", colour: "#b3261e", accent: "#f2d16b" });
    // junk fields → the owner's name's default, never the visitor's
    expect(visitBrand({ name: "Chez Owner", brand: { primary: "nope" } })).toEqual(defaultBrand("Chez Owner"));
    expect(visitBrand({ name: "Chez Owner" })).toEqual(defaultBrand("Chez Owner"));
  });

  it("MyShift's house brand is the employer's default, read-only (a stored code is ignored)", () => {
    const code = encodeBrand({ ...defaultBrand("Pat's Grill"), primary: "#000000" });
    render(<HouseBrandCard name="Pat's Grill" code={code} />);
    const card = screen.getByTestId("house-brand");
    expect(card.textContent).toContain("design your own once you run the place");
    expect(resolveBrand(code, "Pat's Grill", true)).toEqual(defaultBrand("Pat's Grill"));
    expect((within(card).getByRole("img") as HTMLImageElement).alt).toBe("Pat's Grill logo");
  });

  it("a formula of only her own dish is accepted by sim-empire as it stands", () => {
    const s = yearTwoOwner(true);
    const id = s.meta.customDishes![0]!.id;
    const r = appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", menuDishIds: [id] } });
    expect(r.meta.empire!.brand.formula.menuDishIds).toEqual([id]);
  });
});
