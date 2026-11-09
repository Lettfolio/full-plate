/**
 * Round 7 (C): the Stars hero (night strip, guide year), the Empire heroes (shops by city, regions, months), the
 * district verdict badge, the board card's pick ribbon, and the win screen's journey.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { guideYear, nightStrip } from "../lib/starsStrip";
import { EmpireTab, shopsByCity } from "../screens/paths/EmpireTab";
import { BoardMeeting } from "../screens/paths/BoardMeeting";
import { StarsTab } from "../screens/paths/StarsTab";
import { journey, WinScreen } from "../screens/WinScreen";
import { empireGame, withMeeting } from "./fixtures/empire";
import { appReducer } from "../state/gameReducer";

afterEach(cleanup);
const noop = () => {};

describe("Stars hero selectors", () => {
  it("nightStrip keeps the last 60 nights and marks off nights the way the sim counts them", () => {
    const w = Array.from({ length: 70 }, (_, i) => (i % 10 === 0 ? 60 : i % 10 === 5 ? 76 : 80));
    const days = w.map((_, i) => 400 + i);
    const s = nightStrip(w, days, 8, 60);
    expect(s.cells).toHaveLength(60);
    expect(s.cells[0]!.day).toBe(410);
    expect(s.cells.at(-1)!.day).toBe(469);
    // mean ≈ 77.6: 60 is an off night (< mean − 8), 76 is not even wobbly (> mean − 4), 80 is steady.
    expect(s.off).toBe(6);
    expect(s.steady + s.wobbly + s.off).toBe(60);
    expect(nightStrip([], undefined, 8).cells).toEqual([]);
  });

  it("guideYear puts today and the inspection season on the strip", () => {
    const y = guideYear(300, 420, undefined, 120);
    expect(y.inSeason).toBe(true);
    expect(y.seasonPct).toBeCloseTo(((300 - 55) / 365) * 100, 5);
    expect(guideYear(100, 420, undefined, 120).inSeason).toBe(false);
  });

  it("the Stars tab leads with the countdown, the hints and a strip of the kitchen's own nights", () => {
    const s = appReducer(empireGameAsOwner(), { type: "fork", choice: "stars" });
    const stars = { ...s.meta.stars!, consistencyWindow: [80, 81, 60, 80, 79], consistencyDays: [360, 361, 362, 363, 364] };
    const { container } = render(<StarsTab game={s.game!} meta={s.meta} stars={stars} send={noop} onTastingMenu={noop} />);
    const hero = screen.getByRole("region", { name: "Guide day" });
    expect(hero.textContent).toMatch(/days? to guide day/);
    expect(within(hero).getByRole("heading", { name: "What's holding you back" })).toBeTruthy();
    expect(container.querySelectorAll(".nights__cell--off").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/steady, \d+ wobbly, \d+ bad nights/)).toBeTruthy();
    // The hero comes before the other guides.
    const order = [...container.querySelectorAll(".starshero, .nights, .tracks")].map((el) => ["starshero", "nights", "tracks"].find((c) => el.classList.contains(c)));
    expect(order).toEqual(["starshero", "nights", "tracks"]);
  });
});

/** The empire fixture is an owner game before the fork, rebuilt: used here only for its played GameState. */
function empireGameAsOwner() {
  const s = empireGame();
  return { ...s, meta: { ...s.meta, empire: undefined, fork: { offered: true, firstOfferDay: s.game!.day } } };
}

describe("Empire heroes", () => {
  it("My shops: one bar per city, biggest first; tapping a row picks the city", () => {
    const s = empireGame();
    const e = s.meta.empire!;
    const rows = shopsByCity(e);
    expect(rows[0]!.cityId).toBe("harbourton");
    expect(rows[0]!.total).toBe(e.sites.filter((x) => x.cityId === "harbourton" && x.status === "open").length);
    render(<EmpireTab game={s.game!} meta={s.meta} empire={e} send={noop} onFocusSite={noop} />);
    const bars = screen.getByRole("list", { name: "Shops by city" });
    const btn = within(bars).getAllByRole("button")[0]!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: /^Shops in Harbourton/ })).toBeTruthy();
  });

  it("The brand: regions that know you, and the meals line; Money: HQ's last 30 days", () => {
    const s = empireGame();
    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={noop} onFocusSite={noop} />);
    fireEvent.click(screen.getByRole("tab", { name: /The brand/ }));
    expect(screen.getByLabelText("Brand summary").textContent).toMatch(/of 5 regions know your name/);
    expect(screen.getByRole("list", { name: /How many people know you/ }).querySelectorAll("li")).toHaveLength(s.meta.empire!.regions.length);
    fireEvent.click(screen.getByRole("tab", { name: /Money/ }));
    expect(screen.getByLabelText("Money summary").textContent).toMatch(/HQ (made|lost) in the last 30 days/);
  });

  it("each district's franchise verdict is a coloured badge", () => {
    const s = empireGame();
    const { container } = render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={noop} onFocusSite={noop} />);
    const badges = container.querySelectorAll(".verdict");
    if (s.meta.empire!.applicants.length) {
      expect(badges.length).toBeGreaterThan(0);
      for (const b of badges) expect(b.className).toMatch(/verdict--(fair|thin|loses)/);
    } else expect(badges.length).toBe(0);
  });

  it("the board card marks the board's pick on its option and dates the meeting", () => {
    const s = withMeeting(empireGame());
    const m = s.meta.empire!.boardMeeting!;
    const { container } = render(<BoardMeeting empire={s.meta.empire!} meeting={m} send={noop} />);
    const tip = container.querySelector(".boardmeeting__option--tip");
    expect(tip?.textContent).toContain(m.decision.options.find((o) => o.id === m.decision.advice)!.label);
    expect(container.querySelector(".boardmeeting__date")).toBeTruthy();
  });
});

describe("win screen", () => {
  it("shows the journey from opening day to the ending, in order", () => {
    const s = appReducer(empireGameAsOwner(), { type: "fork", choice: "stars" });
    const win = { kind: "dynasty" as const, won: true, day: s.game!.day + 400, title: "A dynasty", text: ["Three stars."] };
    const steps = journey(s.game!, s.meta, win);
    expect(steps[0]!.text).toMatch(/^Opened /);
    expect(steps.some((x) => x.text === "Chose to be the best")).toBe(true);
    expect(steps.at(-1)!.text).toBe("A dynasty");
    expect(steps.map((x) => x.day)).toEqual([...steps.map((x) => x.day)].sort((a, b) => a - b));
    render(<WinScreen game={s.game!} meta={s.meta} win={win} onKeepPlaying={noop} onTitle={noop} />);
    expect(screen.getByRole("list", { name: "Your journey" }).querySelectorAll("li")).toHaveLength(steps.length);
    expect(screen.getByRole("button", { name: /Save a picture/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep playing" })).toBeTruthy();
  });
});
