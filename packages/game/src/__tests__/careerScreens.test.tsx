/** Round 4: the career screens — progress checklist and station on My shift; the end-of-shift score card. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PLAYER_ID } from "@full-plate/sim-career";
import { MyShift } from "../screens/career/MyShift";
import { CareerEvening } from "../screens/career/CareerEvening";
import { weekdayOf } from "../sim";
import { careerChefStart, playBotShift } from "./handsOnHarness";

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

describe("end-of-shift score card (round 4)", () => {
  it("after a played shift: big stars, three notes, and the week's progress toward promotion", () => {
    const r = playBotShift(careerChefStart(5), { skill: 0.55, pace: 0.5 });
    const s = r.app;
    expect(s.meta.shiftSummary).toBeDefined();
    render(<CareerEvening game={s.game!} meta={{ ...s.meta, shiftSummary: r.summary }} career={s.meta.career!} result={s.game!.history.at(-1)!} onNext={() => {}} />);
    const card = screen.getByRole("status", { name: /Shift score: [0-3] of 3 stars/ });
    expect(card.querySelectorAll(".shiftcard__star").length).toBe(3);
    expect(card.querySelectorAll(".shiftcard__star--on").length).toBe(r.summary.stars);
    expect(r.summary.stars).toBeGreaterThanOrEqual(1);
    expect(card.querySelectorAll(".shiftcard__note").length).toBe(3);
    expect(card.textContent).toMatch(/On the way to chef de partie/);
    expect(card.textContent).toMatch(/Shifts 1\/10/);
    expect(card.textContent).toMatch(/\+\d\.\d cooking skill tonight \(playing helped!\)/);
    expect(card.textContent).toMatch(/of 4 ticked/);
  }, 60_000);
});

describe("round 4 review: one cooking-skill number everywhere", () => {
  it("My shift's meter and the promotion checklist both round down (22.7 → 22, not 23 vs 22)", () => {
    const s = careerChefStart(5);
    const career = { ...s.meta.career!, stats: { ...s.meta.career!.stats, skill: 22.7 } };
    const { container } = render(<MyShift game={s.game!} meta={{ ...s.meta, career }} career={career} sendCareer={() => {}} send={() => {}} />);
    const meter = screen.getByRole("meter", { name: "Your cooking skill" });
    expect(meter.getAttribute("aria-valuenow")).toBe("22");
    expect(meter.parentElement!.querySelector(".bar__value")!.textContent).toBe("22");
    expect(container.textContent).toMatch(/learn faster\)\s*22\s*\/\s*30/);
  });
});

describe("round 4 review: the hands-on HUD names the commis station", () => {
  it("a career chef reads their station, not 'On the pass'; owners jumping in keep the role", async () => {
    const { shiftKicker } = await import("../screens/HandsOnShift");
    // Round 7: just the station's label (the canvas rail tag names the station), so the bar stays one line at 1024 px.
    expect(shiftKicker("chef", false, { title: "Commis station", label: "Sides · Desserts" })).toBe("Your shift · Sides · Desserts");
    expect(shiftKicker("chef", true)).toBe("Jumped in · On the pass");
    expect(shiftKicker("server", false)).toBe("Your shift · On the floor");
  });
});
