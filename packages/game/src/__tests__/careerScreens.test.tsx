/** Round 4: the career screens — progress checklist and station on My shift; the end-of-shift score card. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PLAYER_ID } from "@full-plate/sim-career";
import { MyShift } from "../screens/career/MyShift";
import { weekdayOf } from "../sim";
import { careerChefStart } from "./handsOnHarness";

afterEach(cleanup);

describe("My shift (round 4)", () => {
  it("shows the promotion checklist as progress meters, today's station and why promotion is greyed out", () => {
    const s = careerChefStart(5);
    const career = s.meta.career!;
    const game = s.game!;
    const working = !!game.staff.find((x) => x.id === PLAYER_ID)?.rota[weekdayOf(game.day)];
    render(<MyShift game={game} meta={s.meta} career={career} sendCareer={() => {}} send={() => {}} />);
    expect(screen.getByText(/of 4 ticked/)).toBeTruthy();
    expect(screen.getAllByRole("meter", { name: /Shifts at this rung: 0 of 10/ }).length).toBe(1);
    expect(screen.getByText(/play your shifts hands-on to learn faster/)).toBeTruthy();
    const ask = screen.getByRole("button", { name: "Ask for a promotion" }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    expect(ask.title).toMatch(/^Tick every box first — still to do: .*shifts at this rung/);
    expect(working).toBe(true);
    expect(screen.getByText(/Your station:/)).toBeTruthy();
  });
});
