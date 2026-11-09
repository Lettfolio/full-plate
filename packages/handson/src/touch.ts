/**
 * Round 7: where things are on screen, for touch and for the game's first-shift onboarding. Pure: (session, view) →
 * CSS-pixel rectangles and hit tests, using the same metrics render draws with. A tap target is never smaller than
 * MIN_TARGET_PX (Apple's 44 pt), whatever the tile size — at 1024×768 a tile is ~23 px.
 */
import { RAIL, viewMetrics, type HandsOnView } from "./render";
import type { HandsOnSession } from "./types";

export const MIN_TARGET_PX = 44;

export interface Rect { x: number; y: number; w: number; h: number }

/** A station's drawn rectangle (CSS px). */
export function stationRect(session: HandsOnSession, view: HandsOnView, stationId: string): Rect | undefined {
  const st = session.stations.find((s) => s.id === stationId);
  if (!st) return undefined;
  const m = viewMetrics(view);
  return { x: m.ox + st.x * m.T, y: m.oy + st.y * m.T, w: st.w * m.T, h: st.h * m.T };
}

/** Grows a rectangle about its centre to at least `min` × `min`. */
export function padToMin(r: Rect, min = MIN_TARGET_PX): Rect {
  const w = Math.max(r.w, min), h = Math.max(r.h, min);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}

/** The header rail's station tag (career chef) and slot `i` (CSS px). */
export function railTagRect(view: HandsOnView): Rect {
  const m = viewMetrics(view);
  return { x: RAIL.x, y: 10, w: RAIL.tagW - 8, h: m.header - 20 };
}
export function railSlotRect(view: HandsOnView, i: number, withTag = true): Rect {
  const m = viewMetrics(view);
  return { x: RAIL.x + (withTag ? RAIL.tagW : 0) + i * (RAIL.slipW + RAIL.gap), y: 8, w: RAIL.slipW, h: m.header - 14 };
}

export type Hit = { kind: "station"; stationId: string } | { kind: "rail" };

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * What a tap at (x, y) CSS px means: the header rail (a slip: "go and grab it"), or the station whose padded target it
 * falls in (nearest centre wins where padded targets overlap). Undefined on bare floor.
 */
export function hitTest(session: HandsOnSession, view: HandsOnView, x: number, y: number): Hit | undefined {
  const m = viewMetrics(view);
  if (y < m.header) return x < m.w - RAIL.hudW - 6 ? { kind: "rail" } : undefined;
  let best: { id: string; d: number } | undefined;
  for (const st of session.stations) {
    const r = stationRect(session, view, st.id)!;
    const pad = m.T * 0.35;
    const t = padToMin({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });
    if (!inside(t, x, y)) continue;
    const d = Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2));
    if (!best || d < best.d) best = { id: st.id, d };
  }
  return best ? { kind: "station", stationId: best.id } : undefined;
}

/** Where a tap on the rail sends a chef: the fridge (a slip is grabbed there); other roles have no use for the rail. */
export function railTarget(session: HandsOnSession): string | undefined {
  return session.role === "chef" && session.stations.some((s) => s.id === "fridge") ? "fridge" : undefined;
}
