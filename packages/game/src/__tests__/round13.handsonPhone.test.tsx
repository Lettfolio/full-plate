/**
 * Round 13 (C): the hands-on shift on a phone — the layout the shift picks, the canvas options each layout passes,
 * drag-to-steer, the haptics gate, the three-card phone how-to (once per role, never again), and that turning the
 * phone mid-shift keeps the same canvas.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createFixture, createSession, NO_INPUT, updateSession, type HandsOnResult } from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { HandsOnShift, resultBuzz, stageView } from "../screens/HandsOnShift";
import { handsOnLayout, layoutView, markPhoneHowToSeen, phoneHowToKey, phoneHowToSeen, PHONE_HIT_SLOP } from "../screens/handsonPhone";
import { phoneHowToCards } from "../screens/HandsOnHowTo";
import { createTouchControl, dragStick } from "../lib/touchControl";
import { BUZZ, buzz, canBuzz } from "../lib/haptics";
import { resetSettingsCache, setSettings } from "../lib/settings";
import { setCanvasBrand } from "../canvas/brand";
import { PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY } from "../lib/layout";
import { careerChefStart } from "./handsOnHarness";

/** A matchMedia whose phone queries we flip; listeners fire on change, as a real rotation does. */
let mode: "desk" | "sideways" | "upright" = "desk";
const listeners = new Set<() => void>();
function setMode(m: typeof mode) { mode = m; for (const l of [...listeners]) l(); }

beforeAll(() => {
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  window.matchMedia = ((q: string) => ({
    get matches() { return (q === PHONE_LANDSCAPE_QUERY && mode === "sideways") || (q === PHONE_PORTRAIT_QUERY && mode === "upright"); },
    media: q, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
beforeEach(() => { mode = "desk"; localStorage.clear(); resetSettingsCache(); });
afterEach(() => { cleanup(); localStorage.clear(); resetSettingsCache(); });

function mountShift(role: "chef" | "server" = "chef") {
  const app = careerChefStart(5);
  const game = { ...app.game!, phase: "service" as const };
  return render(<HandsOnShift game={game} role={role} playerStaffId={PLAYER_ID} jumpIn={false} runTicks={() => {}} sendResults={() => {}} onSkip={() => {}} onDone={() => {}} />);
}

describe("layouts", () => {
  it("picks desk / sideways / upright from phone.css's two queries, and tells the canvas what each needs", () => {
    expect(handsOnLayout()).toBe("desk");
    setMode("sideways"); expect(handsOnLayout()).toBe("sideways");
    setMode("upright"); expect(handsOnLayout()).toBe("upright");
    expect(layoutView("desk")).toEqual({});
    expect(layoutView("sideways")).toEqual({ compact: true, hitSlop: PHONE_HIT_SLOP });
    expect(layoutView("upright")).toEqual({ compact: true, follow: true, hitSlop: PHONE_HIT_SLOP });
  });

  it("the canvas view dresses staff in the house uniform (brandLook), and leaves them be with no brand", () => {
    const look = { body: "#ffffff", skin: "#f0c0a0", hair: "#332211", trim: "#ff0000" };
    setCanvasBrand(null);
    expect(stageView({ width: 700, height: 390 }, "sideways").dress!("server", look)).toEqual(look);
    setCanvasBrand({ uniform: "tee", colour: "#123456", accent: "#abcdef" });
    expect(stageView({ width: 700, height: 390 }, "sideways").dress!("server", look)).toMatchObject({ body: "#123456", hatColour: "#123456" });
    expect(stageView({ width: 700, height: 390 }, "desk").dress!("chef", look)).toMatchObject({ trim: "#123456", body: "#ffffff" });
    setCanvasBrand(null);
  });
});

describe("drag to steer", () => {
  it("a short wobble is still a tap; past it, the direction is kept and the speed ramps to full", () => {
    expect(dragStick(5, 5)).toBeNull();
    const a = dragStick(20, 0)!;
    expect(a.y).toBe(0);
    expect(a.x).toBeGreaterThanOrEqual(0.25); // above the session's 0.2 dead zone: she moves at once
    const b = dragStick(0, -200)!;
    expect(b.x).toBeCloseTo(0); expect(b.y).toBe(-1);
    const c = dragStick(30, 40)!;
    expect(c.x / c.y).toBeCloseTo(0.75);
  });

  it("the stick overrides tap-to-walk and she walks its way; lifting stops her", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    let s = createSession(f.state, "chef");
    const ctl = createTouchControl();
    expect(ctl.press(s, { kind: "station", stationId: "pass" })).toBe("walk");
    ctl.stick({ x: 1, y: 0 });
    expect(ctl.target).toBeUndefined();
    const x0 = s.player.x;
    for (let i = 0; i < 30; i++) s = updateSession(s, f.state, { ...NO_INPUT, ...(ctl.read(s) ?? {}) }, 1 / 60).session;
    expect(s.player.x).toBeGreaterThan(x0 + 0.5);
    ctl.release();
    expect(ctl.read(s)).toBeNull();
  });
});

describe("haptics", () => {
  it("buzzes only where the phone can, with Sound and Buzz both on", () => {
    const vibrate = vi.fn(() => true);
    const nav = navigator as unknown as { vibrate?: unknown };
    const had = nav.vibrate;
    nav.vibrate = undefined;
    expect(canBuzz()).toBe(false);
    expect(buzz(BUZZ.tap)).toBe(false);
    nav.vibrate = vibrate;
    expect(buzz(BUZZ.tap)).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith(BUZZ.tap);
    setSettings({ sound: false });
    expect(buzz(BUZZ.done)).toBe(false);
    setSettings({ sound: true, haptics: false });
    expect(buzz(BUZZ.done)).toBe(false);
    expect(vibrate).toHaveBeenCalledTimes(1);
    nav.vibrate = had;
  });

  it("a dropped item feels different from a plate going out", () => {
    const plate = { type: "PLATE_COOKED", ticketId: "t", quality: 80, execution: 0.9, station: "stove", speedBonus: 0 } as HandsOnResult;
    expect(resultBuzz([plate])).toBe(BUZZ.done);
    expect(resultBuzz([plate, { type: "DROPPED", cost: 100, item: "raw" }])).toBe(BUZZ.oops);
    expect(resultBuzz([{ type: "TICKET_CLAIMED", ticketId: "t" }])).toBeUndefined();
  });
});

describe("the phone how-to", () => {
  it("three cards for every role, the chef's naming the rail and the pass with glossary words", () => {
    for (const role of ["chef", "server", "bar"] as const) for (const l of ["sideways", "upright"] as const) expect(phoneHowToCards(role, l)).toHaveLength(3);
    const { container } = render(<>{phoneHowToCards("chef", "sideways", { label: "Desserts" }).map((c, i) => <p key={i}>{c.body}</p>)}</>);
    expect(container.querySelector('[data-term-id="ticketRail"]')).toBeTruthy();
    expect(container.querySelector('[data-term-id="pass"]')).toBeTruthy();
    expect(phoneHowToCards("chef", "upright")[0]!.title).toBe("Walk");
  });

  it("is remembered once per role on this device, under the account-mirrored onboarding prefix", () => {
    expect(phoneHowToKey("chef")).toBe("full-plate:onboard:v1:phone:chef");
    expect(phoneHowToSeen(localStorage, "chef")).toBe(false);
    markPhoneHowToSeen(localStorage, "chef");
    expect(phoneHowToSeen(localStorage, "chef")).toBe(true);
    expect(phoneHowToSeen(localStorage, "server")).toBe(false);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(phoneHowToSeen(broken, "chef")).toBe(false);
    expect(() => markPhoneHowToSeen(broken, "chef")).not.toThrow();
  });

  it("sideways: the deck replaces the spotlight steps, Skip ends it, and a new save on this phone doesn't show it again", () => {
    setMode("sideways");
    const first = mountShift();
    expect(screen.getByRole("dialog", { name: "Walk" })).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Do the job" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    localStorage.removeItem("full-plate:onboard:v1:chef:" + careerChefStart(5).game!.seed); // as if another save
    mountShift();
    expect(screen.queryByRole("dialog")).toBeNull();
    // "?" brings it back
    fireEvent.click(screen.getByRole("button", { name: "How to play" }));
    expect(screen.getByRole("dialog", { name: "Walk" })).toBeTruthy();
  });
});

describe("HandsOnShift on a phone", () => {
  it("sideways: thumb columns — Pause, Skip and Drop on the left, USE on the right — and no top bar", () => {
    setMode("sideways");
    markPhoneHowToSeen(localStorage, "chef");
    mountShift();
    const left = document.querySelector(".handson__side--l")!, right = document.querySelector(".handson__side--r")!;
    expect(left.querySelector('[aria-label="Pause"]')).toBeTruthy();
    expect(left.querySelector('[aria-label="Skip to end of shift"]')).toBeTruthy();
    expect(left.querySelector(".handson__drop")).toBeTruthy();
    expect(right.querySelector(".handson__use")).toBeTruthy();
    expect(document.querySelector(".handson__bar")).toBeNull();
    expect(document.querySelector(".handson--sideways.handson--touch")).toBeTruthy();
  });

  it("upright: a slim bar, the drag pad, Drop and USE under the kitchen", () => {
    setMode("upright");
    markPhoneHowToSeen(localStorage, "chef");
    mountShift();
    expect(document.querySelector(".handson__bar .handson__clock")).toBeTruthy();
    expect(document.querySelector(".handson__bar .clock__track")).toBeNull();
    const controls = document.querySelector(".handson__controls")!;
    expect(controls.querySelector(".handson__stick")).toBeTruthy();
    expect(controls.querySelector(".handson__use")).toBeTruthy();
    expect(controls.querySelector(".handson__drop")).toBeTruthy();
  });

  it("turning the phone mid-shift keeps the very same canvas and stage (the frame loop holds them)", () => {
    markPhoneHowToSeen(localStorage, "chef");
    localStorage.setItem("full-plate:onboard:v1:chef:" + careerChefStart(5).game!.seed, "1");
    mountShift();
    const canvas = document.querySelector("canvas")!, stage = document.querySelector(".handson__stage")!;
    act(() => setMode("sideways"));
    expect(document.querySelector(".handson--sideways")).toBeTruthy();
    expect(document.querySelector("canvas")).toBe(canvas);
    act(() => setMode("upright"));
    expect(document.querySelector(".handson--upright")).toBeTruthy();
    expect(document.querySelector("canvas")).toBe(canvas);
    expect(document.querySelector(".handson__stage")).toBe(stage);
    act(() => setMode("desk"));
    expect(document.querySelector("canvas")).toBe(canvas);
  });

  it("no page scroll or zoom during a shift: html gets fp-handson, and loses it after", () => {
    const r = mountShift();
    expect(document.documentElement.classList.contains("fp-handson")).toBe(true);
    r.unmount();
    expect(document.documentElement.classList.contains("fp-handson")).toBe(false);
  });
});
