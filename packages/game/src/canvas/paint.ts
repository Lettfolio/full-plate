/** Colour maths and small canvas drawing helpers for the owner's canvas (split out of RestaurantView.ts in round 11). */
import { art, C, D } from "./frame";
import { clamp, lerp } from "./layout";

/** Green (full) → amber → red (empty). */
export function patienceColour(p: number): string {
  const t = clamp(p / 100, 0, 1);
  if (t > 0.5) return mix(C.amber, C.basil, (t - 0.5) * 2);
  return mix(C.red, C.amber, t * 2);
}
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
export function alpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}

// ───────────────────────── small drawing helpers ─────────────────────────
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

export function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string): CanvasGradient | string {
  const g = typeof ctx.createRadialGradient === "function" ? ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r)) : undefined;
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
export function noise(i: number, j = 0): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** A counter: lit top, darker front face, soft shadow down-right. */
export function counter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top: string, face: string, edge: string) {
  const d = Math.min(10, h * 0.3);
  ctx.fillStyle = C.shadow; roundRect(ctx, x + 4, y + 4, w, h, 5); ctx.fill();
  ctx.fillStyle = face; roundRect(ctx, x, y + h - d - 2, w, d + 2, 5); ctx.fill();
  ctx.fillStyle = top; roundRect(ctx, x, y, w, h - d, 5); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(x + 5, y + 1, w - 10, 1);
}

export function tableTop(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, id = "") {
  if (D.key && art?.paintDecorTable(ctx, id, cx, cy, r, D, C, C.shadow)) return; // round 10: cloths, paint, marble
  ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.ellipse(cx + 3, cy + 4, r, r * 0.96, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.tableEdge; ctx.beginPath(); ctx.arc(cx, cy + 1.5, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.table; ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.tableTop; ctx.beginPath(); ctx.arc(cx - r * 0.06, cy - r * 0.06, r * 0.86, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(120,80,40,0.16)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0.3, 2.6); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
}

export function chair(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = C.shadow; roundRect(ctx, -s * 0.85 + 2, -s * 0.85 + 3, s * 1.7, s * 1.7, s * 0.4); ctx.fill();
  ctx.fillStyle = C.chair; roundRect(ctx, -s * 0.85, -s * 0.85, s * 1.7, s * 1.7, s * 0.4); ctx.fill();
  ctx.fillStyle = C.chairTop; roundRect(ctx, -s * 0.7, -s * 0.7, s * 1.3, s * 1.4, s * 0.32); ctx.fill();
  ctx.fillStyle = mix(C.chair, C.outline, 0.35); roundRect(ctx, s * 0.55, -s * 0.85, s * 0.32, s * 1.7, s * 0.14); ctx.fill();
  ctx.restore();
}

export function plate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, food?: string) {
  ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.beginPath(); ctx.arc(x + 1, y + 1.5, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.paper; ctx.strokeStyle = "#a99c86"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (food) {
    ctx.fillStyle = food; ctx.beginPath(); ctx.arc(x - r * 0.1, y + r * 0.05, r * 0.48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.basil; ctx.beginPath(); ctx.arc(x + r * 0.38, y - r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }
}

export function setting(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, r: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
  ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#cfc3ad"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.steelDark; ctx.fillRect(-r * 1.6, -r * 0.8, 1.2, r * 1.6); ctx.fillRect(r * 1.45, -r * 0.8, 1.2, r * 1.6);
  ctx.restore();
}

export function menu(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, r: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2 + 0.15);
  const w = Math.max(6, r * 0.3), h = Math.max(8, r * 0.42);
  ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.fillRect(-w / 2 + 1, -h / 2 + 1.5, w, h);
  ctx.fillStyle = C.tomatoDeep; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = C.paper; ctx.fillRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3);
  ctx.restore();
}

export function moodFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, patience: number) {
  const mood = patience > 60 ? "happy" : patience > 30 ? "meh" : "cross";
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = mood === "happy" ? "#f6d77a" : mood === "meh" ? C.amber : C.red; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.2, Math.max(1, r * 0.13), 0, Math.PI * 2); ctx.arc(x + r * 0.35, y - r * 0.2, Math.max(1, r * 0.13), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.lineCap = "round";
  ctx.beginPath();
  if (mood === "happy") ctx.arc(x, y + r * 0.05, r * 0.45, Math.PI * 0.15, Math.PI * 0.85);
  else if (mood === "meh") { ctx.moveTo(x - r * 0.4, y + r * 0.35); ctx.lineTo(x + r * 0.4, y + r * 0.35); }
  else ctx.arc(x, y + r * 0.7, r * 0.42, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke(); ctx.lineCap = "butt";
}

/** Round 5 type scale: no canvas text below 13 CSS px (the canvas draws in CSS pixels; see UI-NOTES "Type scale"). */
export const CANVAS_MIN_PX = 13;

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: { align?: CanvasTextAlign; size?: number; weight?: number; colour?: string; spacing?: number; stroke?: string; maxW?: number } = {}) {
  ctx.font = `${o.weight ?? 700} ${Math.max(CANVAS_MIN_PX, o.size ?? 13)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
  if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.strokeText(text, x, y, o.maxW); }
  ctx.fillStyle = o.colour ?? C.ink;
  ctx.fillText(text, x, y, o.maxW);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

export function plant(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(x + 3, y + 4, r * 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.pot; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5a3a22"; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    ctx.fillStyle = i % 2 ? C.leaf : C.leafDeep;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5 - r * 0.1, r * 0.52, r * 0.24, a, 0, Math.PI * 2); ctx.fill();
  }
}
