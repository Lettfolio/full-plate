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
import { render, type HandsOnView } from "../src/render";
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

describe("R13-C: scripted scores are unchanged by the phone layout", () => {
  for (const role of ["chef", "server", "bar"] as const) {
    it(`${role}: the golden score, with and without drawing`, () => {
      expect(scripted(role, 0.7)).toEqual(GOLDEN[role]);
    });
  }
});
