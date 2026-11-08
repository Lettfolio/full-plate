import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { botInput } from "../src/bot";
import { advanceFixture, applyResults, createFixture } from "../src/fixture";
import { findPath } from "../src/nav";
import { summarise } from "../src/score";
import { createSession, updateSession } from "../src/session";
import type { HandsOnResult, HandsOnRole } from "../src/types";

function shift(role: HandsOnRole, skill: number, seconds = 180) {
  let f = createFixture({ role, seed: 11 });
  let s = createSession(f.state, role, { content, seed: 5, shiftSeconds: seconds });
  const results: HandsOnResult[] = [];
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60 + 5; i++) {
    const r = updateSession(s, f.state, botInput(s, f.state, skill), dt);
    s = r.session;
    results.push(...r.results);
    f = applyResults(f, r.results);
    if (!s.shift?.over) f = advanceFixture(f, dt);
  }
  return { s, f, results, sum: summarise(s) };
}

describe("a full 3-minute shift is playable for every role (hint-following bot)", () => {
  it("chef: cooks a steady stream of plates; a skilled bot beats a sloppy one on quality", () => {
    const good = shift("chef", 1);
    const sloppy = shift("chef", 0.2);
    expect(good.s.shift?.over).toBe(true);
    expect(good.sum.plates).toBeGreaterThanOrEqual(12);
    expect(good.sum.meanQuality).toBeGreaterThan(85);
    expect(sloppy.sum.meanQuality).toBeLessThan(good.sum.meanQuality);
    expect(good.sum.stars).toBeGreaterThanOrEqual(2);
    // results reference real tickets
    for (const r of good.results) if (r.type === "PLATE_COOKED") expect(r.quality).toBeGreaterThan(0);
  });

  it("server: serves, clears and takes payment", () => {
    const r = shift("server", 1);
    expect(r.sum.served).toBeGreaterThanOrEqual(12);
    expect(r.sum.cleared).toBeGreaterThanOrEqual(2);
    expect(r.sum.payments).toBeGreaterThanOrEqual(3);
    expect(r.sum.stars).toBeGreaterThanOrEqual(2);
    expect(r.f.state.cash).toBeGreaterThan(createFixture({ role: "server", seed: 11 }).state.cash);
  });

  it("bar: pours drinks and takes payment", () => {
    const r = shift("bar", 1);
    expect(r.s.score.pours).toBeGreaterThanOrEqual(5);
    expect(r.sum.payments).toBeGreaterThanOrEqual(3);
    expect(r.sum.stars).toBeGreaterThanOrEqual(1);
  });

  it("pathfinding reaches every station from every role's spawn", () => {
    for (const role of ["chef", "server", "bar"] as const) {
      const f = createFixture({ role, seed: 1 });
      const s = createSession(f.state, role);
      for (const st of s.stations) expect(findPath(s, st.id), `${role} → ${st.id}`).toBeDefined();
    }
  });
});
