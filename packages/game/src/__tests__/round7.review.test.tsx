/**
 * Round 7 review: the seams between A (career/hands-on), B (owner loop) and C (shell/paths) after the merge.
 *  (a) the toast sits on the floor's top edge during service (never over the pavement queue)
 *  (b) a Term tip near the right edge opens leftwards (no sideways scroll while it shows)
 *  (d) keys while a sheet is open belong to the sheet: service shortcuts and the cook's keys stand down, the clocks hold;
 *      the inline remove asks with the safe answer focused, and Keep hands focus back to the ✕
 *  (e) the read-only career watch view has no Break buttons
 *  (f) UI prefs (text size, menu view, onboarding) live outside the sim save
 *  (h) the start picker's start button is pinned; the lease screen doesn't ask difficulty again
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { onControl } from "@full-plate/handson";
import type { GameState } from "@full-plate/sim-core";
import { applyCommand, content, runDay } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { baseGame } from "./fixtures/round2";
import { StaffStrip } from "../components/StaffStrip";
import { placeTip, Term } from "../components/Term";
import { toastPlacement } from "../components/Toast";
import { modalOpen } from "../lib/modal";
import { shortcutsBlocked } from "../screens/Service";
import { MenuTab } from "../screens/planning/MenuTab";
import { NewGame } from "../screens/NewGame";
import { StartPicker } from "../screens/StartPicker";
import { Dialog } from "../components/Dialog";
import { encodeSave } from "../state/save";
import { initialMeta } from "../state/paths";
import { getSettings, resetSettingsCache, setSettings } from "../lib/settings";

afterEach(cleanup);
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
const noop = () => {};

function played(): GameState {
  let g = baseGame(77);
  for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  g = runDay(content, g).state;
  return applyCommand(content, g, { type: "END_DAY" }).state;
}

describe("(a) toast placement", () => {
  it("sits 48 px under the top of the service floor, centred on it; elsewhere it keeps the bottom-centre default", () => {
    expect(toastPlacement({ top: 110, left: 16, width: 634, height: 600 } as DOMRect)).toEqual({ top: 158, left: 333 });
    expect(toastPlacement(null)).toBeNull();
    expect(toastPlacement({ top: 0, left: 0, width: 0, height: 0 } as DOMRect)).toBeNull();
  });
});

describe("(b) Term tips near the right edge", () => {
  const at = (left: number, right: number) => { const el = document.createElement("span"); el.getBoundingClientRect = () => ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}) }); return el; };
  it("flips left when the tip would run off the right edge, and not otherwise", () => {
    const w = document.documentElement.clientWidth || window.innerWidth; // jsdom: 1024
    const near = at(w - 60, w - 10); placeTip(near); expect(near.hasAttribute("data-flip")).toBe(true);
    const far = at(20, 80); placeTip(far); expect(far.hasAttribute("data-flip")).toBe(false);
    const narrow = at(w - 60, 120 > w ? w : 120); placeTip(narrow); // no room on either side: stays as it was (left-anchored)
  });
  it("hover and keyboard focus still reach the tip (the round-5 contract), and flip on the way", () => {
    render(<p><Term id="margin" inline /></p>);
    const t = document.querySelector(".term") as HTMLElement;
    t.getBoundingClientRect = () => ({ left: 990, right: 1020, top: 0, bottom: 20, width: 30, height: 20, x: 990, y: 0, toJSON: () => ({}) });
    expect(t.tabIndex).toBe(0);
    expect(document.getElementById(t.getAttribute("aria-describedby")!)!.getAttribute("role")).toBe("tooltip");
    fireEvent.focus(t);
    expect(t.hasAttribute("data-flip")).toBe(true);
  });
});

describe("(d) keys and focus around sheets", () => {
  it("an open sheet blocks the service shortcuts and the cook's keys; closed, they're back", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    expect(modalOpen()).toBe(false);
    expect(shortcutsBlocked(canvas)).toBe(false);
    expect(onControl({ target: canvas })).toBe(false);
    render(<Dialog title="Settings" onClose={noop}><p>hi</p></Dialog>);
    expect(modalOpen()).toBe(true);
    expect(shortcutsBlocked(canvas)).toBe(true); // Space would pause, 1/2/4 change speed behind the sheet
    const inside = screen.getByRole("dialog").querySelector("p")!;
    expect(onControl({ target: inside })).toBe(true); // WASD typed inside the sheet don't walk the cook
    cleanup();
    expect(modalOpen()).toBe(false);
    canvas.remove();
  });
  it("the hands-on onboarding is not a sheet (it has its own hold)", () => {
    render(<div role="dialog" aria-modal="false">onboarding</div>);
    expect(modalOpen()).toBe(false);
  });
  it("remove asks with Keep focused; Keep hands focus back to the ✕; Enter twice can't remove", () => {
    const g = played();
    const sent: unknown[] = [];
    render(<MenuTab game={g} send={(c) => sent.push(c)} />);
    const name = content.dishes.find((d) => d.id === g.menu[0]!.dishId)!.name;
    fireEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
    const ask = screen.getByRole("group", { name: `Remove ${name}?` });
    expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Keep" }));
    fireEvent.click(document.activeElement!); // the second Enter lands on Keep
    expect(sent).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: `Remove ${name}` }));
  });
});

describe("(e) the career watch view is read-only", () => {
  it("StaffStrip readOnly shows who's on, with no Break buttons (and still says who's resting)", () => {
    const g = baseGame();
    const wd = (g.day + 2) % 7;
    const s = { id: "s1", name: "Ada Server", role: "server" as const, skill: 50, speed: 50, charm: 50, mood: 60, fatigue: 80, wage: 1200, traits: [], hiredDay: 0, potential: 70, rota: Array.from({ length: 7 }, (_, i) => i === wd) };
    const t = { ...s, id: "s2", name: "Bo Chef", role: "chef" as const };
    render(<StaffStrip game={{ ...g, phase: "service", tick: 40, staff: [{ ...s, breakUntilTick: 46 }, t] }} send={noop} readOnly />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("☕ On break")).toBeTruthy();
    cleanup();
    render(<StaffStrip game={{ ...g, phase: "service", tick: 40, staff: [t] }} send={noop} />);
    expect(screen.getByRole("button", { name: /Give Bo a break/ })).toBeTruthy();
  });
});

describe("(f) UI prefs stay out of the sim save", () => {
  it("text size, the menu view and the onboarding flag are in their own keys; the save carries none of them", () => {
    setSettings({ textSize: "large", sound: false });
    localStorage.setItem("full-plate:menuView:v1", "matrix");
    localStorage.setItem("full-plate:onboard:v1:chef:77", "1");
    const g = played();
    const raw = encodeSave(g, initialMeta());
    for (const k of ["textSize", "sound", "menuView", "onboard"]) expect(raw).not.toContain(`"${k}"`);
    expect(getSettings().textSize).toBe("large");
    setSettings({ textSize: "normal", sound: true }); resetSettingsCache();
  });
});

describe("(h) start picker and lease", () => {
  it("the start button lives in the pinned action dock, with the choices summed up beside it", () => {
    render(<StartPicker content={content} onBack={noop} onOwner={noop} onCareer={noop} />);
    fireEvent.click(screen.getByRole("radio", { name: /^Apprentice chef/ }));
    const dock = document.querySelector(".startpick__go.actiondock") as HTMLElement;
    expect(within(dock).getByRole("button", { name: /Start as apprentice chef/ })).toBeTruthy();
    expect(dock.textContent).toMatch(/Apprentice chef · Cosy · /);
  });
  it("the lease screen reminds the difficulty picked on the picker (Change opens the picker); asks when it came without one", () => {
    render(<NewGame content={content} initialSeed={1} initialDifficulty="normal" onStart={noop} onBack={noop} />);
    expect(screen.queryByRole("radiogroup", { name: "How tricky?" })).toBeNull();
    expect(screen.getByText("Normal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("radiogroup", { name: "How tricky?" })).toBeTruthy();
    cleanup();
    render(<NewGame content={content} initialSeed={1} onStart={noop} onBack={noop} />);
    expect(screen.getByRole("radiogroup", { name: "How tricky?" })).toBeTruthy();
  });
});
