/** Round 8: the small canvas helpers shared by render.ts and art.ts (moved out of render.ts unchanged). */
import { C } from "./palette";

export const FONT = "Nunito, system-ui, -apple-system, Segoe UI, sans-serif";
/** Round 5 (game UI-NOTES "Type scale"): no canvas text below 13 CSS px; the canvas draws in CSS pixels. */
export const MIN_TEXT_PX = 13;

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
/** `#rrggbb` + alpha → rgba(). */
export function alpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
}

export interface LabelOpts { align?: CanvasTextAlign; size?: number; weight?: number; colour?: string; spacing?: number; stroke?: string; maxW?: number }

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: LabelOpts = {}) {
  ctx.font = `${o.weight ?? 700} ${Math.max(MIN_TEXT_PX, o.size ?? 13)}px ${FONT}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  const ls = "letterSpacing" in ctx;
  if (ls) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
  if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.strokeText(text, x, y, o.maxW); }
  ctx.fillStyle = o.colour ?? C.ink;
  ctx.fillText(text, x, y, o.maxW);
  if (ls) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

/** A radial gradient, or a flat fill where the context can't make one (stub contexts in tests). */
export function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string): CanvasGradient | string {
  const g = typeof ctx.createRadialGradient === "function" ? ctx.createRadialGradient(x, y, 0, x, y, r) : undefined;
  if (!g || typeof g.addColorStop !== "function") return inner;
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  return g;
}
export function linear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient | string {
  const g = typeof ctx.createLinearGradient === "function" ? ctx.createLinearGradient(x0, y0, x1, y1) : undefined;
  if (!g || typeof g.addColorStop !== "function") return stops[0]![1];
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** Deterministic 0..1 noise for static art (plank tones, speckle) — no Math.random anywhere in the package. */
export function noise(i: number, j = 0): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
