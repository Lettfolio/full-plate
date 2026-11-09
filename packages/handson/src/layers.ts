/**
 * Round 8: static layers. Everything that doesn't move (floors, walls, counters, appliances at rest, tables and
 * chairs, labels) is drawn once into an offscreen canvas per (size, dpr, palette, layout) and blitted each frame; only
 * the live overlays and the sprites are drawn per frame.
 *
 * Where no offscreen canvas can be made (node tests, a stubbed context) `LayerCache.draw` simply draws the layer
 * straight onto the target every frame — same picture, no cache.
 */

export type LayerSurface = { width: number; height: number; getContext(id: "2d"): unknown };
export type SurfaceFactory = (w: number, h: number) => LayerSurface | undefined;

/** OffscreenCanvas where there is one, else a detached <canvas>, else nothing. */
export const defaultSurface: SurfaceFactory = (w, h) => {
  try {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h) as unknown as LayerSurface;
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c as unknown as LayerSurface;
    }
  } catch { /* fall through */ }
  return undefined;
};

/** The static layer key: anything that changes the picture must be in it. */
export function layerKey(w: number, h: number, dpr: number, palette: number, layout: string): string {
  return `${Math.round(w)}x${Math.round(h)}@${dpr}|p${palette}|${layout}`;
}

interface Entry { key: string; surface: LayerSurface; ctx: CanvasRenderingContext2D }

export class LayerCache {
  /** How many times a layer was (re)built — tests read it to check the cache invalidates on resize. */
  builds = 0;
  private entries = new Map<string, Entry>();
  constructor(private make: SurfaceFactory = defaultSurface) {}

  /**
   * Blit layer `name` (drawn by `paint` in CSS px) onto `target`, whose transform is already scaled by `dpr`.
   * Rebuilds it when `key` changed. Returns true when it came from an offscreen surface.
   */
  draw(target: CanvasRenderingContext2D, name: string, key: string, w: number, h: number, dpr: number, paint: (ctx: CanvasRenderingContext2D) => void): boolean {
    let e = this.entries.get(name);
    if (!e || e.key !== key) {
      const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      const surface = e && e.surface.width === pw && e.surface.height === ph ? e.surface : this.make(pw, ph);
      const ctx = surface ? (surface.getContext("2d") as CanvasRenderingContext2D | null) : null;
      if (!surface || !ctx || typeof ctx.drawImage !== "function" || typeof ctx.setTransform !== "function") {
        this.entries.delete(name);
        paint(target); // no offscreen: draw it live
        return false;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pw, ph);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx);
      this.builds++;
      e = { key, surface, ctx };
      this.entries.set(name, e);
    }
    target.drawImage(e.surface as unknown as CanvasImageSource, 0, 0, w, h);
    return true;
  }

  clear(): void { this.entries.clear(); }
}
