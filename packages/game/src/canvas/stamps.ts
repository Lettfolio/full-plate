/**
 * Round 13 (A, R12-F6): small pre-drawn pictures for the floor.
 *
 * Measured in Chromium's software raster (scripts/perf-floor.mjs --passes), a 4× lunchtime spent its canvas time on
 * (1) building people sprites — every new guest is a new look, ~2 builds a frame, each a fresh canvas and ~40 path
 * fills; (2) the ticket cards, whose labels were drawn under a ±1.2° sway, so every glyph was rasterised as a rotated
 * path; (3) overdraw on the live tables (shadow, edge, top and inlay discs, then the plates or menus on top); and
 * (4) the table-number badges and staff name tags (text and discs, every frame). Each of those is now drawn once into
 * a small bitmap and blitted: one pass over the pixels instead of three or four, and glyphs drawn upright, once.
 *
 *  - `StampCache`: string-keyed bitmaps drawn in CSS px by a callback, converted to an ImageBitmap where the browser
 *    can (blits ~25% faster than a canvas source in software raster). Blits snap to device pixels like the sprites
 *    (`exact`: to a quarter device pixel, baked into the bitmap, for things that sit on the cached scene). LRU, capped
 *    at 480; a resize, layout, palette or decor change clears it.
 *  - `PersonCache`: the handson SpriteCache's pictures (same `drawPerson`, same box, key and 8-frame walk quantising,
 *    so the people look exactly as before) as ImageBitmaps, with an LRU instead of clear-all-at-400 (which rebuilt
 *    every person on screen in one frame), and a build budget: past `budget` new pictures in a frame, a walker shows
 *    its last drawn frame for that frame (16 ms) rather than stall the whole floor.
 *
 * Where no offscreen surface exists (node tests, a stubbed context) both draw live — the same picture, uncached.
 */
import { drawPerson, handsYOf, type Look, type Pose } from "@full-plate/handson/sprites";
import { defaultSurface, type SurfaceFactory } from "@full-plate/handson/layers";

interface Entry { image: CanvasImageSource; w: number; h: number; ax: number; ay: number }

/** Draws a w×h CSS px picture at `dpr` into a fresh surface; the entry is sized in whole device pixels, so it blits 1:1. */
function bake(make: SurfaceFactory, w: number, h: number, ax: number, ay: number, dpr: number, paint: (c: CanvasRenderingContext2D) => void): Entry | null {
  const pw = Math.max(1, Math.ceil(w * dpr)), ph = Math.max(1, Math.ceil(h * dpr));
  const surface = make(pw, ph);
  const c = surface ? (surface.getContext("2d") as CanvasRenderingContext2D | null) : null;
  if (!surface || !c || typeof c.setTransform !== "function" || typeof c.drawImage !== "function") return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(c);
  let image = surface as unknown as CanvasImageSource;
  const t = (surface as unknown as { transferToImageBitmap?: () => ImageBitmap }).transferToImageBitmap;
  if (typeof t === "function") { try { image = t.call(surface); } catch { /* keep the canvas */ } }
  return { image, w: pw / dpr, h: ph / dpr, ax, ay };
}

const close = (e: Entry) => (e.image as { close?: () => void }).close?.();

/** Snap a CSS coordinate to the device-pixel grid (so a bitmap blits 1:1, unresampled). */
export const snap = (v: number, dpr: number): number => Math.round(v * dpr) / dpr;

export class StampCache {
  builds = 0;
  private map = new Map<string, Entry>();
  constructor(private make: SurfaceFactory = defaultSurface, private max = 480) {}

  get size(): number { return this.map.size; }

  /**
   * Draws stamp `key` so that its anchor lands on (x, y). The stamp is `w`×`h` CSS px with its anchor at (ax, ay);
   * `paint` draws it with the anchor at the origin.
   */
  draw(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number, ax: number, ay: number, dpr: number, paint: (c: CanvasRenderingContext2D) => void, exact = false): void {
    // `exact`: keep the sub-pixel position (to a quarter device pixel) by drawing it into the bitmap, so a stamp over
    // the cached scene (a table top on its table) lands exactly where the vector drawing did. For things that stay put.
    let fx = 0, fy = 0;
    if (exact) {
      fx = Math.round(((x - ax) * dpr - Math.floor((x - ax) * dpr)) * 4) / 4;
      fy = Math.round(((y - ay) * dpr - Math.floor((y - ay) * dpr)) * 4) / 4;
      key += `@${fx},${fy}`;
      w += 1 / dpr; h += 1 / dpr;
    }
    let e = this.map.get(key);
    if (e) { this.map.delete(key); this.map.set(key, e); } // most recently used last
    else {
      const baked = bake(this.make, w, h, ax, ay, dpr, (c) => { c.translate(ax + fx / dpr, ay + fy / dpr); paint(c); });
      if (!baked || typeof ctx.drawImage !== "function") {
        // no offscreen surface: draw it live
        ctx.save(); ctx.translate(x, y); paint(ctx); ctx.restore();
        return;
      }
      e = baked;
      this.builds++;
      this.map.set(key, e);
      if (this.map.size > this.max) { const old = this.map.keys().next().value as string; close(this.map.get(old)!); this.map.delete(old); }
    }
    if (exact) ctx.drawImage(e.image, Math.floor((x - e.ax) * dpr) / dpr, Math.floor((y - e.ay) * dpr) / dpr, e.w, e.h);
    else ctx.drawImage(e.image, snap(x - e.ax, dpr), snap(y - e.ay, dpr), e.w, e.h);
  }

  clear(): void { for (const e of this.map.values()) close(e); this.map.clear(); }
}

const WALK_FRAMES = 8; // as handson/sprites.ts SpriteCache
const TAU = Math.PI * 2;

export class PersonCache {
  builds = 0;
  /** Pictures not built this frame because the budget was spent (a walker showed its previous frame). */
  deferred = 0;
  private map = new Map<string, Entry>();
  /** The last picture drawn per person-pose-without-frame, the stand-in when the budget is spent. */
  private last = new Map<string, string>();
  private spent = 0;
  constructor(private make: SurfaceFactory = defaultSurface, private max = 900, public budget = 3) {}

  get size(): number { return this.map.size; }
  /** Call once a frame, before drawing people. */
  frame(): void { this.spent = 0; }

  /** Same contract as handson SpriteCache.draw: draws the person standing at (x, y), returns the hands' y. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, look: Look, pose: Pose, dpr = 1): number {
    const frame = pose.moving && pose.phase !== undefined ? Math.floor((((pose.phase % TAU) + TAU) % TAU) / (TAU / WALK_FRAMES)) : -1;
    const p: Pose = frame >= 0 ? { ...pose, phase: (frame + 0.5) * (TAU / WALK_FRAMES) } : { ...pose, moving: false, phase: 0 };
    const who = `${look.body}${look.skin}${look.hair}${look.hat ?? ""}${look.hatColour ?? ""}${look.trim ?? ""}${look.apron ?? ""}${look.shirt ? 1 : 0}${look.kid ? 1 : 0}|${p.facing}`;
    const rest = `${p.seated ? 1 : 0}${p.carrying ? 1 : 0}|${Math.round(r * 4)}|${dpr}|${p.outline}${p.shadow ?? ""}`;
    const key = `${who}${frame}${rest}`;
    let e = this.map.get(key);
    if (e) { this.map.delete(key); this.map.set(key, e); }
    else {
      const stand = frame >= 0 && this.spent >= this.budget ? this.last.get(who + rest) : undefined;
      const prev = stand ? this.map.get(stand) : undefined;
      if (prev) { e = prev; this.deferred++; }
      else {
        const left = r * 1.6, right = r * 1.7, top = r * 2.05, bottom = r * 1.6;
        const w = Math.ceil(left + right + 4), h = Math.ceil(top + bottom + 4);
        const baked = bake(this.make, w, h, left + 2, top + 2, dpr, (c) => { drawPerson(c, left + 2, top + 2, r, look, p); });
        if (!baked || typeof ctx.drawImage !== "function") return drawPerson(ctx, x, y, r, look, p);
        e = baked;
        this.builds++; this.spent++;
        this.map.set(key, e);
        if (this.map.size > this.max) {
          // drop the least recently used eighth (not everything: that rebuilt the whole room in one frame)
          let n = Math.ceil(this.max / 8);
          for (const [k, v] of this.map) { if (n-- <= 0) break; close(v); this.map.delete(k); }
        }
      }
    }
    if (e && this.map.get(key) === e) this.last.set(who + rest, key);
    if (this.last.size > this.max * 2) this.last.clear();
    ctx.drawImage(e.image, snap(x - e.ax, dpr), snap(y - e.ay, dpr), e.w, e.h);
    return handsYOf(y, r, look, p);
  }

  clear(): void { for (const e of this.map.values()) close(e); this.map.clear(); this.last.clear(); }
}
