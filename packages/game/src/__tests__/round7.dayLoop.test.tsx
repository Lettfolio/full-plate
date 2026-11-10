/**
 * Round 7 (B): the owner's daily loop for a 10-year-old — the Menu tab's list/matrix toggle, the Stock tab's one-line
 * forecast (whole numbers), the Staff tab's week strip with doubled-up shifts highlighted, the Evening's money figure
 * and week bars, the GameOver cause, the live-summary trend and the three-beat strip. Real sim states where it matters.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DayResult, GameState, Staff } from "@full-plate/sim-core";
import { applyCommand, content, runDay } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { baseGame } from "./fixtures/round2";
import { MenuTab, readMenuView } from "../screens/planning/MenuTab";
import { StockTab } from "../screens/planning/StockTab";
import { StaffTab } from "../screens/planning/StaffTab";
import { RotaWeek } from "../screens/planning/RotaWeek";
import { stockNeeds } from "../screens/planning/stockNeeds";
import { TonightMoney } from "../screens/Evening";
import { GameOver } from "../screens/GameOver";
import { DayRhythm } from "../components/DayRhythm";
import { MoneyText } from "../components/MoneyText";
import { hourTrend, HOUR_TICKS } from "../screens/Service";
import { doubledShifts, forecastLine, gameOverCause, lastNights, rotaWeek, versusYesterday } from "../lib/dayLoop";
import { shiftCost } from "../sim";

afterEach(cleanup);
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
const noop = () => {};

/** A real played day with the starter menu (fractional stock after service). */
function played(): GameState {
  let g = baseGame(77);
  for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  g = runDay(content, g).state;
  return applyCommand(content, g, { type: "END_DAY" }).state;
}

const person = (id: string, name: string, role: Staff["role"], rota: boolean[], wage = 1300): Staff =>
  ({ id, name, role, wage, rota, skill: 50, speed: 50, charm: 50, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: 50 }) as Staff;
const ALL = [true, true, true, true, true, true, true];
const WEEKEND = [false, false, false, false, true, true, true];
const days = (n: number, f: (i: number) => Partial<DayResult>) =>
  Array.from({ length: n }, (_, day) => ({ day, covers: 50, walkouts: 0, revenue: 100_000, foodCost: 30_000, labourCost: 40_000, rent: 10_000, loanPayment: 4_000, tips: 0, profit: 5_000, averageRating: 4, averageSpend: 2000, waste: { prep: 0, plate: 0, spoil: 0 }, reviews: [], staffMoodDelta: {}, popularityDelta: 0, prestigeDelta: 0, ...f(day) }) as DayResult);

describe("Menu tab: today's menu first, the matrix as an expert view", () => {
  it("opens on the list, loads the matrix on demand, remembers the choice, and goes back", async () => {
    const g = played();
    render(<MenuTab game={g} send={noop} />);
    const list = screen.getByRole("button", { name: /Today's menu/ });
    const matrix = screen.getByRole("button", { name: /Menu matrix/ });
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(matrix.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("heading", { name: "Today's menu" })).toBeTruthy();
    expect(document.querySelector(".matrix svg")).toBeNull();
    fireEvent.click(matrix);
    expect(matrix.getAttribute("aria-pressed")).toBe("true");
    // R11-D: a lazy chunk; on a loaded machine its first import can take longer than the 1 s default.
    expect(await screen.findByRole("heading", { name: "Menu matrix" }, { timeout: 8000 })).toBeTruthy();
    expect(document.querySelector(".matrix svg")).not.toBeNull();
    expect(readMenuView()).toBe("matrix");
    fireEvent.click(list);
    expect(document.querySelector(".matrix svg")).toBeNull();
    expect(readMenuView()).toBe("list");
  });

  it("asks once before a dish leaves the menu (no undo)", () => {
    const g = played();
    const sent: unknown[] = [];
    render(<MenuTab game={g} send={(c) => sent.push(c)} />);
    const first = g.menu[0]!;
    const name = content.dishes.find((d) => d.id === first.dishId)!.name;
    fireEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
    expect(sent).toHaveLength(0);
    const ask = screen.getByRole("group", { name: `Remove ${name}?` });
    fireEvent.click(within(ask).getByRole("button", { name: "Keep" }));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
    fireEvent.click(within(screen.getByRole("group", { name: `Remove ${name}?` })).getByRole("button", { name: "Remove" }));
    expect(sent).toEqual([{ type: "REMOVE_MENU_ITEM", dishId: first.dishId }]);
  });
});

describe("Stock tab: the forecast in one line, in whole numbers", () => {
  it("forecastLine: need rounds up, stock rounds down, orders count, short says how many to order", () => {
    expect(forecastLine({ need: 30.2, onHand: 23.56, incoming: 0 })).toMatchObject({ tone: "short", need: 31, have: 23, short: 8, text: "You'll need about 31 — you have 23. Order 8 more." });
    expect(forecastLine({ need: 15, onHand: 16.508, incoming: 0 })).toMatchObject({ tone: "ok", text: "You'll need about 15 — you have 16." });
    expect(forecastLine({ need: 20, onHand: 4, incoming: 20 })).toMatchObject({ tone: "coming", text: "You'll need about 20 — you have 4 + 20 coming." });
    expect(forecastLine({ need: 0, onHand: 3, incoming: 0 }).tone).toBe("idle");
    expect(forecastLine({ need: 12, onHand: 0, incoming: 0 }, true).tone).toBe("opening");
  });

  it("the tab shows the summary line and never prints a fraction", () => {
    const g = played();
    expect(g.stock.some((s) => !Number.isInteger(s.qty))).toBe(true); // the bug: fractional stock after service
    const needs = stockNeeds(content, g);
    render(<StockTab game={g} send={noop} needs={needs} />);
    const line = screen.getByTestId("stock-forecast");
    expect(line.textContent).toMatch(/Next service: about \d+ guests\./);
    // Round 11 (D): the sheet lists what the menu uses (and what's on hand / coming) until "Show everything".
    const rows = () => document.querySelectorAll(".stocktable tbody tr").length;
    const relevant = needs.filter((n) => n.usedBy.length > 0 || n.onHand > 0 || n.incoming > 0).length;
    expect(rows()).toBe(relevant);
    if (relevant < needs.length) fireEvent.click(screen.getByRole("button", { name: /^Show everything \(\d+ more\)$/ }));
    expect(rows()).toBe(needs.length);
    const shown = [...document.querySelectorAll(".stocktable tbody td:nth-child(2) b")].map((b) => b.textContent);
    expect(shown.every((t) => /^\d+$/.test(t!))).toBe(true);
    for (const n of needs) {
      const cell = screen.getByTestId(`forecast-${n.ingredientId}`);
      expect(cell.textContent).not.toMatch(/\d\.\d/);
      expect(cell.textContent).toContain(forecastLine(n).text);
    }
    const short = needs.filter((n) => forecastLine(n).tone === "short").length;
    if (short) expect(line.textContent).toContain(`${short} thing`);
  });
});

describe("Staff tab: the week strip shows doubled-up shifts", () => {
  const chefs = [person("c1", "Ana Lee", "chef", ALL, 1500), person("c2", "Bo Diaz", "chef", WEEKEND, 1300), person("s1", "Cy Oak", "server", ALL)];

  it("rotaWeek/doubledShifts: two chefs Fri–Sun, the extra costs the cheaper shift each day", () => {
    const rows = rotaWeek(chefs);
    expect(rows.map((r) => r.role)).toEqual(["chef", "server"]);
    expect(rows[0]!.cells.map((c) => c.doubled)).toEqual([false, false, false, false, true, true, true]);
    expect(rows[1]!.cells.every((c) => c.people.length === 1)).toBe(true);
    const d = doubledShifts(chefs);
    expect(d).toEqual([{ role: "chef", days: [4, 5, 6], weeklyExtra: 3 * shiftCost(chefs[1]!) }]);
  });

  it("highlights the doubled cells and the empty ones, says so in words, and turns red after a losing fortnight", () => {
    const g = { ...played(), staff: [...chefs, person("s2", "Di Fox", "server", [true, false, false, false, false, false, false])].slice(0, 3) };
    const noServerSun = { ...g, staff: [chefs[0]!, chefs[1]!, person("s1", "Cy Oak", "server", [true, true, true, true, true, true, false])] };
    render(<RotaWeek game={noServerSun} today={0} />);
    const cells = [...document.querySelectorAll(".rotaweek__row:nth-child(2) [role=cell]")].map((c) => c.getAttribute("data-state"));
    expect(cells).toEqual(["one", "one", "one", "one", "doubled", "doubled", "doubled"]);
    const servers = [...document.querySelectorAll(".rotaweek__row:nth-child(3) [role=cell]")].map((c) => c.getAttribute("data-state"));
    expect(servers.at(-1)).toBe("empty");
    expect(screen.getByLabelText(/Friday: Ana Lee and Bo Diaz — 2 chefs on one day/)).toBeTruthy();
    expect(screen.getByLabelText(/Sunday: no server — you'll do it yourself/)).toBeTruthy();
    const note = screen.getByTestId("rota-doubled");
    expect(note.textContent).toMatch(/Two chefs on Fri, Sat and Sun/);
    expect(note.className).not.toMatch(/--bad/);
    cleanup();
    render(<RotaWeek game={{ ...noServerSun, history: days(14, () => ({ profit: -2_000 })) }} today={0} />);
    expect(screen.getByTestId("rota-doubled").className).toMatch(/rotaweek__note--bad/);
    expect(screen.getByTestId("rota-doubled").textContent).toMatch(/lost money for two weeks/);
  });

  it("the person cards mark the doubled days on their own rota buttons", () => {
    const g = { ...played(), staff: chefs };
    render(<StaffTab game={g} send={noop} />);
    const bo = screen.getByRole("group", { name: "Bo Diaz's rota" });
    const marked = within(bo).getAllByRole("button").map((b) => b.classList.contains("rota__day--doubled"));
    expect(marked).toEqual([false, false, false, false, true, true, true]);
    expect(within(bo).getAllByRole("button")[4]!.title).toMatch(/another chef is on too/);
    expect(screen.getByRole("region", { name: "This week's rota" })).toBeTruthy();
  });
});

describe("Evening: tonight's money as a figure a child can read", () => {
  it("lost / made with an arrow, against last night, and the last seven nights as bars", () => {
    const history = days(9, (i) => ({ profit: i === 8 ? -9_700 : 1_000 * i }));
    const g = { ...played(), history, cash: 1_212_800 } as GameState;
    render(<TonightMoney game={g} r={history.at(-1)!} />);
    const card = screen.getByRole("region", { name: "Tonight's money" });
    expect(card.className).toMatch(/tonight--down/);
    expect(card.textContent).toMatch(/Tonight you lost/);
    expect(card.querySelector("[data-pence]")!.getAttribute("data-pence")).toBe("9700");
    expect(card.textContent).toMatch(/£167 worse than last night/);
    expect(card.querySelectorAll(".tonight__col")).toHaveLength(7);
    expect(card.querySelector(".tonight__col.is-tonight .tonight__half--down i")).not.toBeNull();
    expect(screen.getByRole("img", { name: /Last 7 nights: .* lost £97$/ })).toBeTruthy();
    expect(versusYesterday(history)).toBe(-9_700 - 7_000);
    expect(lastNights(history).map((n) => n.day)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("MoneyText countUp keeps the final value in data-pence and the accessible name (no matchMedia here: no animation)", () => {
    render(<MoneyText pence={12_345} countUp="mount" />);
    const m = document.querySelector(".money")!;
    expect(m.getAttribute("data-pence")).toBe("12345");
    expect(m.getAttribute("aria-label")).toBe("£123.45");
    expect(m.textContent).toBe("£123.45");
  });
});

describe("GameOver: the cause in one sentence", () => {
  it("names wages and the doubled-up shifts when the rota rule holds", () => {
    const staff = [person("c1", "Ana Lee", "chef", ALL), person("c2", "Bo Diaz", "chef", WEEKEND)];
    const history = days(14, () => ({ revenue: 100_000, labourCost: 70_000, profit: -20_000 }));
    expect(gameOverCause({ history, staff })).toBe("You lost money on 14 of your last 14 days, mostly because wages took £7 of every £10 that came in (two chefs were often on the same shift).");
  });
  it("food, rent and an empty room get their own words", () => {
    expect(gameOverCause({ history: days(5, () => ({ foodCost: 60_000, labourCost: 10_000, profit: -1 })), staff: [] })).toMatch(/food took £6 of every £10/);
    expect(gameOverCause({ history: days(3, () => ({ rent: 80_000, foodCost: 1, labourCost: 1, profit: -1 })), staff: [] })).toMatch(/too few guests came to pay the rent/);
    expect(gameOverCause({ history: days(3, () => ({ revenue: 0, profit: -1 })), staff: [] })).toMatch(/hardly anyone came in/);
    expect(gameOverCause({ history: [], staff: [] })).toMatch(/never got going/);
  });
  it("renders the cause above the bank's rule, and plain buttons", () => {
    const g = { ...played(), history: days(14, () => ({ profit: -100 })) };
    render(<GameOver game={g} reason="Cash stayed below the bank's limit for 14 days." onRetrySameSeed={noop} onNewSeed={noop} onTitle={noop} />);
    expect(screen.getByTestId("gameover-cause").textContent).toMatch(/^You lost money on 14 of your last 14 days/);
    expect(screen.getByRole("button", { name: "Play this start again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New game" })).toBeTruthy();
    expect(screen.queryByText(/seed/i)).toBeNull();
  });
});

describe("Service + the day's beats", () => {
  it("hourTrend: what changed over the last hour of ticks, nothing in the first hour", () => {
    const m = new Map<number, number>([[0, 0], [5, 2], [HOUR_TICKS + 5, 9]]);
    expect(hourTrend(m, HOUR_TICKS - 1, 3)).toBeUndefined();
    expect(hourTrend(m, HOUR_TICKS + 5, 9)).toBe(7);
  });
  it("DayRhythm marks the current beat and ticks the ones done", () => {
    render(<DayRhythm beat="service" weekday="Thursday" />);
    const now = document.querySelector("[aria-current=step]")!;
    expect(now.textContent).toMatch(/Thursday · Service/);
    expect(document.querySelectorAll(".dayrhythm__beat.is-done")).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Thursday: Service, step 2 of 3" })).toBeTruthy();
  });
});
