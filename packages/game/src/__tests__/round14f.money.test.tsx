/**
 * Round 14 (F): money words that match her numbers.
 * U9 — one tap on tonight's profit explains profit vs cash (stock used vs stock bought).
 * U13 — the first-wage loan card says when it goes, says so once it has, and game over names the real cause.
 * U14 — a losing month can't score 2+ stars unless it improved; no "trim the rota" with nobody on it.
 * U16 — the lease screen adds up: savings + loan − fit-out − deposit = day 1's cash.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { applyCommand, content, hireShortfall, newGame, runStrategyDay, starterLoanOffer, STARTER_LOAN_MAX, STRATEGIES } from "../sim";
import { baseGame } from "./fixtures/round2";
import { Evening, profitVsCash } from "../screens/Evening";
import { StarterLoanTip, loanFloor } from "../components/BankCards";
import { loanGone } from "../components/Bank";
import { bustLead, GameOver } from "../screens/GameOver";
import { chapterScore } from "../screens/ChapterCard";
import { LeaseMoney, leaseSums } from "../components/LeaseMoney";

afterEach(cleanup);
const noop = () => {};

function playedEvening(): { game: GameState; r: DayResult } {
  let g = baseGame(31);
  for (let i = 0; i < 3; i++) g = runStrategyDay(content, g, STRATEGIES.typical);
  // the evening of the third day: the state still holds tonight's numbers
  const r = g.history.at(-1)!;
  return { game: { ...g, day: r.day, phase: "evening" }, r };
}

describe("Round 14 F — U9 profit vs cash", () => {
  it("one tap on the profit figure shows stock used tonight vs stock bought today, in her numbers", () => {
    const { game, r } = playedEvening();
    const withOrder = applyCommand(content, { ...game, phase: "planning" }, { type: "ORDER_STOCK", ingredientId: content.ingredients[0]!.id, qty: 10 }).state;
    const g = { ...withOrder, phase: "evening" as const };
    const pc = profitVsCash(g, r);
    expect(pc.used).toBe(r.foodCost + r.waste.prep + r.waste.spoil);
    expect(pc.bought).toBe(g.orders.reduce((a, o) => a + o.cost, 0));
    expect(pc.bought).toBeGreaterThan(0);
    render(<Evening game={g} result={r} onNext={noop} nextLabel="Next day" send={noop} />);
    expect(screen.queryByTestId("profit-why")).toBeNull();
    const btn = screen.getByTestId("profit-why-btn");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const why = screen.getByTestId("profit-why").textContent!;
    expect(why).toMatch(/Profit counts the £[\d,]+ of stock you cooked or binned tonight/);
    expect(why).toMatch(/Cash moves when you pay: .* you've ordered £[\d,]+ today/);
    expect(why.split(".").length).toBeLessThanOrEqual(4); // two lines, not a lecture
  });
});

describe("Round 14 F — U13 the first-wage loan and game over", () => {
  /** No staff, on Normal, with this much cash. */
  const broke = (cash: number): GameState => ({ ...baseGame(31), day: 6, history: [{ day: 5 } as DayResult], cash });

  it("while the loan is on offer the card says when it goes", () => {
    const g = broke(0);
    const s = hireShortfall(g)!;
    expect(starterLoanOffer(content, g)).not.toBeNull();
    render(<StarterLoanTip game={g} send={noop} />);
    const when = screen.getByTestId("starter-loan-when").textContent!;
    expect(when).toMatch(/goes if your cash drops below/);
    // and the threshold is the real one: just below it, the sim stops offering it
    const floor = loanFloor(s.needed);
    expect(starterLoanOffer(content, { ...g, cash: floor })).not.toBeNull();
    expect(starterLoanOffer(content, { ...g, cash: floor - 10_000 })).toBeNull();
  });

  it("once the gap passes the bank's most, the card says it has gone and how to get it back", () => {
    const g = broke(-STARTER_LOAN_MAX - 200_000);
    expect(starterLoanOffer(content, g)).toBeNull();
    expect(loanGone(g)).toBe(true);
    render(<StarterLoanTip game={g} send={noop} />);
    expect(screen.getByTestId("starter-loan-gone").textContent).toMatch(/first-wage loan has gone.*Get your cash back above/);
    // after borrowing, or with staff, it isn't "gone" (it was used or isn't needed)
    expect(loanGone({ ...g, starterLoan: true } as GameState)).toBe(false);
  });

  it("going bust with no staff says so on the game-over screen", () => {
    let g = newGame(content, { type: "NEW_GAME", seed: 9, districtId: content.districts[0]!.id, restaurantName: "Alone", difficulty: "normal" });
    for (let i = 0; i < 400 && g.phase !== "gameover"; i++) g = runStrategyDay(content, g, STRATEGIES.nohire);
    expect(g.phase).toBe("gameover");
    expect(g.staff.length).toBe(0);
    expect(bustLead(g)!.kinds).toContain("noStaff");
    render(<GameOver game={g} reason={null} onRetrySameSeed={noop} onNewSeed={noop} onTitle={noop} />);
    expect(screen.getByTestId("gameover-lead").textContent).toMatch(/You had no staff/);
  }, 120_000);

  it("names an empty larder, and stays quiet when wages or rent tell the story", () => {
    const day = (d: number, over: Partial<DayResult>): DayResult => ({ day: d, covers: 40, profit: -100, perDish: { a: { sold: 40, plated: 40, qualityMean: 60, revenue: 1, foodCost: 1 } }, ...over } as DayResult);
    const empty = Array.from({ length: 14 }, (_, i) => day(i, i % 2 ? { covers: 0, perDish: {} } : {}));
    expect(bustLead({ history: empty, staff: [{}] as never })!.kinds).toEqual(["noStock"]);
    expect(bustLead({ history: Array.from({ length: 14 }, (_, i) => day(i, {})), staff: [{}] as never })).toBeUndefined();
  });
});

describe("Round 14 F — U14 chapter stars match the month", () => {
  const month = (profit: (d: number) => number, over: Partial<DayResult> = {}): DayResult[] =>
    Array.from({ length: 30 }, (_, d) => ({ day: d, covers: 50, averageRating: 4.5, popularityDelta: 0.5, profit: profit(d), labourCost: 10_000, foodCost: 5_000, waste: { prep: 0, plate: 0, spoil: 0 }, ...over } as DayResult));

  it("a losing month scores 1 star however good the reviews (2 if it was getting better)", () => {
    expect(chapterScore(month(() => -20_000), 1, 12).stars).toBe(1); // −£6,000, 4.5★, popularity up
    expect(chapterScore(month((d) => (d < 15 ? -40_000 : -1_000)), 1, 12).stars).toBe(2); // still a loss, but improving
    const two = [...month(() => -40_000), ...month(() => -10_000).map((d) => ({ ...d, day: d.day + 30 }))];
    expect(chapterScore(two, 2, 12).stars).toBe(2);
    expect(chapterScore(month(() => 10_000), 1, 12).stars).toBe(5); // a profitable month is scored as before
  });

  it("the advice reads the month: no 'trim the rota' with nobody on it", () => {
    const alone = month(() => -20_000, { ownerCovered: ["chef", "server"], labourCost: 0 });
    const s = chapterScore(alone, 1, 12, 0);
    expect(s.next).not.toMatch(/rota/);
    expect(s.next).toMatch(/Hire a chef/);
    expect(chapterScore(month(() => -20_000, { labourCost: 50_000 }), 1, 12, 3).next).toMatch(/trim the rota/);
    expect(chapterScore(month(() => -20_000, { labourCost: 1, foodCost: 50_000 }), 1, 12, 3).next).toMatch(/margins/);
  });
});

describe("Round 14 F — U16 the lease money adds up", () => {
  it("savings + loan − fit-out − deposit = day 1's cash, for every district and difficulty", () => {
    for (const d of content.districts) for (const diff of ["cosy", "normal", "hard"] as const) {
      const m = leaseSums(d.id, diff);
      expect(m.savings + m.loan - m.fitOut - m.deposit).toBe(newGame(content, { type: "NEW_GAME", seed: 77, districtId: d.id, restaurantName: "Z", difficulty: diff }).cash);
      expect(m.deposit).toBeGreaterThan(0);
    }
    render(<LeaseMoney districtId={content.districts[0]!.id} difficulty="normal" />);
    const t = screen.getByTestId("lease-money").textContent!;
    for (const k of ["Your savings", "Bank loan", "fit-out", "Lease deposit", "Cash on day 1"]) expect(t).toContain(k);
  });
});
