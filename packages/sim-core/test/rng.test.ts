import { describe, expect, it } from "vitest";
import { hashSeed, Rng, seedState } from "../src/rng";

describe("Rng", () => {
  it("is deterministic and resumable from serialised state", () => {
    const a = Rng.fromSeed(7);
    const first = [a.next(), a.next(), a.next()];
    const b = Rng.fromSeed(7);
    expect([b.next(), b.next(), b.next()]).toEqual(first);
    const saved = a.getState();
    const x = a.float();
    expect(new Rng(saved).float()).toBe(x);
  });

  it("produces floats in [0,1) and ints in range", () => {
    const r = Rng.fromSeed(1);
    for (let i = 0; i < 2000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(r.int(5, 2)).toBeGreaterThanOrEqual(2);
  });

  it("weighted respects weights and returns undefined for zero weights", () => {
    const r = Rng.fromSeed(3);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) counts[r.weighted(["a", "b"] as const, [3, 1])!]++;
    expect(counts.a / 4000).toBeGreaterThan(0.7);
    expect(counts.a / 4000).toBeLessThan(0.8);
    expect(r.weighted(["a"], [0])).toBeUndefined();
  });

  it("gaussian and poisson have roughly the right mean", () => {
    const r = Rng.fromSeed(9);
    let g = 0;
    let p = 0;
    let big = 0;
    for (let i = 0; i < 4000; i++) {
      g += r.gaussian(10, 2);
      p += r.poisson(3);
      big += r.poisson(50);
    }
    expect(g / 4000).toBeCloseTo(10, 0);
    expect(p / 4000).toBeCloseTo(3, 0);
    expect(big / 4000).toBeGreaterThan(48);
    expect(r.poisson(0)).toBe(0);
  });

  it("pick, shuffle, chance and roundStochastic behave", () => {
    const r = Rng.fromSeed(11);
    expect(["x", "y"]).toContain(r.pick(["x", "y"]));
    expect(() => r.pick([])).toThrow();
    expect(r.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
    expect(r.chance(1)).toBe(true);
    expect(r.chance(0)).toBe(false);
    let total = 0;
    for (let i = 0; i < 4000; i++) total += r.roundStochastic(2.25);
    expect(total / 4000).toBeCloseTo(2.25, 1);
  });

  it("seeds never produce an all-zero state and hashSeed mixes inputs", () => {
    expect(seedState(0).some((w) => w !== 0)).toBe(true);
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(() => new Rng([1, 2])).toThrow();
  });
});
