import { describe, expect, it } from "vitest";
import { ticksDue } from "../screens/Service";

describe("ticksDue", () => {
  it("runs 2 × speed ticks per real second, carrying fractions between frames", () => {
    for (const speed of [1, 2, 4]) {
      let carry = 0, total = 0;
      for (let f = 0; f < 60; f++) { const r = ticksDue(carry, 1000 / 60, speed); carry = r.carry; total += r.n; }
      expect(total).toBe(2 * speed);
    }
  });
  it("paused runs nothing; a long stall does not fast-forward", () => {
    expect(ticksDue(0.9, 1000, 0)).toEqual({ n: 0, carry: 0 });
    expect(ticksDue(0, 10_000, 4).n).toBeLessThanOrEqual(8);
  });
});
