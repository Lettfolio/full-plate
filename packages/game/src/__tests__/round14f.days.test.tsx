/**
 * Round 14 (F, "repetitive from day 6 on a phone: four taps a day, no decisions"): the morning's Today card (a VIP
 * order due today, the rival's week) and the Evening's "one thing for tomorrow". Every row comes from something the
 * game already has; nothing new is decided by the sim.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Command, DayResult, GameState } from "@full-plate/sim-core";
import { applyCommand, content, newGame, runStrategyDay, STRATEGIES } from "../sim";
import { memoFrom } from "../lib/voicesMemo";
import { regularsFrom } from "../lib/regulars";
import { canPlate, todayRows } from "../lib/today";
import { oneThingTomorrow } from "../lib/tomorrow";
import { TodayCard } from "../components/TodayCard";
import { weekdayIndex } from "../lib/calendar";
import { rivalScore } from "../lib/rival";
import type { VoicesMemo } from "../state/paths";

afterEach(cleanup);
const name = (id: string) => content.dishes.find((d) => d.id === id)?.name ?? id;

/** A typical game played to the morning of `day`, its memo carried as App does. */
function playTo(day: number, seed = 21): { g: GameState; memo: VoicesMemo | undefined } {
  let g = newGame(content, { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "Long Table", difficulty: "normal" });
  let memo: VoicesMemo | undefined;
  while (g.day < day && g.phase !== "gameover") { g = runStrategyDay(content, g, STRATEGIES.typical); memo = memoFrom(g, memo); }
  return { g, memo };
}

describe("Round 14 F — the morning's Today card", () => {
  it("names a VIP order due today, with the tap that helps (here: the dish is off the menu, so put it back on)", () => {
    // Find a morning with an order due.
    let found: { g: GameState; memo: VoicesMemo | undefined; dish: string } | undefined;
    for (let d = 6; d <= 40 && !found; d++) {
      const { g, memo } = playTo(d);
      const o = regularsFrom(g.seed, g.history, memo).find((s) => s.open && s.open.weekday === weekdayIndex(g.day) && s.open.from <= g.day)?.open;
      if (o && g.menu.some((m) => m.dishId === o.dishId)) found = { g, memo, dish: o.dishId };
    }
    expect(found).toBeDefined();
    const { memo, dish } = found!;
    const off = applyCommand(content, found!.g, { type: "SET_MENU_ITEM", dishId: dish, active: false }).state;
    const row = todayRows(content, off, memo).find((r) => r.kind === "vip")!;
    expect(row.title).toContain(name(dish));
    expect(row.act!.commands).toEqual([{ type: "SET_MENU_ITEM", dishId: dish, active: true }]);
    const sent: Command[] = [];
    render(<TodayCard game={off} meta={{ voices: memo } as never} send={(c) => sent.push(c)} onTab={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: `Put the ${name(dish)} back on` }));
    expect(sent).toEqual(row.act!.commands);
    // On and in stock: no button, just what it takes.
    const on = todayRows(content, found!.g, memo).find((r) => r.kind === "vip")!;
    if (canPlate(content, found!.g, dish)) expect(on.act).toBeUndefined();
  }, 120_000);

  it("Monday names the rival's target for the week (their real score); Sunday says where the week stands", () => {
    let monday: GameState | undefined; let sunday: GameState | undefined;
    for (let d = 7; d <= 21; d++) {
      const { g } = playTo(d);
      if (weekdayIndex(g.day) === 0 && !monday) monday = g;
      if (weekdayIndex(g.day) === 6 && !sunday) sunday = g;
    }
    const m = todayRows(content, monday!).find((r) => r.kind === "rivalWeek")!;
    expect(m.text).toContain(`${(Math.round(rivalScore(monday!, monday!.day) * 10) / 10).toFixed(1)}★`);
    expect(m.act!.tab).toBe("restaurant");
    expect(todayRows(content, sunday!).find((r) => r.kind === "rivalSunday")!.text).toMatch(/You're on \d\.\d★ over \d nights?/);
  }, 120_000);

  it("days 6–30 of a typical game: how many mornings and evenings now carry a decision (measured, pinned loosely)", () => {
    let g = newGame(content, { type: "NEW_GAME", seed: 21, districtId: "high_street", restaurantName: "Long Table", difficulty: "normal" });
    let memo: VoicesMemo | undefined;
    let mornings = 0; let evenings = 0; let days = 0;
    while (g.day < 30) {
      const counted = g.day >= 5;
      if (counted) { days++; if (todayRows(content, g, memo).length) mornings++; }
      g = runStrategyDay(content, g, STRATEGIES.typical);
      memo = memoFrom(g, memo);
      if (counted && oneThingTomorrow(g, g.history.at(-1)!, name, (id) => content.dishes.find((d) => d.id === id)?.suggestedPrice)) evenings++;
    }
    expect(days).toBe(25);
    // The Today card shows on about one morning in three (VIP orders and the rival's Monday/Sunday) …
    expect(mornings).toBeGreaterThanOrEqual(6);
    // … and "one thing for tomorrow" has something from her numbers on most evenings (the sim's own tip comes first).
    expect(evenings).toBeGreaterThanOrEqual(12);
    console.info(`R14F days 6-30: Today card ${mornings}/${days} mornings, one-thing ${evenings}/${days} evenings`);
  }, 120_000);
});

describe("Round 14 F — one thing for tomorrow", () => {
  const night = (over: Partial<DayResult>): DayResult => ({ day: 9, covers: 60, walkouts: 0, perDish: {}, ...over } as DayResult);
  const game = (log: string[] = [], menu = [{ dishId: "margherita", price: 1000, active: true }, { dishId: "beef_burger", price: 1200, active: true }]) =>
    ({ log: log.map((text) => ({ day: 9, text, kind: "bad" })), menu } as unknown as GameState);

  it("a dish that ran out comes first", () => {
    const t = oneThingTomorrow(game(["Margherita pizza has run out — 86'd for today."]), night({ walkouts: 20 }), name)!;
    expect(t.kind).toBe("ranOut");
    expect(t.title).toBe("The Margherita pizza ran out tonight.");
  });
  it("then long waits, then the dish that made the least per plate (with a one-tap price rise tomorrow)", () => {
    expect(oneThingTomorrow(game(), night({ walkouts: 9 }), name)!.kind).toBe("waits");
    const t = oneThingTomorrow(game(), night({ perDish: {
      margherita: { sold: 10, plated: 10, qualityMean: 70, revenue: 10_000, foodCost: 6_000 },
      beef_burger: { sold: 10, plated: 10, qualityMean: 70, revenue: 12_000, foodCost: 3_000 },
    } }), name)!;
    expect(t.kind).toBe("margin");
    expect(t.title).toContain("Margherita pizza");
    expect(t.act!.commands).toEqual([{ type: "SET_MENU_ITEM", dishId: "margherita", price: 1100 }]);
    expect(oneThingTomorrow(game(), night({ covers: 0 }), name)).toBeUndefined();
    // Already well above its usual price: no more nudging it up.
    const dear = game(undefined, [{ dishId: "margherita", price: 5000, active: true }, { dishId: "beef_burger", price: 1200, active: true }] as never);
    const lines = { margherita: { sold: 10, plated: 10, qualityMean: 70, revenue: 10_000, foodCost: 6_000 }, beef_burger: { sold: 10, plated: 10, qualityMean: 70, revenue: 12_000, foodCost: 3_000 } };
    expect(oneThingTomorrow(dear, night({ perDish: lines }), name, (id) => content.dishes.find((d) => d.id === id)?.suggestedPrice)).toBeUndefined();
  });
});
