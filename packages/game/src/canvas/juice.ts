/**
 * Round 12 (A): the floor's small moments — steam off the pans and the pass, the till's "paid" beat, the glow on a
 * table that just left five stars, staff breathing and looking about, the queue stepping up one at a time. All
 * cosmetic and view-local (performance.now() only): nothing here reads or changes the sim. Every effect takes `m`
 * (frame.ts `motion`: 0 under reduced motion or Settings › Animations off), and with 0 it is drawn still or not at all.
 */
import { C } from "./frame";
import { alpha, label } from "./paint";
import type { Facing } from "@full-plate/handson/sprites";

/** How long the paid beat rises (ms) and how long a five-star table glows. */
export const PAID_MS = 400;
export const GLOW_MS = 1800;

/** A short-lived beat drawn over the floor. */
export interface Beat { kind: "paid" | "glow"; x: number; y: number; r: number; born: number }

/**
 * Steam: three soft wisps rising and fading over (x, y), each a few overlapping discs (no gradients: cheap in software
 * raster). `heat` 0..1 scales how much. Nothing under reduced motion (a still wisp reads as smoke).
 */
export function steam(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, m: number, heat = 1, seed = 0, wisps = 3) {
  if (!m || heat <= 0) return;
  ctx.fillStyle = C.paper;
  // Round 13 (A): `wisps` < 3 under the floor's "lite" juice (a slow device); the first wisp is the same either way
  for (let k = 0; k < Math.min(3, wisps); k++) {
    const t = ((now / 1100 + k / 3 + seed * 0.37) % 1 + 1) % 1; // 0..1 up the wisp
    const a = 0.32 * heat * Math.sin(Math.PI * t);
    if (a < 0.02) continue;
    const dx = Math.sin(now / 420 + k * 2.1 + seed) * 2.2 + (k - 1) * 3.5;
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(x + dx, y - t * 16, 2.2 + t * 2.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The sizzle on a busy pan: a few hot specks that jump (nothing under reduced motion). */
export function sizzle(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, m: number, seed = 0) {
  if (!m) return;
  ctx.fillStyle = C.flameCore;
  for (let k = 0; k < 3; k++) {
    const t = ((now / 260 + k * 0.29 + seed * 0.13) % 1 + 1) % 1;
    ctx.globalAlpha = 0.85 * (1 - t);
    ctx.fillRect(x + Math.sin(k * 3.3 + seed + Math.floor(now / 260)) * 5, y - 3 - t * 6, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

/**
 * The paid beat: a gold coin rising off the table and fading over PAID_MS. Under reduced motion it isn't drawn (the
 * "+£" note that follows says the same thing, still).
 */
function paid(ctx: CanvasRenderingContext2D, b: Beat, t: number) {
  const e = 1 - (1 - t) ** 2; // ease out
  const y = b.y - 6 - e * 22;
  const R = 9;
  ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(b.x + 1.5, y + 2, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.gold; ctx.strokeStyle = C.goldEdge; ctx.lineWidth = 1.5;
  // a coin turning: squash it on its vertical axis
  const turn = Math.abs(Math.cos(e * Math.PI * 1.5));
  ctx.beginPath(); ctx.ellipse(b.x, y, Math.max(2, R * turn), R, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (turn > 0.55) label(ctx, "£", b.x, y + 4.5, { align: "center", size: 13, weight: 900, colour: C.amberDeep });
  ctx.globalAlpha = 1;
}

/** The five-star glow: a warm ring that swells a little and fades. Still (and fainter) under reduced motion. */
function glow(ctx: CanvasRenderingContext2D, b: Beat, t: number, m: number) {
  const fade = m ? (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) : 0.6;
  const R = b.r * (m ? 1.05 + 0.25 * Math.min(1, t * 2) : 1.15);
  ctx.globalAlpha = 0.55 * fade;
  ctx.strokeStyle = C.gold; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.25 * fade;
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(b.x, b.y, R + 6, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draws the live beats and drops the finished ones (returns the survivors). Glows are drawn under the people.
 * Round 13 (A): compacts `beats` in place and returns it (no new array twice a frame).
 */
export function drawBeats(ctx: CanvasRenderingContext2D, beats: Beat[], now: number, m: number, kind: Beat["kind"]): Beat[] {
  let n = 0;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    const life = b.kind === "paid" ? PAID_MS : GLOW_MS;
    const t = (now - b.born) / life;
    if (t >= 1) continue;
    beats[n++] = b;
    if (b.kind !== kind) continue;
    if (b.kind === "paid") { if (m) paid(ctx, b, Math.max(0, t)); }
    else glow(ctx, b, Math.max(0, t), m);
  }
  beats.length = n;
  return beats;
}

/** A small, stable number per id (staff idle timing differs person to person). */
export function idHash(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973;
  return h;
}

/** Breathing: a slow rise and fall of under a pixel. */
export function breathe(now: number, m: number, h: number): number {
  return m ? Math.sin(now / 900 + h) * 0.7 : 0;
}

/**
 * Looking about while idle: every couple of seconds (staggered per person) the head turns — mostly back to `home`,
 * sometimes left or right. Under reduced motion they keep facing `home`.
 */
export function lookAbout(now: number, m: number, h: number, home: Facing): Facing {
  if (!m) return home;
  const beat = Math.floor((now + h * 137) / 2300);
  const pick = (beat * 7 + h) % 5;
  return pick === 1 ? "left" : pick === 3 ? "right" : home;
}

/** Queue shuffle: the gap (ms) before the n-th person in the line steps up, so the line moves like people, not a block. */
export function stepUpDelay(rank: number, speed: number, m: number): number {
  return m ? (rank * 140) / Math.max(1, speed) : 0;
}
