/**
 * Round 13 (C): the hands-on shift on a phone is presentation only. A scripted player (the hint-following bot, fixed
 * seeds) scores exactly what it scored before the phone layout existed (the golden numbers below were taken on master
 * 7e5ad5a, before any R13 change), and drawing every frame at the desktop, phone-sideways or upright view changes
 * nothing it does.
 */
import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { botInput } from "../src/bot";
import { advanceFixture, applyResults, createFixture } from "../src/fixture";
import { summarise } from "../src/score";
import { createSession, updateSession } from "../src/session";
import { COMPACT_HEADER, railGeom, render, viewMetrics, type HandsOnView } from "../src/render";
import { hitTest, railSlotRect, stationRect } from "../src/touch";
import { LayerCache, type LayerSurface } from "../src/layers";
import { WORLD_W } from "../src/layout";
import type { HandsOnRole } from "../src/types";

function stubCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {
    measureText: (t: string) => ({ width: t.length * 7 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
  };
  return new Proxy(target, {
    get: (o, k: string) => (k in o ? o[k] : () => {}),
    set: (o, k: string, v) => { o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

/** A 90-second bot shift; `view` set: render every 6th frame at that view (as the game does every frame). */
export function scripted(role: HandsOnRole, skill: number, view?: (s: ReturnType<typeof createSession>) => HandsOnView) {
  let f = createFixture({ role, seed: 23 });
  let s = createSession(f.state, role, { content, seed: 9, shiftSeconds: 90 });
  const ctx = stubCtx();
  const dt = 1 / 60;
  let results = 0;
  for (let i = 0; i < 90 * 60 + 5; i++) {
    const r = updateSession(s, f.state, botInput(s, f.state, skill, 0.8), dt);
    s = r.session;
    results += r.results.length;
    f = applyResults(f, r.results);
    if (!s.shift?.over) f = advanceFixture(f, dt);
    if (view && i % 6 === 0) render(ctx, s, f.state, view(s));
  }
  const sum = summarise(s);
  return { points: s.score.points, plates: sum.plates, served: sum.served, payments: sum.payments, stars: sum.stars, results, cash: f.state.cash };
}

/** Taken on master 7e5ad5a (no phone layout), so "before and after" is pinned, not just "same as itself". */
const GOLDEN: Record<HandsOnRole, ReturnType<typeof scripted>> = {
  chef: {points: 437, plates: 6, served: 0, payments: 0, stars: 1, results: 13, cash: 457295},
  server: {points: 361, plates: 0, served: 10, payments: 3, stars: 1, results: 17, cash: 452689},
  bar: {points: 647, plates: 4, served: 3, payments: 8, stars: 2, results: 17, cash: 466795},
};

/** The three views the game draws at: a laptop, a phone sideways (the canvas between the thumb columns), upright. */
const DESKTOP: HandsOnView = { width: 1024, height: 600 };
const SIDEWAYS: HandsOnView = { width: 716, height: 390, compact: true, hitSlop: 56 };
const UPRIGHT: HandsOnView = { width: 390, height: 440, compact: true, follow: true, hitSlop: 56 };

describe("R13-C: scripted scores are unchanged by the phone layout", () => {
  for (const role of ["chef", "server", "bar"] as const) {
    it(`${role}: the golden score, with and without drawing, at every layout`, () => {
      expect(scripted(role, 0.7)).toEqual(GOLDEN[role]);
      for (const v of [DESKTOP, SIDEWAYS, UPRIGHT]) expect(scripted(role, 0.7, () => v), `${v.width}x${v.height}`).toEqual(GOLDEN[role]);
    });
  }
});

/** Records texts and the font size each was drawn at. */
function textCtx() {
  const texts: { t: string; px: number }[] = [];
  const grad = { addColorStop() {} };
  let font = "";
  const target: Record<string, unknown> = {
    fillText: (t: string) => { texts.push({ t, px: Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0) }); },
    measureText: (t: string) => ({ width: t.length * 7 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
  };
  const ctx = new Proxy(target, {
    get: (o, k: string) => (k === "font" ? font : k in o ? o[k] : () => {}),
    set: (o, k: string, v) => { if (k === "font") font = String(v); else o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("R13-C: phone metrics", () => {
  it("sideways: a 52 px strip and ~22 px tiles (the whole kitchen, no camera)", () => {
    const m = viewMetrics(SIDEWAYS);
    expect(m.header).toBe(COMPACT_HEADER);
    expect(m.T).toBeGreaterThanOrEqual(22);
    expect(m.camera).toBeFalsy();
    expect(m.ox).toBeGreaterThanOrEqual(0);
    // the old full header at the same size: 13 px tiles
    expect(viewMetrics({ width: 716, height: 390 }).T).toBeLessThan(m.T);
  });

  it("upright: tiles sized by the height, and the camera follows her, clamped to the kitchen's edges", () => {
    const left = viewMetrics(UPRIGHT, { x: 1, y: 7 });
    const mid = viewMetrics(UPRIGHT, { x: 15, y: 7 });
    const right = viewMetrics(UPRIGHT, { x: 29, y: 7 });
    expect(mid.T).toBeGreaterThanOrEqual(24);
    expect(mid.camera).toBe(true);
    expect(left.ox).toBe(0);
    expect(right.ox).toBe(UPRIGHT.width - mid.T * WORLD_W);
    expect(mid.ox + 15 * mid.T).toBe(UPRIGHT.width / 2); // she is in the middle
    expect(viewMetrics(DESKTOP).camera).toBeFalsy();
  });

  it("taps land on the station drawn under the finger at every layout (camera included)", () => {
    for (const role of ["chef", "server"] as const) {
      const f = createFixture({ role, seed: 4 });
      const s = createSession(f.state, role, { content, seed: 4 });
      for (const v of [DESKTOP, SIDEWAYS, UPRIGHT]) {
        for (const st of s.stations) {
          const r = stationRect(s, v, st.id)!;
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          if (cx < 0 || cx > v.width || cy < viewMetrics(v).header) continue; // off camera
          expect(hitTest(s, v, cx, cy), `${role} ${st.id} @${v.width}`).toEqual({ kind: "station", stationId: st.id });
        }
      }
    }
  });

  it("hit slop: on a phone a near miss beside a small station still counts (56 px targets, not 44)", () => {
    const f = createFixture({ role: "server", seed: 4 });
    const s = createSession(f.state, "server", { content, seed: 4 });
    const small: HandsOnView = { width: 400, height: 300 }; // ~13 px tiles: where the slop matters
    let rescued = 0;
    for (const st of s.stations) {
      const r = stationRect(s, small, st.id)!;
      const x = r.x + r.w / 2 + 25, y = r.y + r.h / 2; // 25 px right of its centre
      const near = hitTest(s, { ...small, hitSlop: 56 }, x, y);
      if (near?.kind === "station" && near.stationId === st.id && hitTest(s, small, x, y)?.kind !== "station") rescued++;
    }
    expect(rescued).toBeGreaterThan(0);
  });

  it("the strip's slips sit where railSlotRect says, and nothing on it is under 13 px", () => {
    const f = createFixture({ role: "chef", seed: 4 });
    let s = createSession(f.state, "chef", { content, seed: 4 });
    let st = f;
    for (let i = 0; i < 60 * 40; i++) { const r = updateSession(s, st.state, botInput(s, st.state, 0), 1 / 60); s = r.session; st = advanceFixture(applyResults(st, r.results), 1 / 60); }
    for (const v of [SIDEWAYS, UPRIGHT]) {
      const { ctx, texts } = textCtx();
      render(ctx, s, st.state, { ...v, layers: new LayerCache(() => undefined) });
      expect(texts.length).toBeGreaterThan(5);
      expect(texts.filter((x) => x.px < 13)).toEqual([]);
      expect(texts.some((x) => x.t.startsWith("TABLE "))).toBe(true);
      expect(texts.some((x) => x.t === "pts")).toBe(true);
    }
    const a = railSlotRect(SIDEWAYS, 0), b = railSlotRect(SIDEWAYS, 1);
    expect(b.x - a.x).toBe(railGeom({ compact: true }).slipW + railGeom({ compact: true }).gap);
    expect(a.h).toBe(COMPACT_HEADER - 10);
  });

  it("a following camera caches the kitchen once at its own size: walking never rebuilds it", () => {
    const sizes: { w: number; h: number }[] = [];
    const factory = (w: number, h: number): LayerSurface => { sizes.push({ w, h }); return { width: w, height: h, getContext: () => stubCtx() }; };
    const layers = new LayerCache(factory);
    const f = createFixture({ role: "server", seed: 4 });
    const s = createSession(f.state, "server", { content, seed: 4 });
    for (let x = 2; x < 28; x += 2) render(stubCtx(), { ...s, player: { ...s.player, x } }, f.state, { ...UPRIGHT, layers });
    expect(layers.builds).toBe(1);
    const T = viewMetrics(UPRIGHT).T;
    expect(sizes[0]!.w).toBe(T * WORLD_W);
  });

  it("the uniform hook dresses every staff sprite, the player included; no hook, no change", () => {
    const seen: string[] = [];
    const f = createFixture({ role: "chef", seed: 4 });
    const s = createSession(f.state, "chef", { content, seed: 4 });
    render(stubCtx(), s, f.state, { ...SIDEWAYS, layers: new LayerCache(() => undefined), dress: (role, look) => { seen.push(role); return { ...look, trim: "#123456" }; } });
    expect(seen).toContain("chef"); // her
    expect(seen).toContain("server");
    expect(seen).toContain("bar");
  });
});
