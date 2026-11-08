import { describe, expect, it } from "vitest";
import { chefSpeedBonus, chopHit, cookBand, cookQuality, plateExecution, pourQuality, serveSpeedBonus, TUNING } from "../src/verbs";

describe("cook timing → quality", () => {
  const band: [number, number] = [0.6, 0.76];
  it("dead centre of the green band is 100%", () => {
    expect(cookQuality(0.68, band)).toEqual({ quality: 1, result: "perfect" });
  });
  it("anywhere in the band is at least 90%", () => {
    for (const n of [0.6, 0.63, 0.7, 0.76]) {
      const q = cookQuality(n, band);
      expect(q.result).toBe("perfect");
      expect(q.quality).toBeGreaterThanOrEqual(0.9);
    }
  });
  it("undercooking falls off gently, overcooking faster", () => {
    const under = cookQuality(0.5, band);
    const over = cookQuality(0.86, band);
    expect(under.result).toBe("under");
    expect(over.result).toBe("over");
    expect(under.quality).toBeLessThan(0.9);
    expect(over.quality).toBeLessThan(under.quality); // same 0.1 distance, overdone worse
  });
  it("is monotonic away from the band on both sides", () => {
    let prev = 1;
    for (let n = 0.6; n >= 0; n -= 0.05) { const q = cookQuality(n, band).quality; expect(q).toBeLessThanOrEqual(prev + 1e-9); prev = q; }
    prev = 1;
    for (let n = 0.76; n < 1; n += 0.05) { const q = cookQuality(n, band).quality; expect(q).toBeLessThanOrEqual(prev + 1e-9); prev = q; }
  });
  it("soft failure: even burnt still plates (never zero)", () => {
    expect(cookQuality(1, band)).toEqual({ quality: 0.25, result: "burnt" });
    expect(cookQuality(0, band).quality).toBeGreaterThanOrEqual(0.35);
    expect(cookQuality(0.99, band).quality).toBeGreaterThanOrEqual(0.25);
  });
  it("bands are tighter in the fryer than the oven", () => {
    const f = cookBand(0.7, "fryer"), o = cookBand(0.7, "oven");
    expect(f[1] - f[0]).toBeLessThan(o[1] - o[0]);
  });
  it("every verb is 1–3 seconds of timing", () => {
    for (const secs of Object.values(TUNING.cookSecs)) { expect(secs).toBeGreaterThanOrEqual(1); expect(secs).toBeLessThanOrEqual(3); }
    expect(TUNING.chopSecs).toBeLessThanOrEqual(3);
    expect(TUNING.pourSecs).toBeLessThanOrEqual(3);
    expect(TUNING.plateSecs).toBeLessThanOrEqual(3);
    expect(TUNING.paymentSecs).toBeLessThanOrEqual(3);
  });
});

describe("chop, pour, plate", () => {
  it("chopHit: exact 1, window edge 0.7, outside 0", () => {
    expect(chopHit(0.5, 0.5)).toBe(1);
    expect(chopHit(0.5 + TUNING.chopWindow, 0.5)).toBeCloseTo(0.7);
    expect(chopHit(0.5 + TUNING.chopWindow + 0.01, 0.5)).toBe(0);
  });
  it("pourQuality peaks on the line with a soft floor", () => {
    expect(pourQuality(0.8, 0.8)).toBe(1);
    expect(pourQuality(0.7, 0.8)).toBeCloseTo(0.6);
    expect(pourQuality(0, 0.8)).toBe(0.3);
  });
  it("plate execution weights cooking over prep; cold dishes are all prep", () => {
    expect(plateExecution("stove", 1, 0.5)).toBeCloseTo(0.35 + 0.65 * 0.5);
    expect(plateExecution("none", 0.8, 0)).toBeCloseTo(0.8);
  });
  it("speed bonuses run 1 → 0", () => {
    expect(chefSpeedBonus(10)).toBe(1);
    expect(chefSpeedBonus(60)).toBeCloseTo(0.5);
    expect(chefSpeedBonus(200)).toBe(0);
    expect(serveSpeedBonus(5)).toBe(1);
    expect(serveSpeedBonus(40)).toBe(0);
  });
});
