/**
 * Round 8 (C, the floor art pass): RestaurantView renders in jsdom with a stubbed 2D context, labels every table,
 * caches its static layers (rebuilt on resize, not per frame), walks staff and guests along the aisles, and reads the
 * theme tokens with fallbacks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceFixture, createFixture } from "@full-plate/handson";
import { aislePath, computeLayout, RestaurantView } from "../canvas/RestaurantView";
import { FLOOR_DEFAULTS, readFloorPalette } from "../canvas/floorPalette";
import { content } from "../sim";

const texts: string[] = [];
let drawImages = 0;
const original = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  const grad = { addColorStop() {} };
  const make = () => {
    const target: Record<string, unknown> = {
      fillText: (t: string) => { texts.push(t); },
      measureText: (t: string) => ({ width: t.length * 7 }),
      createLinearGradient: () => grad, createRadialGradient: () => grad,
      // full-canvas blits only (people are small sprite blits)
      drawImage: (_i: unknown, x: number, y: number, w: number) => { if (x === 0 && y === 0 && w >= 800) drawImages++; },
    };
    return new Proxy(target, { get: (o, k: string) => (k in o ? o[k] : () => {}), set: (o, k: string, v) => { o[k] = v; return true; } });
  };
  HTMLCanvasElement.prototype.getContext = function () { return make(); } as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => { HTMLCanvasElement.prototype.getContext = original; });

/** A lunchtime state with seated guests and a queue (the hands-on fixture runs the sim's people). */
function busyState() {
  let f = createFixture({ role: "server", seed: 11 });
  for (let i = 0; i < 60 * 25; i++) f = advanceFixture(f, 1 / 60);
  return f.state;
}

describe("RestaurantView (round 8)", () => {
  it("renders frames without error, labels every table, and blits cached layers", () => {
    const game = busyState();
    expect(game.customers.some((c) => c.tableId)).toBe(true);
    const canvas = document.createElement("canvas");
    const view = new RestaurantView(canvas);
    view.resize(900, 640, 1);
    texts.length = 0; drawImages = 0;
    for (let i = 0; i < 5; i++) view.render(game, { content, speed: 1, now: 1000 + i * 16, selected: game.customers.find((c) => c.tableId)?.id ?? null });
    for (let i = 1; i <= game.tables.length; i++) expect(texts).toContain(String(i));
    expect(view.layerBuilds).toBe(1); // the scene, once
    expect(drawImages).toBe(5); // one blit a frame
    view.resize(1200, 760, 2);
    view.render(game, { content, speed: 1, now: 2000 });
    view.render(game, { content, speed: 1, now: 2016, reducedMotion: true });
    expect(view.layerBuilds).toBe(2);
    // the restaurant name and the OPEN sign are painted into the furniture layer
    expect(texts).toContain(game.restaurantName.toUpperCase());
    expect(texts).toContain("OPEN");
  });

  it("evening light is drawn live (no extra full-canvas layer)", () => {
    const game = { ...busyState(), tick: 100 };
    const view = new RestaurantView(document.createElement("canvas"));
    view.resize(900, 640, 1);
    drawImages = 0;
    view.render(game, { content, speed: 1, now: 0 });
    view.render(game, { content, speed: 1, now: 16 });
    expect(view.layerBuilds).toBe(1);
    expect(drawImages).toBe(2);
  });

  it("caps the backing store at 2× device pixels", () => {
    const canvas = document.createElement("canvas");
    const view = new RestaurantView(canvas);
    view.resize(500, 400, 3);
    expect(canvas.width).toBe(1000);
  });

  it("aisle paths: across the room along a walkway, not through the tables", () => {
    const game = busyState();
    const L = computeLayout(900, 640, game.tables);
    const path = aislePath(L, { x: 100, y: L.aisles[0]! + 3 }, { x: 600, y: 420 });
    expect(path).toHaveLength(3);
    expect(path[0]!.y).toBe(path[1]!.y);
    expect(L.aisles).toContain(path[0]!.y);
    expect(path[2]).toEqual({ x: 600, y: 420 });
    expect(aislePath(L, { x: 100, y: 300 }, { x: 103, y: 500 })).toEqual([{ x: 103, y: 500 }]);
  });

  it("palette: theme tokens where they parse, defaults otherwise", () => {
    expect(readFloorPalette(document.createElement("canvas"))).toEqual(FLOOR_DEFAULTS); // jsdom: no theme loaded
    const p = readFloorPalette((n) => (n === "--tomato" ? "#010203" : n === "--sky" ? "nope" : ""));
    expect(p.tomato).toBe("#010203");
    expect(p.awningA).toBe("#010203");
    expect(p.sky).toBe(FLOOR_DEFAULTS.sky);
  });
});
