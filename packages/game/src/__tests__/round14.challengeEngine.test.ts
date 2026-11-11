// @vitest-environment node
/**
 * Round 14 (D): the cross-engine determinism worry (RED-TEAM-2 "Unproven"). sim-core calls Math.log, cos, sqrt, exp and
 * pow (rng.ts gaussian/poisson, util.ts sigmoid, finance.ts's loan instalment); the language doesn't require two engines
 * to round them alike, so Safari and Chrome could, in principle, build a different "same for everyone" restaurant.
 *
 * This runs the challenge builder with those five functions wrapped to move every result by one unit in the last place
 * (up, then down) and by a million units (about 2e-10 relative, far beyond any real libm's error), and checks the built
 * state and its fingerprint don't change. They don't: every one of those results is compared with a random draw or
 * rounded before it reaches the state. The `**` operator (capacity.ts, the forecast) can't be wrapped from here; it is
 * not on the build path (capacity.ts: "nothing here is used by the tick pipeline").
 *
 * The fingerprint is the backstop if a future change makes the build sensitive: two players whose builds differ get
 * "different versions of today's challenge", never a false comparison (the last test).
 */
import { describe, expect, it } from "vitest";
import { buildChallenge, fingerprintOf } from "../lib/challenge";
import { serialize } from "../sim";

const FNS = ["log", "cos", "sqrt", "exp", "pow"] as const;
const DATES = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];
const now = async () => {};

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
/** x moved by `ulps` units in the last place (away from zero for positive `ulps`). */
function nudge(x: number, ulps: bigint): number {
  if (!Number.isFinite(x) || x === 0) return x;
  f64[0] = x;
  i64[0] = i64[0]! + ulps;
  return f64[0]!;
}

type MathFn = (...a: number[]) => number;
async function buildWith(ulps: bigint, fns: readonly (typeof FNS)[number][], date: string): Promise<{ state: string; fp: number; calls: number }> {
  const M = Math as unknown as Record<string, MathFn>;
  const orig = fns.map((f) => [f, M[f]!] as const);
  let calls = 0;
  for (const [f, o] of orig) M[f] = (...a: number[]) => { calls++; return nudge(o(...a), ulps); };
  try {
    const g = (await buildChallenge(date, undefined, now)).game;
    return { state: serialize(g), fp: fingerprintOf(g), calls };
  } finally {
    for (const [f, o] of orig) M[f] = o;
  }
}

describe("the challenge builder and the engine's maths", () => {
  it("one ulp up or down in log, cos, sqrt, exp or pow (each alone and all together) leaves the built restaurant identical", async () => {
    const base = new Map<string, { state: string; fp: number }>();
    for (const d of DATES) { const g = (await buildChallenge(d, undefined, now)).game; base.set(d, { state: serialize(g), fp: fingerprintOf(g) }); }
    const report: string[] = [];
    for (const ulps of [1n, -1n, 1_000_000n]) {
      for (const set of [...FNS.map((f) => [f] as const), FNS]) {
        let calls = 0;
        let changed = 0;
        for (const d of DATES) {
          const r = await buildWith(ulps, set, d);
          calls += r.calls;
          if (r.state !== base.get(d)!.state) changed++;
          expect(r.state, `${set.join("+")} ${ulps} ulp on ${d}`).toBe(base.get(d)!.state);
          expect(r.fp).toBe(base.get(d)!.fp);
        }
        report.push(`${set.join("+")} ${ulps} ulp: ${calls} calls, ${changed}/${DATES.length} builds changed`);
        if (set.length === 1 && set[0] !== "pow") expect(calls).toBeGreaterThan(0); // the wrap really was on the path
      }
    }
    console.info(report.join("\n"));
  }, 600_000);

  it("the fingerprint tells two builds apart when anything in the starting state differs", async () => {
    const g = (await buildChallenge(DATES[0]!, undefined, now)).game;
    const fp = fingerprintOf(g);
    expect(fingerprintOf({ ...g, cash: g.cash + 1 })).not.toBe(fp);
    expect(fingerprintOf({ ...g, reputation: { ...g.reputation, popularity: g.reputation.popularity + 1e-9 } })).not.toBe(fp);
    expect(fingerprintOf({ ...g, rngState: g.rngState.map((x, i) => (i === 0 ? x ^ 1 : x)) })).not.toBe(fp);
    // Text a setting rewords (the log, review lines) isn't part of it.
    expect(fingerprintOf({ ...g, log: [] })).toBe(fp);
  });
});
