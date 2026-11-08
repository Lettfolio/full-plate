/** Integration (round 2): sim fields wired into the UI — P&L incident line, morning notices, fatigue, tool gating. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { Evening } from "../screens/Evening";
import { Planning } from "../screens/Planning";
import { IncidentCard } from "../components/IncidentCard";
import { StaffStrip } from "../components/StaffStrip";
import { absorb, initialAppState } from "../state/gameReducer";
import { content, OWNER_FATIGUE_WARNING, runDay } from "../sim";
import { trainBlocker } from "../lib/staff";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { applyCommand } from "../sim";
import { baseGame, sentBack } from "./fixtures/round2";

afterEach(cleanup);
const noop = () => {};

function playedDay(): { game: GameState; result: DayResult } {
  let g = baseGame(77);
  for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  g = runDay(content, g).state;
  return { game: g, result: g.history.at(-1)! };
}

/** Sum of the P&L rows the Evening screen shows, read back from the DOM (pence). */
function shownPnl(): { lines: number; profit: number } {
  const rows = [...document.querySelectorAll(".pnl tr")];
  const val = (tr: Element) => {
    const t = tr.querySelector("td:last-child")!.textContent!.replace(/[£,\s]/g, "").replace("−", "-");
    return Math.round(Number(t) * 100);
  };
  let lines = 0;
  let profit = 0;
  for (const tr of rows) {
    if (tr.classList.contains("pnl__sub")) continue;
    if (tr.classList.contains("pnl__total")) profit = val(tr);
    else lines += val(tr);
  }
  return { lines, profit };
}

describe("evening P&L", () => {
  it("shows incident costs as a line and the shown lines sum to the profit", () => {
    const { game, result } = playedDay();
    const r: DayResult = { ...result, incidentCosts: 6000, profit: result.profit - 6000 };
    render(<Evening game={game} result={r} onNext={noop} nextLabel="Next" send={noop} />);
    expect(screen.getByText(/Problems sorted/)).toBeTruthy();
    const { lines, profit } = shownPnl();
    expect(profit).toBe(r.profit);
    expect(Math.abs(lines - profit)).toBeLessThanOrEqual(8); // per-row rounding to the penny
  });

  it("warns about owner fatigue at the threshold, not below", () => {
    const { game, result } = playedDay();
    render(<Evening game={{ ...game, ownerFatigue: OWNER_FATIGUE_WARNING - 1 }} result={result} onNext={noop} nextLabel="Next" send={noop} />);
    expect(screen.queryByText(/worn out/)).toBeNull();
    cleanup();
    render(<Evening game={{ ...game, ownerFatigue: OWNER_FATIGUE_WARNING }} result={result} onNext={noop} nextLabel="Next" send={noop} />);
    expect(screen.getByText(/worn out \(60\/100\)/)).toBeTruthy();
  });
});

describe("planning notices", () => {
  it("day 0: no out-of-stock or running-low hints, and an opening-stock note", () => {
    let g = baseGame();
    for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
    render(<Planning game={g} send={noop} tab="menu" onTab={noop} />);
    const bar = document.querySelector(".openbar__hints") as HTMLElement;
    expect(within(bar).queryByText(/out of stock|running low/)).toBeNull();
    expect(screen.getByText(/larder is empty/)).toBeTruthy();
  });

  it("morning after a short delivery: a notice naming the ingredient and the shortfall; fatigue warning at ≥ 60", () => {
    const g0 = baseGame();
    const ing = content.ingredients[0]!;
    const g = { ...g0, day: 3, stats: { ...g0.stats, daysOpen: 3 }, shortDelivery: { ingredientId: ing.id, missing: 12 }, ownerFatigue: 72 };
    render(<Planning game={g} send={noop} tab="menu" onTab={noop} />);
    const notes = document.querySelector(".planning__notices")!.textContent!;
    expect(notes).toContain(`${ing.name} delivery came 12 portions short`);
    expect(screen.getByText(/worn out \(72\/100\)/)).toBeTruthy();
  });
});

describe("tool gating", () => {
  it("TRAIN is blocked on a training day and at potential", () => {
    const g = baseGame();
    const s = { id: "s1", name: "Ada Chef", role: "chef" as const, skill: 50, speed: 50, charm: 50, mood: 60, fatigue: 0, wage: 1200, traits: [], hiredDay: 0, potential: 50, rota: [true, true, true, true, true, true, true] };
    const two = { ...g, staff: [s, { ...s, id: "s2", name: "Bo Chef", potential: 80 }] };
    expect(trainBlocker(two, s, 0)).toMatch(/learned all/);
    expect(trainBlocker({ ...two, staff: [two.staff[0]!, { ...two.staff[1]!, trainingDay: g.day }] }, { ...two.staff[1]!, trainingDay: g.day }, 0)).toMatch(/training today/);
    expect(trainBlocker(two, two.staff[1]!, 0)).toBeNull();
  });

  it("GIVE_BREAK is disabled while breakUntilTick > tick", () => {
    const g = baseGame();
    const wd = (g.day + 2) % 7;
    const s = { id: "s1", name: "Ada Server", role: "server" as const, skill: 50, speed: 50, charm: 50, mood: 60, fatigue: 80, wage: 1200, traits: [], hiredDay: 0, potential: 70, rota: Array.from({ length: 7 }, (_, i) => i === wd) };
    render(<StaffStrip game={{ ...g, phase: "service", tick: 40, staff: [{ ...s, breakUntilTick: 46 }] }} send={noop} />);
    expect((screen.getByRole("button", { name: /on a break/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<StaffStrip game={{ ...g, phase: "service", tick: 46, staff: [{ ...s, breakUntilTick: 46 }] }} send={noop} />);
    expect((screen.getByRole("button", { name: /Give Ada a break/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an incident option the sim marks disabled is a disabled button with its reason", () => {
    const inc = sentBack({ options: [{ id: "remake", label: "Remake it", description: "x", disabled: "No stock left" }, { id: "apologise", label: "Apologise", description: "y" }] });
    render(<IncidentCard incident={inc} tick={32} cash={100000} send={noop} />);
    const b = screen.getByRole("button", { name: /Remake it/ }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(screen.getByText("No stock left")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Apologise/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("event contract", () => {
  it("INCIDENT_RESOLVED tone colours the ticker; GOAL_COMPLETED reward is used for the toast", () => {
    const g = baseGame();
    const s = absorb({ ...initialAppState, game: g }, [
      { type: "INCIDENT_RESOLVED", incidentId: "x", resolution: "ride", outcome: "You rode out the rush.", tone: "neutral" },
      { type: "GOAL_COMPLETED", goalId: "no-such-goal", reward: { cash: 10000 } },
    ]);
    expect(s.ticker.at(-1)!.kind).toBe("info");
    expect(s.toast!.text).toMatch(/\+£100/);
  });
});
