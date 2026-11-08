/**
 * Seeded xoshiro128** PRNG with a serialisable 4×uint32 state.
 * The only source of randomness in sim-core.
 */

export type RngState = [number, number, number, number];

/** splitmix32: expands one 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedState(seed: number): RngState {
  const next = splitmix32(seed);
  const state: RngState = [next(), next(), next(), next()];
  if (state.every((w) => w === 0)) state[0] = 1; // xoshiro must not be all-zero
  return state;
}

/** Mixes several integers into one 32-bit seed (e.g. seed + day for candidates). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  }
  return h >>> 0;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: readonly number[]) {
    if (state.length !== 4) throw new Error("Rng state must have 4 words");
    this.s0 = state[0]! >>> 0;
    this.s1 = state[1]! >>> 0;
    this.s2 = state[2]! >>> 0;
    this.s3 = state[3]! >>> 0;
  }

  static fromSeed(seed: number): Rng {
    return new Rng(seedState(seed));
  }

  getState(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  /** Next raw uint32. */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.float() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick from empty array");
    return arr[Math.floor(this.float() * arr.length)]!;
  }

  /** Picks an item with probability proportional to its weight. Returns undefined if all weights are ≤ 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T | undefined {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += Math.max(0, weights[i] ?? 0);
    if (total <= 0) return undefined;
    let r = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Normal sample (Box–Muller, no cached spare so state stays a pure 4-word vector). */
  gaussian(mean = 0, sd = 1): number {
    const u = 1 - this.float();
    const v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Poisson sample (Knuth; fine for the small lambdas used per tick). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(this.gaussian(lambda, Math.sqrt(lambda))));
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = this.float();
    while (p > limit) {
      k++;
      p *= this.float();
    }
    return k;
  }

  /** Rounds x up or down at random so the expectation equals x. */
  roundStochastic(x: number): number {
    const base = Math.floor(x);
    return base + (this.float() < x - base ? 1 : 0);
  }

  /** Returns a shuffled copy. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
