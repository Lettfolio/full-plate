/**
 * Round 14 (F, U5): a day with every dish out of stock used to open without a stop (0 guests, −£518) and the evening
 * said only "A tough night.". Now Open asks first, naming the cause, and offers to order and close today; the evening
 * headline names the reason for a night nobody ate.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { applyCommand, content, HOOKS, runStrategyDay, STRATEGIES, tick } from "../sim";
import { baseGame } from "./fixtures/round2";
import { Planning } from "../screens/Planning";
import { Evening } from "../screens/Evening";
import { zeroNightCause, ZERO_HEADLINE } from "../lib/evening";

afterEach(cleanup);
const noop = () => {};

/** A typical game a few days in, with the larder emptied this morning (as if she never restocked). */
function emptyLarder(): GameState {
  let g = baseGame(31);
  for (let i = 0; i < 4; i++) g = runStrategyDay(content, g, STRATEGIES.typical);
  expect(g.phase).toBe("planning");
  return { ...g, stock: [], orders: [] };
}

describe("Round 14 F — U5 nothing to cook", () => {
  it("Open asks first when nothing on the menu can be cooked, and doesn't open", () => {
    const sent: Command[] = [];
    render(<Planning game={emptyLarder()} send={(c) => sent.push(c)} tab="menu" onTab={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Open for service/ }));
    expect(sent).toEqual([]);
    const ask = screen.getByTestId("confirm-nofood");
    expect(ask.textContent).toMatch(/Nothing on your menu can be cooked today/);
    expect(ask.textContent).toMatch(/out of stock/);
    expect(screen.getByRole("button", { name: "Open anyway" })).toBeTruthy();
  });

  it("'Order stock and close today' orders tomorrow's stock and closes (no wasted service)", () => {
    expect(HOOKS.closeToday).toBe(true);
    let g = emptyLarder();
    const sent: Command[] = [];
    render(<Planning game={g} send={(c) => sent.push(c)} tab="menu" onTab={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Open for service/ }));
    fireEvent.click(screen.getByRole("button", { name: /Order stock .* and close today/ }));
    expect(sent.filter((c) => c.type === "ORDER_STOCK").length).toBeGreaterThan(0);
    expect(sent.at(-1)!.type).toBe("CLOSE_TODAY");
    expect(sent.some((c) => c.type === "START_SERVICE")).toBe(false);
    for (const c of sent) { const r = applyCommand(content, g, c); g = r.state; }
    expect(g.orders.length).toBeGreaterThan(0);
  });

  it("'Open anyway' still opens", () => {
    const sent: Command[] = [];
    render(<Planning game={emptyLarder()} send={(c) => sent.push(c)} tab="menu" onTab={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Open for service/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open anyway" }));
    expect(sent).toEqual([{ type: "START_SERVICE" }]);
  });

  it("a normal morning opens straight away (no extra tap)", () => {
    let g = baseGame(31);
    for (let i = 0; i < 4; i++) g = runStrategyDay(content, g, STRATEGIES.typical);
    const sent: Command[] = [];
    render(<Planning game={g} send={(c) => sent.push(c)} tab="menu" onTab={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Open for service/ }));
    expect(sent).toEqual([{ type: "START_SERVICE" }]);
  });

  it("the evening after opening with an empty larder says why nobody ate", () => {
    let g = applyCommand(content, emptyLarder(), { type: "START_SERVICE" }).state;
    while (g.phase === "service") g = tick(content, g).state;
    const r = g.history.at(-1) ?? null;
    expect(r?.covers).toBe(0);
    expect(zeroNightCause(r!, g, g.menu.filter((m) => m.active).length, 0)).toBe("noStock");
    render(<Evening game={g} result={r} onNext={noop} nextLabel="Next day" send={noop} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ZERO_HEADLINE.noStock.title);
    expect(screen.getByTestId("zero-night").textContent).toMatch(/out of stock/);
  });

  it("names a closed day and a day with nobody on", () => {
    const g = emptyLarder();
    expect(zeroNightCause({ covers: 0, closed: true, day: 4 }, g, 0, 0)).toBe("closed");
    expect(zeroNightCause({ covers: 0, day: 4 }, { ...g, staff: [] }, 0, 0)).toBe("noStaff");
    expect(zeroNightCause({ covers: 3, day: 4 }, g, 99, 0)).toBeUndefined();
  });
});
