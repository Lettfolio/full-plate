/**
 * Round 7 (C): the shell — settings sheet (persistence, text size on <html>), the goal explainer, and the
 * "are you sure?" confirmations before a new game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsMenu } from "../components/Settings";
import { TitleScreen } from "../screens/TitleScreen";
import { GoalExplainer } from "../components/GoalExplainer";
import { ConfirmDialog } from "../components/Dialog";
import { DEFAULT_SETTINGS, getSettings, resetSettingsCache, SETTINGS_KEY } from "../lib/settings";
import { appReducer, initialAppState } from "../state/gameReducer";
import { content } from "../sim";

const fresh = () => appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 7, districtId: content.districts[0]!.id, restaurantName: "Rosie's", difficulty: "cosy" } }).game!;

beforeEach(() => {
  window.localStorage.clear();
  resetSettingsCache();
  document.documentElement.removeAttribute("data-text");
});
afterEach(cleanup);

const openSheet = () => fireEvent.click(screen.getByRole("button", { name: "Settings" }));

describe("settings sheet", () => {
  it("opens as a dialog and saves every choice to localStorage", () => {
    render(<SettingsMenu />);
    openSheet();
    const sheet = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(sheet).getByRole("radio", { name: /Bigger/ }));
    fireEvent.click(within(sheet).getByRole("radio", { name: /Off/ }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "2×" }));
    fireEvent.click(within(sheet).getByRole("checkbox"));
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(stored).toEqual({ autoPause: false, defaultSpeed: 2, sound: false, textSize: "large" });
    // A fresh read (as after a reload) gets the same values back.
    resetSettingsCache();
    expect(getSettings()).toEqual(stored);
  });

  it("old saved settings without the round-7 fields load with the defaults", () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoPause: false, defaultSpeed: 4 }));
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, autoPause: false, defaultSpeed: 4 });
  });

  it("text size sets data-text=\"large\" on <html> and removes it again", () => {
    render(<SettingsMenu />);
    openSheet();
    fireEvent.click(screen.getByRole("radio", { name: /Bigger/ }));
    expect(document.documentElement.getAttribute("data-text")).toBe("large");
    expect(screen.getByRole("radio", { name: /Bigger/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Normal/ }));
    expect(document.documentElement.hasAttribute("data-text")).toBe(false);
  });

  it("a saved large text size is applied on the first read (before the first paint)", () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ textSize: "large" }));
    getSettings();
    expect(document.documentElement.getAttribute("data-text")).toBe("large");
  });

  it("closes on Escape and on the close button", () => {
    render(<SettingsMenu />);
    openSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("save-and-quit goes straight to the title; a new game asks first", () => {
    const onQuit = vi.fn();
    const onNewGame = vi.fn();
    render(<SettingsMenu onQuit={onQuit} onNewGame={onNewGame} saveName="Rosie's · Day 21" />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /Start a new game/ }));
    const ask = screen.getByRole("alertdialog", { name: "Start a new game?" });
    expect(ask.textContent).toMatch(/Rosie's · Day 21/);
    // The safe answer is focused first, and it changes nothing.
    expect(document.activeElement?.textContent).toBe("Keep playing");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep playing" }));
    expect(onNewGame).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start a new game/ }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, start a new game" }));
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Save & quit" })); // R9: was "Save and go to the title screen"
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("during service there is no quit or new game, only a note", () => {
    render(<SettingsMenu />);
    openSheet();
    expect(screen.queryByRole("button", { name: /title screen|new game/i })).toBeNull();
    expect(screen.getByText(/Finish tonight's service first/)).toBeTruthy();
  });
});

describe("goal explainer", () => {
  it("opens from the title screen with both paths and closes again", () => {
    render(<TitleScreen saved={null} onNew={() => {}} onContinue={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /How do I win/ }));
    const d = screen.getByRole("dialog", { name: "How do I win?" });
    expect(within(d).getByRole("region", { name: "Be everywhere" }).querySelectorAll("li")).toHaveLength(3);
    expect(within(d).getByRole("region", { name: "Be the best" }).querySelectorAll("li")).toHaveLength(3);
    fireEvent.click(within(d).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("at the fork it says the year is done", () => {
    const close = vi.fn();
    render(<GoalExplainer atFork onClose={close} />);
    expect(screen.getByText(/You've run your restaurant for a whole year/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});

describe("title screen", () => {
  it("Continue is the big first button and carries the save; New game asks before replacing it", () => {
    const onNew = vi.fn();
    const onContinue = vi.fn();
    render(<TitleScreen saved={fresh()} onNew={onNew} onContinue={onContinue} />);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont.className).toMatch(/continue--primary/);
    expect(cont.textContent).toMatch(/Rosie's.*Day 1/);
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(onNew).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, start a new game" }));
    expect(onNew).toHaveBeenCalledTimes(1);
    fireEvent.click(cont);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("with no save, New game goes straight to the start picker", () => {
    const onNew = vi.fn();
    render(<TitleScreen saved={null} onNew={onNew} onContinue={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});

describe("confirm dialog", () => {
  it("Escape and the backdrop cancel", () => {
    const cancel = vi.fn();
    const ok = vi.fn();
    const { container } = render(<ConfirmDialog title="Sure?" body="x" confirmLabel="Yes" onConfirm={ok} onCancel={cancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(container.querySelector(".modal-back")!);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(ok).not.toHaveBeenCalled();
  });
});
