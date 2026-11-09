/**
 * Round 8: a cheap frame-time counter for the two canvases, on with `?perf=1` (off by default). Measures the time a
 * frame's JS takes (sim + render) and the interval between frames, keeps a rolling average over the last 120 frames
 * in fixed arrays (no allocation per frame), and draws a small readout in the canvas corner. The latest averages are
 * also on `window.__fpPerf[name]` for Playwright.
 */

export const PERF_WINDOW = 120;

export interface PerfMeter {
  begin(now: number): void;
  end(now: number): void;
  /** Rolling averages in ms. */
  readonly work: number;
  readonly interval: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void;
}

export function perfEnabled(search = typeof window !== "undefined" ? window.location.search : ""): boolean {
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

/** devicePixelRatio, capped at 2 (a 3× phone backing store costs 2.25× the fill for no visible gain). */
export function canvasDpr(): number {
  const d = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(2, Math.max(1, d));
}

let motionQuery: MediaQueryList | null | undefined;
/** prefers-reduced-motion, read live from one MediaQueryList (the OS setting can change mid-shift; no per-frame allocation). */
export function prefersReducedMotion(): boolean {
  if (motionQuery === undefined) {
    try { motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null; } catch { motionQuery = null; }
  }
  return !!motionQuery?.matches;
}
