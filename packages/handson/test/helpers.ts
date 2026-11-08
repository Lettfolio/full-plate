import type { GameState } from "@full-plate/sim-core";
import { content } from "@full-plate/content";
import { createFixture, type Fixture } from "../src/fixture";
import { createSession, NO_INPUT, updateSession } from "../src/session";
import type { HandsOnInput, HandsOnResult, HandsOnRole, HandsOnSession, Station } from "../src/types";

export const DT = 1 / 60;

export function setup(role: HandsOnRole, shiftSeconds?: number): { f: Fixture; s: HandsOnSession } {
  const f = createFixture({ role, seed: 42 });
  const s = createSession(f.state, role, { content, seed: 7, ...(shiftSeconds ? { shiftSeconds } : {}) });
  return { f, s };
}

export const input = (p: Partial<HandsOnInput> = {}): HandsOnInput => ({ ...NO_INPUT, ...p });

/** Runs frames with a constant input; returns the final session and every result. */
export function run(s: HandsOnSession, state: GameState, inp: HandsOnInput, frames: number): { s: HandsOnSession; results: HandsOnResult[] } {
  const results: HandsOnResult[] = [];
  for (let i = 0; i < frames; i++) {
    const r = updateSession(s, state, inp, DT);
    s = r.session;
    results.push(...r.results);
  }
  return { s, results };
}

/** Puts the player on a free tile beside a station, facing it. */
export function standAt(s: HandsOnSession, st: Station): HandsOnSession {
  const out = structuredClone(s);
  const cands = [
    { x: st.x + st.w / 2, y: st.y + st.h + 0.5, facing: "up" as const },
    { x: st.x + st.w / 2, y: st.y - 0.5, facing: "down" as const },
    { x: st.x - 0.5, y: st.y + st.h / 2, facing: "right" as const },
    { x: st.x + st.w + 0.5, y: st.y + st.h / 2, facing: "left" as const },
  ];
  for (const c of cands) {
    const row = out.grid[Math.floor(c.y)];
    if (row && row[Math.floor(c.x)] === "." && row[Math.floor(c.x - 0.32)] === "." && row[Math.floor(c.x + 0.31)] === ".") {
      out.player = { ...out.player, x: Math.floor(c.x) + 0.5, y: Math.floor(c.y) + 0.5, facing: c.facing, vx: 0, vy: 0 };
      return out;
    }
  }
  throw new Error(`no free tile beside ${st.id}`);
}

export function station(s: HandsOnSession, id: string): Station {
  const st = s.stations.find((x) => x.id === id);
  if (!st) throw new Error(`no station ${id}`);
  return st;
}

/** One press of interact (a frame down, a frame up). */
export function press(s: HandsOnSession, state: GameState): { s: HandsOnSession; results: HandsOnResult[] } {
  const a = updateSession(s, state, input({ interact: true }), DT);
  const b = updateSession(a.session, state, input(), DT);
  return { s: b.session, results: [...a.results, ...b.results] };
}

/** Waits until the active action finishes (fixed-duration verbs). */
export function waitAction(s: HandsOnSession, state: GameState, max = 400) {
  const results: HandsOnResult[] = [];
  for (let i = 0; i < max && s.activeAction; i++) {
    const r = updateSession(s, state, input(), DT);
    s = r.session;
    results.push(...r.results);
  }
  return { s, results };
}
