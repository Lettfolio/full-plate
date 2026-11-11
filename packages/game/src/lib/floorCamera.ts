/**
 * Round 13 (B): the service floor's camera on an upright phone. Lazy (Service imports it only on a phone).
 *
 * The room is laid out in a narrow logical space (canvas/layout.ts `phoneFloorSize`, PHONE_FLOOR) and drawn bigger than
 * that on screen, so every sprite, table and label grows with it: at the base zoom a 13 px label is ≈ 14–15 CSS px.
 * Zoom (1–2.5×) re-sizes the canvas element and its backing store (the view caps its pixel ratio at 2, so the most
 * zoomed view is a little soft), and the scroller round the canvas pans it: touch (one finger drags, two pinch,
 * double-tap zooms in and back), trackpad (pinch arrives as ctrl+wheel; two-finger scroll is the scroller's own) and the
 * buttons/keys in Service. Cosmetic only: nothing here reaches the sim.
 */
import { phoneFloorSize, PHONE_FLOOR } from "../canvas/layout";

interface View { resize(w: number, h: number, dpr?: number): void }

export interface FloorCamera {
  /** Re-measure the scroller (resize, rotation, more tables) and redraw at the current zoom. */
  fit(): void;
  zoomBy(f: number, at?: { x: number; y: number }): void;
  reset(): void;
  readonly zoom: number;
  /** Client point → the room's logical px (what RestaurantView.pick takes). */
  toLogical(clientX: number, clientY: number): { x: number; y: number };
  /** True for one click after a drag or pinch (the click that ends a drag must not select a table). */
  swallowClick(): boolean;
  destroy(): void;
}

const clampZ = (z: number) => Math.min(PHONE_FLOOR.zoomMax, Math.max(1, z));

export function createFloorCamera(o: {
  scroller: HTMLElement;
  canvas: HTMLCanvasElement;
  view: View;
  tableCount: () => number;
  dpr: () => number;
  onZoom?: (z: number) => void;
}): FloorCamera {
  const { scroller, canvas } = o;
  let z = 1;
  let size: { w: number; h: number; scale: number } = { w: PHONE_FLOOR.logicalW, h: 320, scale: 1 };
  let raf = 0;
  let pendingZ: { z: number; at?: { x: number; y: number } } | null = null;

  const apply = (nz: number, at?: { x: number; y: number }) => {
    const r = scroller.getBoundingClientRect();
    const cssW = scroller.clientWidth || r.width, cssH = scroller.clientHeight || r.height;
    if (cssW <= 0 || cssH <= 0) return;
    // the focal point (viewport px inside the scroller) keeps the same bit of room under it
    const fx = at ? at.x - r.left : cssW / 2, fy = at ? at.y - r.top : cssH / 2;
    const k = size.scale * z;
    const lx = (scroller.scrollLeft + fx) / (k || 1), ly = (scroller.scrollTop + fy) / (k || 1);
    size = phoneFloorSize(cssW, cssH, o.tableCount());
    z = clampZ(nz);
    const nk = size.scale * z;
    canvas.style.width = `${Math.round(size.w * nk)}px`;
    canvas.style.height = `${Math.round(size.h * nk)}px`;
    o.view.resize(size.w, size.h, o.dpr() * nk);
    scroller.scrollLeft = Math.max(0, lx * nk - fx);
    scroller.scrollTop = Math.max(0, ly * nk - fy);
    scroller.dataset.zoom = z.toFixed(2);
    o.onZoom?.(z);
  };
  const schedule = (nz: number, at?: { x: number; y: number }) => {
    pendingZ = { z: nz, ...(at ? { at } : {}) };
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const p = pendingZ; pendingZ = null; if (p) apply(p.z, p.at); });
  };

  // ── pointers: one finger pans (we own touch-action here), two pinch; a quick second tap zooms ──
  const pts = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; t: number } | null = null;
  let moved = false;
  let swallow = false;
  let pinch = 0;
  let lastTap: { x: number; y: number; t: number } | null = null;
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = false; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y); moved = true; }
  };
  const move = (e: PointerEvent) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, next);
    if (pts.size >= 2 && pinch > 0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > 0) schedule((pendingZ?.z ?? z) * (d / pinch), { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
      pinch = d;
      return;
    }
    if (!moved && start && Math.hypot(next.x - start.x, next.y - start.y) < 8) return;
    if (!moved) { moved = true; try { scroller.setPointerCapture(e.pointerId); } catch { /* jsdom */ } }
    scroller.scrollLeft -= next.x - prev.x;
    scroller.scrollTop -= next.y - prev.y;
  };
  const up = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size < 2) pinch = 0;
    if (pts.size > 0) return;
    if (moved) { swallow = true; moved = false; lastTap = null; return; }
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      schedule(z < 1.5 ? 2 : 1, { x: e.clientX, y: e.clientY });
    } else lastTap = { x: e.clientX, y: e.clientY, t: now };
  };
  const cancel = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  // trackpad pinch (and ctrl + mouse wheel) arrives as a ctrl-wheel; a plain wheel scrolls the scroller as usual
  const wheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    schedule((pendingZ?.z ?? z) * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
  };
  scroller.addEventListener("pointerdown", down);
  scroller.addEventListener("pointermove", move);
  scroller.addEventListener("pointerup", up);
  scroller.addEventListener("pointercancel", cancel);
  scroller.addEventListener("wheel", wheel, { passive: false });

  return {
    fit: () => apply(z),
    zoomBy: (f, at) => schedule((pendingZ?.z ?? z) * f, at),
    reset: () => { schedule(1); },
    get zoom() { return z; },
    toLogical: (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      const k = r.width > 0 ? size.w / r.width : 1;
      return { x: (cx - r.left) * k, y: (cy - r.top) * k };
    },
    swallowClick: () => { const s = swallow; swallow = false; return s; },
    destroy: () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("pointerdown", down);
      scroller.removeEventListener("pointermove", move);
      scroller.removeEventListener("pointerup", up);
      scroller.removeEventListener("pointercancel", cancel);
      scroller.removeEventListener("wheel", wheel);
      canvas.style.width = ""; canvas.style.height = "";
      delete scroller.dataset.zoom;
    },
  };
}
