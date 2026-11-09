/** Round 5 review: the Evening's "trim the rota" tip (sim-core rotaAdvice) in a child's words. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DayResult, GameState, Staff } from "@full-plate/sim-core";
import { RotaTip, dayList } from "../screens/Evening";

afterEach(cleanup);
const staff = [
  { id: "c1", name: "Ana", role: "chef", wage: 1300, rota: [false, false, true, true, true, true, true] },
  { id: "c2", name: "Bo", role: "chef", wage: 1300, rota: [true, true, false, false, true, true, true] },
] as Staff[];
const game = (profit: number) => ({ staff, history: Array.from({ length: 14 }, (_, day) => ({ day, profit }) as DayResult) }) as unknown as GameState;

describe("RotaTip", () => {
  it("names the person, the doubled-up days and the weekly cost, with a button to the rota", () => {
    const go = vi.fn();
    render(<RotaTip game={game(-3_000)} onGoTo={go} />);
    const tip = screen.getByLabelText("Rota tip").textContent!;
    expect(tip).toMatch(/^📅Two weeks of losing money \(about £30 a day\)\./);
    expect(tip).toMatch(/Bo works Friday, Saturday and Sunday, when another chef is already on\. Those shifts cost £[\d,]+ a week\./);
    fireEvent.click(screen.getByRole("button", { name: /Change the rota/ }));
    expect(go).toHaveBeenCalledWith("staff");
  });

  it("stays quiet in a profitable fortnight", () => {
    const { container } = render(<RotaTip game={game(5_000)} />);
    expect(container.textContent).toBe("");
  });

  it("dayList reads like a sentence", () => {
    expect(dayList([5])).toBe("Saturday");
    expect(dayList([5, 6])).toBe("Saturday and Sunday");
  });
});
