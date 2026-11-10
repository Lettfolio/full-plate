/**
 * Round 11b: the player is 14, not 10. Real drinks by default, Normal by default, trade words back (tipped), terms
 * underlined once, goals that calm down after the first week.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { content } from "../sim";
import { DEFAULT_SETTINGS, getSettings, resetSettingsCache, setSettings, SETTINGS_KEY, startSpeed } from "../lib/settings";
import { resetTermsSeen, Term } from "../components/Term";
import { GoalsCard } from "../components/GoalsCard";
import { goalsQuiet, GOALS_QUIET_DAY } from "../lib/goals";
import { StartPicker } from "../screens/StartPicker";
import type { Goal } from "@full-plate/sim-core";

const noop = () => {};
afterEach(() => { cleanup(); localStorage.clear(); resetSettingsCache(); resetTermsSeen(); });
beforeEach(() => { localStorage.clear(); resetSettingsCache(); resetTermsSeen(); });

describe("defaults for a 14-year-old", () => {
  it("real drinks, underline once; a stored drinks choice is kept either way", () => {
    expect(DEFAULT_SETTINGS.noGrownUpDrinks).toBe(false);
    expect(DEFAULT_SETTINGS.underlineTerms).toBe("first");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ noGrownUpDrinks: true }));
    resetSettingsCache();
    expect(getSettings().noGrownUpDrinks).toBe(true);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: false }));
    resetSettingsCache();
    expect(getSettings().noGrownUpDrinks).toBe(false);
  });

  it("the start picker opens on Normal, and a Normal game starts its services at 1× until a speed is picked", () => {
    render(<StartPicker content={content} onBack={noop} onOwner={noop} onCareer={noop} />);
    expect(screen.getByRole("radio", { name: /^Normal/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /^Cosy/ }).getAttribute("aria-checked")).toBe("false");
    expect(startSpeed(DEFAULT_SETTINGS, "normal")).toBe(1);
    expect(startSpeed(DEFAULT_SETTINGS, "cosy")).toBe(4); // Cosy keeps its 4× start
  });
});

describe("glossary words are underlined once", () => {
  it("the first copy of a word keeps its dotted underline; later copies are plain but still tipped and tappable", () => {
    const { container } = render(<p><Term id="margin" inline>margin</Term> <Term id="margin" inline>margin</Term> <Term id="covers" inline>covers</Term></p>);
    const [a, b, c] = [...container.querySelectorAll<HTMLElement>(".term")];
    expect(a!.classList.contains("term--quiet")).toBe(false);
    expect(b!.classList.contains("term--quiet")).toBe(true);
    expect(c!.classList.contains("term--quiet")).toBe(false);
    for (const t of [a, b, c]) {
      expect(t!.getAttribute("tabindex")).toBe("-1");
      expect(t!.querySelector(".term__tip")!.textContent).toMatch(/: .{10,}/);
    }
    // A tap (focus) on the first one: it has been seen, so it goes quiet too.
    act(() => { a!.focus(); });
    expect(a!.classList.contains("term--quiet")).toBe(true);
  });

  it("stays plain on a re-render, and Settings › Always brings every underline back", () => {
    const view = <p><Term id="margin" inline>m1</Term><Term id="margin" inline>m2</Term></p>;
    const { container, rerender } = render(view);
    rerender(view);
    const quiet = () => [...container.querySelectorAll(".term")].map((t) => t.classList.contains("term--quiet"));
    expect(quiet()).toEqual([false, true]);
    act(() => setSettings({ underlineTerms: "always" }));
    expect(quiet()).toEqual([false, false]);
  });
});

describe("the goals card calms down after the first week", () => {
  const goal = (id: string, done: boolean): Goal => ({ id, kind: "add_dishes", title: id, hint: "h", target: 1, progress: done ? 1 : 0, done, tier: 0 });
  it("goalsQuiet: from day 8 (index 7) or once five goals are done", () => {
    expect(goalsQuiet(0, [])).toBe(false);
    expect(goalsQuiet(GOALS_QUIET_DAY - 1, [goal("a", true)])).toBe(false);
    expect(goalsQuiet(GOALS_QUIET_DAY, [])).toBe(true);
    expect(goalsQuiet(2, ["a", "b", "c", "d", "e"].map((x) => goal(x, true)))).toBe(true);
  });
  it("quiet: no spotlight, the done-goal flash is off, and Show me stays", () => {
    const goals = [goal("open", false)];
    const { container, rerender } = render(<GoalsCard goals={goals} spotlight onShow={noop} />);
    expect(container.querySelector(".goals--spotlight")).toBeTruthy();
    rerender(<GoalsCard goals={goals} spotlight quiet onShow={noop} />);
    expect(container.querySelector(".goals--spotlight")).toBeNull();
    expect(container.querySelector(".goals--quiet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show me" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
  });
});
