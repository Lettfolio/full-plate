/**
 * Round 8 (C, the canvas art pass): the palette reads theme tokens with fallbacks, the static layers are cached and
 * rebuilt only on resize, and sprites face the way they move.
 */
import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { createFixture } from "../src/fixture";
import { createSession } from "../src/session";
import { render } from "../src/render";
import { DEFAULT_PALETTE, readPalette, toHex } from "../src/palette";
import { LayerCache, layerKey, type LayerSurface } from "../src/layers";
import { drawPerson, facingFrom, handsYOf, SpriteCache, walkBob } from "../src/sprites";

/** A 2D context that records every call (name + args) and the texts drawn. */
function recCtx() {
  const calls: string[] = [];
  const texts: string[] = [];
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {
    fillText: (t: string) => { texts.push(t); calls.push(`fillText:${t}`); },
    measureText: (t: string) => ({ width: t.length * 7 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
  };
  const ctx = new Proxy(target, {
    get: (o, k: string) => (k in o ? o[k] : (...a: unknown[]) => { calls.push(`${k}:${a.map((x) => (typeof x === "number" ? x.toFixed(2) : typeof x)).join(",")}`); }),
    set: (o, k: string, v) => { if (typeof v !== "function") calls.push(`${k}=${String(v)}`); o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts };
}

describe("palette (theme tokens with fallbacks)", () => {
  it("no CSS at all → the defaults", () => {
    expect(readPalette(undefined)).toEqual(DEFAULT_PALETTE);
    expect(readPalette(() => "")).toEqual(DEFAULT_PALETTE);
  });

  it("reads the variables it knows; missing or unparseable ones keep their default", () => {
    const vars: Record<string, string> = {
      "--tomato": " #112233 ", "--ink": "rgb(1, 2, 3)", "--basil": "not-a-colour", "--star": "#abc",
      "--awning": "repeating-linear-gradient(90deg, #a1b2c3 0 28px, #fefefe 28px 56px)",
    };
    const p = readPalette((n) => vars[n] ?? "");
    expect(p.tomato).toBe("#112233");
    expect(p.ink).toBe("#010203");
    expect(p.basil).toBe(DEFAULT_PALETTE.basil);
    expect(p.gold).toBe("#aabbcc");
    expect(p.awningA).toBe("#a1b2c3");
    expect(p.awningB).toBe("#fefefe");
    expect(p.plum).toBe(DEFAULT_PALETTE.plum);
    // art colours are never read from CSS
    expect(p.floorA).toBe(DEFAULT_PALETTE.floorA);
  });

  it("an awning that isn't there falls back to tomato and paper; a throwing reader is survived", () => {
    const p = readPalette((n) => (n === "--tomato" ? "#102030" : ""));
    expect([p.awningA, p.awningB]).toEqual(["#102030", DEFAULT_PALETTE.paper]);
    expect(readPalette(() => { throw new Error("no"); })).toEqual(DEFAULT_PALETTE);
    expect(toHex("hsl(1 2% 3%)")).toBeUndefined();
    expect(toHex("#AABBCCDD")).toBe("#aabbcc");
  });
});

describe("static layers (cached offscreen, rebuilt on resize)", () => {
  /** Surfaces whose contexts record what was painted into them. */
  const surfaces: { w: number; h: number; rec: ReturnType<typeof recCtx> }[] = [];
  const factory = (w: number, h: number): LayerSurface => {
    const rec = recCtx();
    surfaces.push({ w, h, rec });
    return { width: w, height: h, getContext: () => rec.ctx };
  };

  it("LayerCache paints once per key and blits after", () => {
    const cache = new LayerCache(factory);
    const { ctx, calls } = recCtx();
    let painted = 0;
    const paint = () => { painted++; };
    for (let i = 0; i < 5; i++) cache.draw(ctx, "floor", layerKey(800, 600, 1, 1, "a"), 800, 600, 1, paint);
    expect(painted).toBe(1);
    expect(cache.builds).toBe(1);
    expect(calls.filter((c) => c.startsWith("drawImage")).length).toBe(5);
    cache.draw(ctx, "floor", layerKey(1024, 600, 1, 1, "a"), 1024, 600, 1, paint); // resize
    cache.draw(ctx, "floor", layerKey(1024, 600, 2, 1, "a"), 1024, 600, 2, paint); // dpr change
    cache.draw(ctx, "floor", layerKey(1024, 600, 2, 2, "a"), 1024, 600, 2, paint); // palette change
    expect(painted).toBe(4);
    expect(surfaces.at(-1)).toMatchObject({ w: 2048, h: 1200 });
  });

  it("render: the scene layer is built once, blitted every frame (one blit), rebuilt when the canvas resizes", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const s = createSession(f.state, "chef", { content, seed: 3 });
    const layers = new LayerCache(factory);
    const { ctx, calls, texts } = recCtx();
    for (let i = 0; i < 4; i++) render(ctx, { ...s, time: i / 60 }, f.state, { width: 1024, height: 600, layers });
    expect(layers.builds).toBe(1);
    expect(calls.filter((c) => c.startsWith("drawImage")).length).toBe(4);
    // static labels went into the layer, not the frame
    expect(texts).not.toContain("WASH-UP");
    expect(surfaces.some((x) => x.rec.texts.includes("WASH-UP"))).toBe(true);
    render(ctx, s, f.state, { width: 1280, height: 800, layers });
    expect(layers.builds).toBe(2);
    render(ctx, s, f.state, { width: 1280, height: 800, layers });
    expect(layers.builds).toBe(2);
  });

  it("with no offscreen surface (node) the static art is drawn straight onto the frame", () => {
    const f = createFixture({ role: "server", seed: 4 });
    const s = createSession(f.state, "server", { content, seed: 4 });
    const layers = new LayerCache(() => undefined);
    const { ctx, texts } = recCtx();
    render(ctx, s, f.state, { width: 1024, height: 600, layers });
    expect(layers.builds).toBe(0);
    expect(texts).toEqual(expect.arrayContaining(["PASS", "WASH-UP", "BAR", "TILL", "OFFICE"]));
  });
});

describe("sprites", () => {
  it("face the way they move; standing still keeps the last facing", () => {
    expect(facingFrom(1, 0, "up")).toBe("right");
    expect(facingFrom(-1, 0.3, "up")).toBe("left");
    expect(facingFrom(0.2, -1, "down")).toBe("up");
    expect(facingFrom(-0.1, 2, "left")).toBe("down");
    expect(facingFrom(0, 0, "left")).toBe("left");
    expect(facingFrom(1e-5, -1e-5, "right")).toBe("right");
    // a diagonal goes to the horizontal (ties break sideways, like the player's own facing)
    expect(facingFrom(1, 1, "up")).toBe("right");
  });

  it("walk bob only while moving; a still sprite draws the same whatever the phase (reduced motion)", () => {
    const look = { body: "#ffffff", skin: "#f1c9a5", hair: "#3b2a1f", hat: "toque" as const };
    expect(walkBob({ facing: "down", moving: false, phase: 1.3, outline: "#000" }, 10)).toBe(0);
    expect(walkBob({ facing: "down", moving: true, phase: 1.3, outline: "#000" }, 10)).toBeLessThan(0);
    const a = recCtx(), b = recCtx();
    drawPerson(a.ctx, 50, 50, 10, look, { facing: "left", moving: false, phase: 0.2, outline: "#000" });
    drawPerson(b.ctx, 50, 50, 10, look, { facing: "left", moving: false, phase: 2.7, outline: "#000" });
    expect(a.calls).toEqual(b.calls);
  });

  it("reduced motion: two frames 0.25 s apart of a walking player draw her in the same place", () => {
    const f = createFixture({ role: "chef", seed: 6 });
    const s0 = createSession(f.state, "chef", { content, seed: 6, tutorial: false });
    const walking = { ...s0, player: { ...s0.player, vx: 2, vy: 0, facing: "right" as const } };
    const frame = (t: number, reducedMotion: boolean) => {
      const { ctx, calls } = recCtx();
      render(ctx, { ...walking, time: t }, f.state, { width: 1024, height: 600, reducedMotion, layers: new LayerCache(() => undefined) });
      return calls.filter((c) => c.startsWith("ellipse") || c.startsWith("arc")).join("|");
    };
    expect(frame(10, true)).toBe(frame(10.25, true));
    expect(frame(10, false)).not.toBe(frame(10.25, false));
  });

  it("people are pre-drawn once per (look, facing, walk frame, size) and blitted; the walk cycle has 8 frames", () => {
    const made: number[] = [];
    const cache = new SpriteCache((w, h) => { made.push(w * h); return { width: w, height: h, getContext: () => recCtx().ctx }; });
    const look = { body: "#2f3a33", skin: "#d9a77c", hair: "#1f1b18", hat: "cap" as const, hatColour: "#3c7a37" };
    const { ctx, calls } = recCtx();
    for (let i = 0; i < 10; i++) cache.draw(ctx, 100 + i, 100, 10, look, { facing: "down", outline: "#000" });
    expect(cache.builds).toBe(1);
    for (let i = 0; i < 200; i++) cache.draw(ctx, 100, 100, 10, look, { facing: "right", moving: true, phase: i * 0.37, outline: "#000" });
    expect(cache.builds).toBe(1 + 8);
    expect(calls.filter((c) => c.startsWith("drawImage")).length).toBe(210);
    // the hands it reports match what drawPerson returns
    const pose = { facing: "down" as const, carrying: true, outline: "#000" };
    expect(cache.draw(ctx, 50, 50, 10, look, pose)).toBeCloseTo(drawPerson(recCtx().ctx, 50, 50, 10, look, pose));
    expect(handsYOf(50, 10, look, { ...pose, facing: "up" })).toBeLessThan(50);
  });
});
