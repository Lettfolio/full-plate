/**
 * Round 8: a cheap frame-time counter for the two canvases, on with `?perf=1` (off by default). Measures the time a
 * frame's JS takes (sim + render) and the interval between frames, keeps a rolling average over the last 120 frames
 * in fixed arrays (no allocation per frame), and draws a small readout in the canvas corner. The latest averages are
 * also on `window.__fpPerf[name]` for Playwright.
 */
import { deviceStorage } from "./storage";

export const PERF_WINDOW = 120;

export interface PerfMeter {
  begin(now: number): void;
  end(now: number): void;
  /** Rolling averages in ms. */
  readonly work: number;
  readonly interval: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void;
}

/** Round 11 (D, red-team S12): the localStorage key that turns the playtest switches on in a production build. */
export const DEV_FLAG_KEY = "full-plate:dev";

/**
 * Round 11 (D, S12): `?perf=` and `?autopilot=` are playtest switches, not features: they work in a dev build
 * (`import.meta.env.DEV`) or when localStorage has `full-plate:dev` = "1" (the Playwright playtests and type audit set it).
 */
export function devSwitches(): boolean {
  if (import.meta.env.DEV) return true;
  try { return typeof window !== "undefined" && deviceStorage()?.getItem(DEV_FLAG_KEY) === "1"; } catch { return false; }
}

export function perfEnabled(search = typeof window !== "undefined" ? window.location.search : ""): boolean {
  if (!devSwitches()) return false;
  try { return new URLSearchParams(search).get("perf") === "1"; } catch { return false; }
}

export function createPerfMeter(name: string): PerfMeter {
  const work = new Float64Array(PERF_WINDOW);
  const gap = new Float64Array(PERF_WINDOW);
  let i = 0, n = 0, t0 = 0, last = 0, sumW = 0, sumG = 0;
  const meter = {
    begin(now: number) { t0 = now; },
    end(now: number) {
      const w = now - t0, g = last ? t0 - last : 16.7;
      last = t0;
      sumW += w - work[i]!; sumG += g - gap[i]!;
      work[i] = w; gap[i] = g;
      i = (i + 1) % PERF_WINDOW; n = Math.min(PERF_WINDOW, n + 1);
      const reg = (globalThis as { __fpPerf?: Record<string, { work: number; interval: number; frames: number }> });
      const slot = (reg.__fpPerf ??= {})[name] ??= { work: 0, interval: 0, frames: 0 };
      slot.work = sumW / n; slot.interval = sumG / n; slot.frames++;
    },
    get work() { return n ? sumW / n : 0; },
    get interval() { return n ? sumG / n : 0; },
    draw(ctx: CanvasRenderingContext2D, x: number, y: number) {
      const fps = meter.interval > 0 ? 1000 / meter.interval : 0;
      const text = `${meter.work.toFixed(2)} ms · ${fps.toFixed(0)} fps`;
      ctx.save();
      ctx.font = "800 13px Nunito, system-ui, sans-serif";
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = "rgba(20,16,12,0.78)";
      ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = meter.work > 8 ? "#ffb4a3" : "#b9f0c4";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(text, x + 6, y + 14.5);
      ctx.restore();
    },
  };
  return meter;
}

/**
 * Round 13 (A): the floor's per-pass profile, for scripts/perf-floor.mjs. Off unless a playtest sets
 * `window.__fpPassProfile = {}` (then the renderer reads it once a frame). While on, each paint pass is followed by a
 * 1×1 `getImageData`, which makes the canvas rasterise what that pass recorded, so `ms[pass]` is the pass's JS plus
 * its raster — the cost the rAF callback's own timing (`work`) can't see. That flush is itself slow, so frame gaps are
 * measured with the profile off.
 */
export interface PassProfile { ms: Record<string, number>; frames: number }
export function passProfile(): PassProfile | null {
  const p = (globalThis as { __fpPassProfile?: Partial<PassProfile> | null }).__fpPassProfile;
  if (!p) return null;
  p.ms ??= {}; p.frames ??= 0;
  return p as PassProfile;
}

/**
 * Round 13 (A): the one cap on a canvas's backing store, in device pixels per CSS pixel. A 3× phone at 3 would fill
 * 2.25× the pixels of 2 for no visible gain on these drawings; the floor, the hands-on kitchen and their cached layers
 * all use it (RestaurantView.resize clamps to it too, for callers that pass a raw devicePixelRatio).
 */
export const MAX_CANVAS_DPR = 2;

/** devicePixelRatio, capped at MAX_CANVAS_DPR. */
export function canvasDpr(): number {
  const d = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(MAX_CANVAS_DPR, Math.max(1, d));
}

let motionQuery: MediaQueryList | null | undefined;
/** prefers-reduced-motion, read live from one MediaQueryList (the OS setting can change mid-shift; no per-frame allocation). */
export function prefersReducedMotion(): boolean {
  if (motionQuery === undefined) {
    try { motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null; } catch { motionQuery = null; }
  }
  return !!motionQuery?.matches;
}
