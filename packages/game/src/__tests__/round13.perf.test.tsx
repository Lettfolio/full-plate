/**
 * Round 13 (A): the floor's raster diet (canvas/stamps.ts: pre-drawn stamps and people as bitmaps, a build budget, LRU
 * caps), the per-pass profile hook, the slow-frame watch that eases the juice off (lib/floorLoad.ts) and its toast
 * link into Settings › Animations, and the one dpr cap. Nothing here touches the sim.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { advanceFixture, createFixture } from "@full-plate/handson";
import { PersonCache, snap, StampCache } from "../canvas/stamps";
import { MAX_FLOATIES, RestaurantView } from "../canvas/RestaurantView";
import { steam } from "../canvas/juice";
import { canvasDpr, MAX_CANVAS_DPR, passProfile } from "../lib/perfMeter";
import { createFloorLoad, EASED_NOTE, NOTE_KEY, noteDue, noteShown, SLOW_SHARE, SUSTAIN_MS, WINDOW } from "../lib/floorLoad";
import { Toast } from "../components/Toast";
import { loadSettingsBody, OPEN_SETTINGS_EVENT, SettingsMenu } from "../components/Settings";
import { resetSettingsCache } from "../lib/settings";
import { content } from "../sim";

/** A fake offscreen surface whose context records calls (so stamps can be "built" in jsdom). */
function fakeSurfaces() {
  const made: { w: number; h: number; calls: string[] }[] = [];
  const make = (w: number, h: number) => {
    const rec = { w, h, calls: [] as string[] };
    made.push(rec);
    const ctx = new Proxy({} as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : (...a: unknown[]) => { rec.calls.push(`${k}(${a.length})`); }), set: (o, k: string, v) => { o[k] = v; return true; } });
    return { width: w, height: h, getContext: () => ctx, transferToImageBitmap: () => ({ bitmap: rec, close() {} }) };
  };
  return { made, make };
}
function recorder() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : (...args: unknown[]) => { calls.push({ fn: k, args }); }), set: (o, k: string, v) => { o[k] = v; return true; } });
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

describe("StampCache (R13-A)", () => {
  it("draws a stamp once and blits it after; snapped to device pixels", () => {
    const { made, make } = fakeSurfaces();
    const stamps = new StampCache(make);
    const { calls, ctx } = recorder();
    let painted = 0;
    for (let i = 0; i < 5; i++) stamps.draw(ctx, "badge|1", 10.3, 20.6, 30, 30, 15, 15, 2, () => { painted++; });
    expect(painted).toBe(1);
    expect(stamps.builds).toBe(1);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ w: 60, h: 60 }); // 30 CSS px at dpr 2
    const blits = calls.filter((c) => c.fn === "drawImage");
    expect(blits).toHaveLength(5);
    expect(blits[0]!.args[1]).toBe(snap(10.3 - 15, 2));
    expect(blits[0]!.args[2]).toBe(snap(20.6 - 15, 2));
  });
  it("exact stamps keep the sub-pixel position (baked into the bitmap) and blit on whole device pixels", () => {
    const { make } = fakeSurfaces();
    const stamps = new StampCache(make);
    const { calls, ctx } = recorder();
    stamps.draw(ctx, "top", 100.37, 50.5, 40, 40, 20, 20, 1, () => {}, true);
    const b = calls.find((c) => c.fn === "drawImage")!;
    expect(b.args[1]).toBe(80); // floor(80.37)
    expect(b.args[2]).toBe(30);
    // a different fraction is a different stamp; the same one is reused
    stamps.draw(ctx, "top", 100.37, 50.5, 40, 40, 20, 20, 1, () => {}, true);
    stamps.draw(ctx, "top", 100.87, 50.5, 40, 40, 20, 20, 1, () => {}, true);
    expect(stamps.builds).toBe(2);
  });
  it("is capped (least recently used goes first) and clear() empties it", () => {
    const { make } = fakeSurfaces();
    const stamps = new StampCache(make, 3);
    const { ctx } = recorder();
    for (const k of ["a", "b", "c"]) stamps.draw(ctx, k, 0, 0, 4, 4, 0, 0, 1, () => {});
    stamps.draw(ctx, "a", 0, 0, 4, 4, 0, 0, 1, () => {}); // a is fresh again
    stamps.draw(ctx, "d", 0, 0, 4, 4, 0, 0, 1, () => {}); // evicts b
    expect(stamps.size).toBe(3);
    let rebuilt = 0;
    stamps.draw(ctx, "a", 0, 0, 4, 4, 0, 0, 1, () => { rebuilt++; });
    stamps.draw(ctx, "b", 0, 0, 4, 4, 0, 0, 1, () => { rebuilt++; });
    expect(rebuilt).toBe(1); // only b
    stamps.clear();
    expect(stamps.size).toBe(0);
  });
  it("with no offscreen surface it draws live (the same picture, uncached)", () => {
    const stamps = new StampCache(() => undefined);
    const { calls, ctx } = recorder();
    let painted = 0;
    stamps.draw(ctx, "x", 5, 5, 10, 10, 5, 5, 1, () => { painted++; });
    stamps.draw(ctx, "x", 5, 5, 10, 10, 5, 5, 1, () => { painted++; });
    expect(painted).toBe(2);
    expect(calls.some((c) => c.fn === "drawImage")).toBe(false);
  });
});

describe("PersonCache (R13-A)", () => {
  const look = { body: "#123456", skin: "#f1c9a5", hair: "#3b2a1f" };
  const pose = (phase: number) => ({ facing: "right" as const, moving: true, phase, outline: "#000" });
  it("past the frame's build budget a walker shows its last drawn frame instead of drawing a new one", () => {
    const { make } = fakeSurfaces();
    const people = new PersonCache(make, 900, 1);
    const { ctx } = recorder();
    people.frame();
    people.draw(ctx, 0, 0, 8, look, pose(0.1), 1); // frame 0: built (budget spent)
    people.draw(ctx, 0, 0, 8, { ...look, body: "#654321" }, pose(0.1), 1); // another person: must be drawn (nothing to stand in)
    people.draw(ctx, 0, 0, 8, look, pose(1.0), 1); // frame 1 of the first: deferred, shows frame 0
    expect(people.builds).toBe(2);
    expect(people.deferred).toBe(1);
    people.frame();
    people.draw(ctx, 0, 0, 8, look, pose(1.0), 1); // next frame: built
    expect(people.builds).toBe(3);
  });
  it("over its cap it drops the least recently used eighth, not everyone at once", () => {
    const { make } = fakeSurfaces();
    const people = new PersonCache(make, 16, 99);
    const { ctx } = recorder();
    people.frame();
    for (let i = 0; i < 17; i++) people.draw(ctx, 0, 0, 8, { ...look, body: `#0000${(i + 16).toString(16)}` }, { facing: "down", outline: "#000" }, 1);
    expect(people.size).toBe(15); // 17 − ⌈16/8⌉
  });
});

describe("profile hook and dpr cap (R13-A)", () => {
  afterEach(() => { (globalThis as { __fpPassProfile?: unknown }).__fpPassProfile = undefined; });
  it("passProfile() is off unless a playtest sets window.__fpPassProfile", () => {
    expect(passProfile()).toBeNull();
    (globalThis as { __fpPassProfile?: unknown }).__fpPassProfile = {};
    expect(passProfile()).toMatchObject({ ms: {}, frames: 0 });
  });
  it("one named cap: 2 device pixels per CSS pixel", () => {
    expect(MAX_CANVAS_DPR).toBe(2);
    const d = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    expect(canvasDpr()).toBe(2);
    Object.defineProperty(window, "devicePixelRatio", { value: d, configurable: true });
  });
});

describe("the floor with stamps (R13-A)", () => {
  const original = HTMLCanvasElement.prototype.getContext;
  const fills: string[] = [];
  beforeAll(() => {
    const grad = { addColorStop() {} };
    HTMLCanvasElement.prototype.getContext = function () {
      const t: Record<string, unknown> = {
        fillText: (s: string) => { fills.push(s); }, measureText: (s: string) => ({ width: s.length * 7 }),
        createLinearGradient: () => grad, createRadialGradient: () => grad, getImageData: () => ({ data: [0, 0, 0, 0] }),
      };
      return new Proxy(t, { get: (o, k: string) => (k in o ? o[k] : () => {}), set: (o, k: string, v) => { o[k] = v; return true; } });
    } as unknown as HTMLCanvasElement["getContext"];
  });
  afterAll(() => { HTMLCanvasElement.prototype.getContext = original; });
  function busy() {
    let f = createFixture({ role: "server", seed: 11 });
    for (let i = 0; i < 60 * 25; i++) f = advanceFixture(f, 1 / 60);
    return f.state;
  }
  it("renders, keeps labelling every table, and with the profile on times each pass", () => {
    const game = busy();
    const view = new RestaurantView(document.createElement("canvas"));
    view.resize(900, 640, 1);
    (globalThis as { __fpPassProfile?: unknown }).__fpPassProfile = {};
    fills.length = 0;
    for (let i = 0; i < 3; i++) view.render(game, { content, speed: 4, now: 1000 + i * 16 });
    for (let i = 1; i <= game.tables.length; i++) expect(fills).toContain(String(i));
    const p = passProfile()!;
    expect(p.frames).toBe(3);
    for (const k of ["scene", "glows", "kitchen", "tables", "staff", "people", "light", "overlay", "beats"]) expect(p.ms[k]).toBeGreaterThanOrEqual(0);
    (globalThis as { __fpPassProfile?: unknown }).__fpPassProfile = undefined;
  });
  it("lite juice draws one steam wisp where full draws three", () => {
    const { calls, ctx } = recorder();
    steam(ctx, 0, 0, 500, 1, 1, 0, 1);
    const lite = calls.filter((c) => c.fn === "arc").length;
    calls.length = 0;
    steam(ctx, 0, 0, 500, 1, 1, 0);
    const full = calls.filter((c) => c.fn === "arc").length;
    expect(lite).toBeLessThanOrEqual(1);
    expect(full).toBeGreaterThan(lite);
  });
  it("lite and full render the same people and labels (only the small effects thin out)", () => {
    const game = busy();
    const a = new RestaurantView(document.createElement("canvas")); a.resize(900, 640, 1);
    const b = new RestaurantView(document.createElement("canvas")); b.resize(900, 640, 1);
    fills.length = 0; a.render(game, { content, speed: 4, now: 1000, juice: "full" }); const full = [...fills];
    fills.length = 0; b.render(game, { content, speed: 4, now: 1000, juice: "lite" }); const lite = [...fills];
    expect(lite.filter((t) => /^\d+$/.test(t)).sort()).toEqual(full.filter((t) => /^\d+$/.test(t)).sort());
  });
  it("caps the notes in the air", () => {
    expect(MAX_FLOATIES).toBeGreaterThanOrEqual(8);
    expect(MAX_FLOATIES).toBeLessThanOrEqual(32);
  });
});

describe("slow-frame watch (R13-A)", () => {
  beforeEach(() => { localStorage.clear(); });
  const run = (load: ReturnType<typeof createFloorLoad>, gap: number, ms: number, t0: number, running = true) => {
    let t = t0;
    while (t < t0 + ms) { t += gap; load.frame(t, running); }
    return t;
  };
  it("a smooth floor stays full", () => {
    const load = createFloorLoad();
    run(load, 16.7, 10_000, 1000);
    expect(load.level).toBe("full");
    expect(load.slowShare).toBe(0);
  });
  it("sustained long frames switch it to lite once, and it says so once", () => {
    let said = 0;
    const load = createFloorLoad(() => { said++; });
    run(load, 33.4, SUSTAIN_MS + 4000, 1000);
    expect(load.level).toBe("lite");
    expect(said).toBe(1);
    run(load, 16.7, 5000, 20_000); // doesn't flip back within a service
    expect(load.level).toBe("lite");
  });
  it("a short stutter, paused time and very long gaps (tab switch) don't count", () => {
    const load = createFloorLoad();
    let t = run(load, 16.7, 2000, 1000);
    t = run(load, 33.4, 1000, t); // a second of stutter
    t = run(load, 16.7, 3000, t);
    expect(load.level).toBe("full");
    t = run(load, 40, 8000, t, false); // paused: ignored
    expect(load.level).toBe("full");
    for (let i = 0; i < 40; i++) { t += 400; load.frame(t, true); } // background tab: ignored
    expect(load.level).toBe("full");
    expect(WINDOW).toBeGreaterThan(30);
    expect(SLOW_SHARE).toBeGreaterThan(0);
  });
  it("the note is once per device (and survives blocked storage)", () => {
    expect(noteDue()).toBe(true);
    noteShown();
    expect(localStorage.getItem(NOTE_KEY)).toBe("1");
    expect(noteDue()).toBe(false);
    expect(EASED_NOTE).toMatch(/Animations/);
    expect(EASED_NOTE).not.toMatch(/!/);
  });
});

describe("toast link to Settings › Animations (R13-A)", () => {
  beforeAll(() => loadSettingsBody());
  beforeEach(() => { localStorage.clear(); resetSettingsCache(); });
  afterEach(cleanup);
  it("the toast's Settings button opens the sheet with the Animations switch focused", async () => {
    let dismissed = 0;
    render(<><SettingsMenu /><Toast toast={{ id: 1, text: EASED_NOTE, tone: "info", link: "animations" }} onDismiss={() => { dismissed++; }} /></>);
    // two "Settings" buttons: the header gear (aria-label) and the toast's link (text); take the toast's
    expect(screen.getAllByRole("button", { name: "Settings" })).toHaveLength(2);
    const toastLink = document.querySelector<HTMLButtonElement>(".toast__link")!;
    expect(toastLink.textContent).toBe("Settings");
    await act(async () => { fireEvent.click(toastLink); await new Promise((r) => setTimeout(r, 80)); });
    expect(dismissed).toBe(1);
    const sw = document.querySelector<HTMLInputElement>('[data-settings-row="animations"]');
    expect(sw).toBeTruthy();
    expect(document.activeElement).toBe(sw);
  });
  it("the open-settings event is handled once (by the mounted gear)", () => {
    render(<SettingsMenu />);
    const e = new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { row: "animations", handled: false } });
    act(() => { window.dispatchEvent(e); });
    expect((e.detail as { handled: boolean }).handled).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
