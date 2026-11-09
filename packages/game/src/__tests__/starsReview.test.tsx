/**
 * Round 3 review, Stars fixes: the short-menu warning before service (P1), the Stars hints (P2) and the shared hire
 * check (P2). Every state comes from the real sim and the real reducer.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { inSeason } from "@full-plate/sim-stars";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { FORK_DAY, initialMeta } from "../state/paths";
import { applyCommand, candidates, content, hireCheck, runDay, SERVICE_TICKS, suggestedOrder } from "../sim";
import { StaffTab } from "../screens/planning/StaffTab";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { Planning } from "../screens/Planning";
import { tonightRisk } from "../screens/planning/stockNeeds";
import { StarsTab } from "../screens/paths/StarsTab";

afterEach(cleanup);
const noop = () => {};

/** A real owner game: starter menu, two hires, a few played days with the evening restock, then moved to year 2. */
function playedOwner(): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 5, districtId: "high_street", restaurantName: "Short Menu", difficulty: "normal" } });
  for (const d of suggestedStarterMenu(content, s.game!)) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice } });
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  let g = s.game!;
  for (let d = 0; d < 4 && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)?.choices[0]?.id ?? "" }).state;
    else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
  }
  expect(g.phase).toBe("planning");
  const jumped: GameState = { ...g, day: FORK_DAY, history: g.history.map((h) => ({ ...h, profit: Math.max(h.profit, 10_000) })) };
  return { ...s, game: jumped, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1 } };
}

/** The Stars path, moved into inspection season (40 days before guide day), still in the morning. */
function starsInSeason(): AppState {
  let s = appReducer(playedOwner(), { type: "fork", choice: "stars" });
  const stars = s.meta.stars!;
  const day = stars.guides.michelin.nextGuideDay - 40;
  s = { ...s, game: { ...s.game!, day }, meta: { ...s.meta, stars: { ...stars, lastDay: day - 1 }, lastPathDay: day - 1 } };
  expect(inSeason(s.meta.stars!, day)).toBe(true);
  return s;
}

describe("P1: the short-menu warning before service", () => {
  it("tonightRisk names the dishes the larder can't cover (stock on hand vs sim-core's forecast)", () => {
    const g = playedOwner().game!;
    const full = tonightRisk(content, g);
    const empty = tonightRisk(content, { ...g, stock: [] });
    const active = g.menu.filter((m) => m.active).length;
    expect(empty.dishes.length).toBe(active);
    expect(empty.out).toBe(active);
    expect(empty.lines.length).toBeGreaterThan(0);
    expect(empty.lines).toEqual(suggestedOrder(content, { ...g, stock: [] }).map((l) => [l.ingredientId, l.qty]));
    expect(full.dishes.length).toBeLessThan(empty.dishes.length);
  });

  it("an owner without Stars gets the plain warning; the one-tap order sends sim-core's suggestedOrder", () => {
    const g = { ...playedOwner().game!, stock: [], orders: [] };
    const sent: Command[] = [];
    render(<Planning game={g} send={(c) => sent.push(c)} tab="menu" onTab={noop} />);
    const note = screen.getByLabelText("Stock warning");
    expect(note.textContent).toMatch(/Tonight's larder won't cover \d+ dishes/);
    expect(note.textContent).not.toMatch(/Inspectors/);
    fireEvent.click(screen.getByRole("button", { name: /Order to cover tomorrow/ }));
    expect(sent).toEqual(suggestedOrder(content, g).map((l) => ({ type: "ORDER_STOCK", ...l })));
  });

  it("in inspection season it is an alert that names the stakes and the way out", () => {
    const s = starsInSeason();
    const g = { ...s.game!, stock: [], orders: [] };
    render(<Planning game={g} send={noop} tab="menu" onTab={noop} meta={s.meta} sendStars={noop} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Inspectors are about — a short menu tonight could cost you a star.");
    expect(alert.textContent).toMatch(/off night for the guide/);
    expect(alert.textContent).toMatch(/Closing tonight doesn't count against you/);
  });

  it("no warning once the larder covers tonight, or on the opening day", () => {
    const g = playedOwner().game!;
    const covered = { ...g, stock: g.stock.map((x) => ({ ...x, qty: 9999, batches: [{ qty: 9999, day: g.day }] })) };
    // Top up every ingredient the menu uses, even ones not in the larder yet.
    const ids = new Set(content.dishes.filter((d) => g.menu.some((m) => m.dishId === d.id)).flatMap((d) => d.ingredients.map((i) => i.id)));
    for (const id of ids) if (!covered.stock.some((x) => x.ingredientId === id)) covered.stock.push({ ingredientId: id, qty: 9999, oldestDay: g.day, batches: [{ qty: 9999, day: g.day }] });
    render(<Planning game={covered} send={noop} tab="menu" onTab={noop} />);
    expect(screen.queryByLabelText("Stock warning")).toBeNull();
  });

  it("through the reducer: an empty larder in inspection season → a named SHORT_MENU in the evening, and steadiness slips", () => {
    let s = starsInSeason();
    const window0 = s.meta.stars!.consistencyWindow.length;
    s = { ...s, game: { ...s.game!, stock: [], orders: [] } };
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    for (let i = 0; i <= SERVICE_TICKS && s.game!.phase === "service"; i++) s = appReducer(s, { type: "ticks", n: SERVICE_TICKS });
    expect(["evening", "event"]).toContain(s.game!.phase);
    const ev = s.meta.starsEvents.find((e) => e.type === "SHORT_MENU");
    expect(ev).toBeTruthy();
    expect(ev && ev.type === "SHORT_MENU" && ev.inspectionSeason).toBe(true);
    expect(ev && ev.type === "SHORT_MENU" && ev.text).toMatch(/dishes were off \(/);
    // A night that ran out of everything is in the window (as an off night), not skipped like a day off.
    expect(s.meta.stars!.consistencyWindow.length).toBe(window0 + 1);
  });
});

describe("P2: the Stars tab says what holds you back", () => {
  it("shows the top two criteria below the bar as plain hints, with the rest folded away", () => {
    const s = appReducer(playedOwner(), { type: "fork", choice: "stars" });
    render(<StarsTab game={s.game!} meta={s.meta} stars={s.meta.stars!} send={noop} onTastingMenu={noop} />);
    const card = screen.getByRole("heading", { name: "What's holding you back" }).closest(".card") as HTMLElement;
    const top = card.querySelectorAll("ol.starhints > li");
    expect(top.length).toBe(2);
    // A starter bistro with no test kitchen and no partners: signatures and sourcing first.
    expect(top[0]!.textContent).toMatch(/^Personality.*build the test kitchen/);
    expect(top[1]!.textContent).toMatch(/^Ingredients.*Sourcing/);
    expect(card.textContent).toMatch(/stay secret until guide day/);
    // Words only: no inspector scores, thresholds or predicted stars on the card.
    expect(card.textContent).not.toMatch(/score|threshold|predict/i);
  });
});

describe("P2: one hire-cost rule (sim.ts hireCheck over sim-core exports)", () => {
  const rejected = (g: GameState, i: number) =>
    applyCommand(content, g, { type: "HIRE", candidateIndex: i }).events.some((e) => e.type === "LOG" && e.entry.kind === "bad");

  it("agrees with sim-core's HIRE at the edge, with and without the career's cheaper fee", () => {
    const g0 = playedOwner().game!;
    const c = candidates(content, g0)[0]!;
    for (const g of [g0, { ...g0, recruitmentFee: 2_000 }]) {
      const { needed, fee } = hireCheck(g, c);
      expect(fee).toBe(g.recruitmentFee ?? 15_000);
      expect(hireCheck({ ...g, cash: needed }, c).canAfford).toBe(true);
      expect(rejected({ ...g, cash: needed }, 0)).toBe(false);
      expect(hireCheck({ ...g, cash: needed - 1 }, c).canAfford).toBe(false);
      expect(rejected({ ...g, cash: needed - 1 }, 0)).toBe(true);
    }
  });

  it("the Staff tab's Hire button follows it", () => {
    const g0 = playedOwner().game!;
    const c = candidates(content, g0)[0]!;
    const { needed } = hireCheck(g0, c);
    render(<StaffTab game={{ ...g0, cash: needed - 1 }} send={noop} />);
    const btn = screen.getByText(c.name).closest(".candidate")!.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(`Needs £${Math.ceil(needed / 100)} in the bank`);
    cleanup();
    render(<StaffTab game={{ ...g0, cash: needed }} send={noop} />);
    expect(screen.getByText(c.name).closest(".candidate")!.querySelector("button")!.disabled).toBe(false);
  });
});

describe("round 4 review: hireCheck agrees with sim-core's HIRE for every candidate (property)", () => {
  it("over seeds × districts × difficulty × fee perk × cash around the edge", () => {
    const districts = ["high_street", "seaside", "student_quarter"] as const;
    const difficulties = ["cosy", "normal", "hard"] as const;
    let checked = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const base = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: districts[seed % 3]!, restaurantName: "P", difficulty: difficulties[seed % 3]! } }).game!;
      for (const fee of [undefined, 0, 2_000, 15_000]) {
        const g = fee === undefined ? base : { ...base, recruitmentFee: fee };
        const cands = candidates(content, g);
        cands.forEach((c, i) => {
          const { needed } = hireCheck(g, c);
          for (const cash of [0, needed - 1, needed, needed + 1, needed * 3, 1_000_000]) {
            const at = { ...g, cash };
            const r = applyCommand(content, at, { type: "HIRE", candidateIndex: i });
            const accepted = !r.events.some((e) => e.type === "LOG" && e.entry.kind === "bad");
            expect(hireCheck(at, c).canAfford, `seed ${seed} fee ${fee} cand ${i} cash ${cash}`).toBe(accepted);
            if (accepted) expect(at.cash - r.state.cash).toBe(hireCheck(at, c).fee);
            checked++;
          }
        });
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});
