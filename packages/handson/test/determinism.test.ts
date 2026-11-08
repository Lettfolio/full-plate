import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { Rng } from "../src/rng";
import { advanceFixture, applyResults, createFixture } from "../src/fixture";
import { createSession, updateSession } from "../src/session";
import { nextHint } from "../src/hints";
import type { HandsOnInput, HandsOnResult, HandsOnRole } from "../src/types";

/** A scripted "player": a seeded stream of inputs with held moves and button presses, plus jittery frame times. */
function script(seed: number, frames: number): { input: HandsOnInput; dt: number }[] {
  const r = Rng.fromSeed(seed);
  const out: { input: HandsOnInput; dt: number }[] = [];
  let dir = 0, hold = 0, interact = false;
  for (let i = 0; i < frames; i++) {
    if (hold-- <= 0) { dir = r.int(0, 4); hold = r.int(5, 40); }
    if (r.chance(0.08)) interact = !interact;
    out.push({
      input: { up: dir === 1, down: dir === 2, left: dir === 3, right: dir === 4, interact, cancel: r.chance(0.01) },
      dt: 1 / 60 + (r.float() - 0.5) * 0.008,
    });
  }
  return out;
}

function play(role: HandsOnRole, seed: number, frames: number) {
  let f = createFixture({ role, seed: 99 });
  let s = createSession(f.state, role, { content, seed, shiftSeconds: 180 });
  const results: HandsOnResult[] = [];
  const hints: string[] = [];
  for (const step of script(seed, frames)) {
    const r = updateSession(s, f.state, step.input, step.dt);
    s = r.session;
    results.push(...r.results);
    f = applyResults(f, r.results);
    f = advanceFixture(f, step.dt);
    hints.push(nextHint(s, f.state)?.text ?? "");
  }
  return { s, f, results, hints };
}

describe("determinism", () => {
  for (const role of ["chef", "server", "bar"] as const) {
    it(`${role}: same session, state, inputs and dt sequence → identical sessions and results`, () => {
      const a = play(role, 1234, 2400);
      const b = play(role, 1234, 2400);
      expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
      expect(a.results).toEqual(b.results);
      expect(a.hints).toEqual(b.hints);
      expect(JSON.stringify(a.f)).toBe(JSON.stringify(b.f));
    });
  }

  it("does not mutate its inputs", () => {
    const f = createFixture({ role: "chef", seed: 1 });
    const s = createSession(f.state, "chef", { content });
    const sj = JSON.stringify(s), fj = JSON.stringify(f.state);
    for (let i = 0; i < 60; i++) updateSession(s, f.state, { up: false, down: false, left: false, right: true, interact: i % 2 === 0, cancel: false }, 1 / 60);
    expect(JSON.stringify(s)).toBe(sj);
    expect(JSON.stringify(f.state)).toBe(fj);
  });

  it("a different seed changes verb variation (chop marks / green band) but stays valid", () => {
    const a = play("chef", 1, 1200);
    const b = play("chef", 2, 1200);
    expect(JSON.stringify(a.s)).not.toBe(JSON.stringify(b.s));
  });

  it("splitting a frame in two is close to one frame (movement integrates dt, not frames)", () => {
    const f = createFixture({ role: "server", seed: 3 });
    const s0 = createSession(f.state, "server", { content });
    const right: HandsOnInput = { up: false, down: false, left: false, right: true, interact: false, cancel: false };
    let a = s0, b = s0;
    for (let i = 0; i < 60; i++) a = updateSession(a, f.state, right, 1 / 60).session;
    for (let i = 0; i < 120; i++) b = updateSession(b, f.state, right, 1 / 120).session;
    expect(Math.abs(a.player.x - b.player.x)).toBeLessThan(0.15);
  });
});
