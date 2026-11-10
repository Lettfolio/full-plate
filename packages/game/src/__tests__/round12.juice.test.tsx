/**
 * Round 12 (A): juice, animation and the soundtrack — the settings (Animations, Music, Sound effects), the shared
 * "may this move?" switch, the rush rule, the best-night line, the synthesiser (pieces, palettes, silence at volume 0),
 * the floor's beats, and the Settings rows. The sim is untouched (nothing here imports a sim system).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DayResult } from "@full-plate/sim-core";
import { advanceFixture, createFixture } from "@full-plate/handson";
import { DEFAULT_SETTINGS, getSettings, resetSettingsCache, SETTINGS_KEY, setSettings } from "../lib/settings";
import { CountUp, motionOk } from "../lib/motion";
import { rushNow } from "../screens/Service";
import { bestNightSoFar } from "../screens/Evening";
import { musicStatus, PALETTES, PIECES, SFX, sync, tuneNote } from "../lib/music";
import { playSfx, setRush, setSoundtrack } from "../lib/sfx";
import { drawBeats, lookAbout, stepUpDelay, GLOW_MS, PAID_MS, type Beat } from "../canvas/juice";
import { RestaurantView } from "../canvas/RestaurantView";
import { VolumeSlider } from "../components/VolumeSlider";
import { SettingsMenu } from "../components/Settings";
import { content } from "../sim";

beforeEach(() => { localStorage.clear(); resetSettingsCache(); });
afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-motion"); });

describe("settings (R12-A)", () => {
  it("defaults: animations on, music on at a modest level, effects louder", () => {
    expect(DEFAULT_SETTINGS.animations).toBe(true);
    expect(DEFAULT_SETTINGS.musicVolume).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.musicVolume).toBeLessThanOrEqual(0.5);
    expect(DEFAULT_SETTINGS.sfxVolume).toBeGreaterThan(DEFAULT_SETTINGS.musicVolume);
  });
  it("old stored settings load with the new defaults; bad volumes are clamped or replaced", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoPause: false, sound: true, musicVolume: 7, sfxVolume: "loud" }));
    const s = getSettings();
    expect(s.autoPause).toBe(false);
    expect(s.animations).toBe(true);
    expect(s.musicVolume).toBe(1);
    expect(s.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
  });
  it("Animations off sets data-motion=off on <html> and motionOk() says no", () => {
    setSettings({ animations: false });
    expect(document.documentElement.getAttribute("data-motion")).toBe("off");
    expect(motionOk()).toBe(false);
    setSettings({ animations: true });
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
  });
  it("motionOk() honours prefers-reduced-motion too", () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    expect(motionOk()).toBe(false);
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    expect(motionOk()).toBe(true);
    window.matchMedia = mm;
  });
  it("CountUp shows the final value at once without motion, with the final value as its name", () => {
    render(<CountUp value={4.2} digits={1} mode="mount" />);
    expect(screen.getByLabelText("4.2").textContent).toBe("4.2");
  });
});

describe("the rush (R12-A)", () => {
  it("starts at 3 parties queueing or 5 tickets, ends below 2 and 4 (no flicker on the edge)", () => {
    expect(rushNow(false, 2, 4)).toBe(false);
    expect(rushNow(false, 3, 0)).toBe(true);
    expect(rushNow(false, 0, 5)).toBe(true);
    expect(rushNow(true, 2, 0)).toBe(true);
    expect(rushNow(true, 0, 4)).toBe(true);
    expect(rushNow(true, 1, 3)).toBe(false);
  });
});

describe("best night so far (R12-A)", () => {
  const n = (day: number, profit: number) => ({ day, profit }) as DayResult;
  it("needs two earlier nights, a profit, and beating every one of them", () => {
    expect(bestNightSoFar([n(0, 100)], n(1, 500))).toBe(false);
    expect(bestNightSoFar([n(0, 100), n(1, 200)], n(2, 300))).toBe(true);
    expect(bestNightSoFar([n(0, 100), n(1, 200), n(2, 300)], n(2, 300))).toBe(true); // tonight already in history
    expect(bestNightSoFar([n(0, 100), n(1, 400)], n(2, 300))).toBe(false);
    expect(bestNightSoFar([n(0, -900), n(1, -400)], n(2, -10))).toBe(false);
  });
});

/** A Web Audio stand-in: params take values at once, nodes count what was made. */
function fakeAudio() {
  let t = 0;
  const made = { osc: 0, noise: 0 };
  const param = (v = 0) => ({ value: v, setValueAtTime(x: number) { this.value = x; }, linearRampToValueAtTime(x: number) { this.value = x; }, exponentialRampToValueAtTime(x: number) { this.value = x; }, setTargetAtTime(x: number) { this.value = x; }, cancelScheduledValues() {} });
  const node = () => ({ connect(n: unknown) { return n; }, disconnect() {} });
  const ctx = {
    get currentTime() { return t; },
    sampleRate: 8000, state: "running", destination: node(),
    createGain: () => ({ ...node(), gain: param(1) }),
    createOscillator: () => { made.osc++; return { ...node(), type: "sine", frequency: param(), detune: param(), start() {}, stop() {} }; },
    createBufferSource: () => { made.noise++; return { ...node(), buffer: null, start() {}, stop() {} }; },
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: param(), Q: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), ratio: param() }),
    resume: async () => {},
  };
  return { ctx: ctx as unknown as AudioContext, made, advance: (s: number) => { t += s; } };
}

describe("the soundtrack (R12-A, lib/music.ts)", () => {
  it("three pieces of 16 bars, each bar a 16-step grid; a rush is faster only where it should be", () => {
    for (const p of Object.values(PIECES)) {
      expect(p.bars).toHaveLength(16);
      expect(p.grid).toHaveLength(16);
      expect(p.rushBpm).toBeGreaterThanOrEqual(p.bpm);
    }
    expect(PIECES.service.rushBpm).toBeGreaterThan(PIECES.service.bpm);
    expect(PIECES.planning.bpm).toBeLessThan(PIECES.service.bpm);
    expect(PIECES.evening.bpm).toBeLessThan(PIECES.planning.bpm);
  });
  it("every Music decor item has its own palette, and they differ audibly (swing, kit, timbre)", () => {
    const items = (content.decor?.items ?? []).filter((i) => i.slot === "music").map((i) => i.id);
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (const id of items) expect(PALETTES[id], id).toBeDefined();
    const sig = new Set(items.map((id) => JSON.stringify(PALETTES[id])));
    expect(sig.size).toBe(items.length);
    expect(PALETTES.music_jukebox!.swing).toBeGreaterThan(PALETTES.music_speakers!.swing);
    expect(PALETTES.music_piano!.drums).toBe(0);
  });
  it("the tune is the same every loop (no Math.random)", () => {
    const a = Array.from({ length: 16 * 16 }, (_, i) => tuneNote(PIECES.planning, Math.floor(i / 16), i % 16));
    const b = Array.from({ length: 16 * 16 }, (_, i) => tuneNote(PIECES.planning, Math.floor(i / 16), i % 16));
    expect(a).toEqual(b);
  });
  it("every sound effect is defined and short", () => {
    for (const k of ["tap", "good", "win", "open", "orderUp", "paid", "review", "eightySix", "rushOn", "rushOff"] as const) {
      expect(SFX[k].length).toBeGreaterThan(0);
      for (const [, , at, dur] of SFX[k]) expect(at + dur).toBeLessThanOrEqual(1);
    }
  });
  it("plays notes when wanted; at music volume 0 the bus is at 0 and nothing more is scheduled", () => {
    vi.useFakeTimers();
    try {
      const a = fakeAudio();
      setSettings({ sound: true, musicVolume: 0.5 });
      sync(a.ctx, { scene: "service", rush: false, palette: "music_jukebox" });
      expect(musicStatus().running).toBe(true);
      expect(musicStatus().gain).toBeGreaterThan(0);
      for (let i = 0; i < 20; i++) { a.advance(0.05); vi.advanceTimersByTime(50); }
      const n = musicStatus().notes;
      expect(n).toBeGreaterThan(0);
      sync(a.ctx, { scene: "service", rush: true, palette: "music_jukebox" });
      for (let i = 0; i < 40; i++) { a.advance(0.05); vi.advanceTimersByTime(50); }
      expect(musicStatus().bpm).toBeGreaterThan(PIECES.service.bpm);
      setSettings({ musicVolume: 0 });
      sync(a.ctx, { scene: "service", rush: true, palette: "music_jukebox" });
      expect(musicStatus().gain).toBe(0);
      expect(musicStatus().running).toBe(false);
      const after = musicStatus().notes;
      for (let i = 0; i < 20; i++) { a.advance(0.05); vi.advanceTimersByTime(50); }
      expect(musicStatus().notes).toBe(after);
      // Sound off is the master: music stays silent at any volume
      setSettings({ sound: false, musicVolume: 1 });
      sync(a.ctx, { scene: "evening", rush: false, palette: "music_none" });
      expect(musicStatus().gain).toBe(0);
      expect(musicStatus().running).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("the front door never throws where Web Audio is missing (jsdom)", () => {
    expect(() => { playSfx("paid"); setSoundtrack("service", "music_radio"); setRush(true); setRush(false); setSoundtrack("off"); }).not.toThrow();
  });
});

describe("the floor's beats (R12-A, canvas/juice.ts)", () => {
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
  it("beats live their time and are dropped after", () => {
    const beats: Beat[] = [{ kind: "paid", x: 0, y: 0, r: 10, born: 0 }, { kind: "glow", x: 0, y: 0, r: 10, born: 0 }];
    expect(drawBeats(ctx, beats, PAID_MS - 1, 1, "paid")).toHaveLength(2);
    expect(drawBeats(ctx, beats, PAID_MS + 1, 1, "paid")).toHaveLength(1);
    expect(drawBeats(ctx, beats, GLOW_MS + 1, 1, "glow")).toHaveLength(0);
  });
  it("without motion nobody looks about and the queue steps up together", () => {
    expect(lookAbout(12345, 0, 7, "down")).toBe("down");
    expect(stepUpDelay(5, 1, 0)).toBe(0);
    expect(stepUpDelay(5, 1, 1)).toBeGreaterThan(stepUpDelay(1, 1, 1));
    expect(stepUpDelay(5, 4, 1)).toBeLessThan(stepUpDelay(5, 1, 1));
    const faces = new Set(Array.from({ length: 40 }, (_, i) => lookAbout(i * 2300, 1, 3, "down")));
    expect(faces.size).toBeGreaterThan(1);
  });
});

describe("RestaurantView beats (R12-A)", () => {
  const original = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    const grad = { addColorStop() {} };
    HTMLCanvasElement.prototype.getContext = function () {
      const o: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 7 }), createLinearGradient: () => grad, createRadialGradient: () => grad };
      return new Proxy(o, { get: (x, k: string) => (k in x ? x[k] : () => {}), set: (x, k: string, v) => { x[k] = v; return true; } });
    } as unknown as HTMLCanvasElement["getContext"];
  });
  afterAll(() => { HTMLCanvasElement.prototype.getContext = original; });

  it("a party that pays leaves a coin beat; five stars add a glow; a walk-out leaves neither", () => {
    let f = createFixture({ role: "server", seed: 11 });
    for (let i = 0; i < 60 * 25; i++) f = advanceFixture(f, 1 / 60);
    const game = f.state;
    const seated = game.customers.filter((c) => c.tableId && c.stage !== "queue");
    expect(seated.length).toBeGreaterThanOrEqual(2);
    const view = new RestaurantView(document.createElement("canvas"));
    view.resize(900, 640, 1);
    view.render(game, { content, speed: 1, now: 1000 });
    view.render(game, { content, speed: 1, now: 1016 });
    const [a, b] = seated;
    const left = { ...game, customers: game.customers.map((c) => c.id === a!.id ? { ...c, stage: "left" as const, rating: 5, spend: 1200 } : c.id === b!.id ? { ...c, stage: "left" as const, walkedOut: true } : c) };
    view.render(left, { content, speed: 1, now: 1032 });
    const beats = (view as unknown as { beats: Beat[] }).beats;
    expect(beats.map((x) => x.kind).sort()).toEqual(["glow", "paid"]);
    view.render(left, { content, speed: 1, now: 1032 + GLOW_MS + 10, reducedMotion: true });
    expect((view as unknown as { beats: Beat[] }).beats).toHaveLength(0);
  });
});

describe("Settings rows (R12-A)", () => {
  it("a 0–100 % slider: the value is said in words, changes report 0..1, the end of a press calls onDone", () => {
    const seen: number[] = [];
    let done = 0;
    render(<VolumeSlider label="Music" value={0.4} onChange={(v) => seen.push(v)} onDone={() => done++} />);
    const s = screen.getByRole("slider", { name: "Music" });
    expect(s.getAttribute("aria-valuetext")).toBe("40%");
    fireEvent.change(s, { target: { value: "0" } });
    expect(seen.at(-1)).toBe(0);
    fireEvent.keyUp(s, { key: "ArrowRight" });
    expect(done).toBe(1);
  });
  it("the sheet has Animations, Music and Sound effects, and they save", () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const anim = screen.getByRole("checkbox", { name: /^Animations/ });
    expect((anim as HTMLInputElement).checked).toBe(true);
    act(() => { fireEvent.click(anim); });
    expect(getSettings().animations).toBe(false);
    fireEvent.change(screen.getByRole("slider", { name: "Music" }), { target: { value: "0" } });
    expect(getSettings().musicVolume).toBe(0);
    expect(screen.getByRole("slider", { name: "Music" }).getAttribute("aria-valuetext")).toBe("Off");
    fireEvent.change(screen.getByRole("slider", { name: "Sound effects" }), { target: { value: "55" } });
    expect(getSettings().sfxVolume).toBe(0.55);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).sfxVolume).toBe(0.55);
  });
});
