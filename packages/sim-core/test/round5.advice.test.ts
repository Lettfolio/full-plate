/**
 * Round 5 review: the evening's "trim the rota" tip (advice.ts) and the `learner` owner who acts on it.
 * Typical/hard survived 0/100 since round 2 because the typical owner never trims doubled-up shifts in losing weeks.
 */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { playOne, STRATEGIES } from "../src/headless";
import { rotaAdvice } from "../src/advice";
import { shiftCost } from "../src/systems/finance";
import type { DayResult, GameState, Staff } from "../src/types";

const day = (profit: number, i: number) => ({ day: i, profit }) as DayResult;
const person = (id: string, role: Staff["role"], rota: boolean[], wage = 1300) => ({ id, name: id.toUpperCase(), role, rota, wage }) as Staff;
const FIRST = [false, false, true, true, true, true, true];
const COVER_WEEKEND = [true, true, false, false, true, true, true];

function state(profits: number[], staff: Staff[]): Pick<GameState, "history" | "staff"> {
  return { history: profits.map(day), staff };
}

describe("rotaAdvice", () => {
  const team = [person("c1", "chef", FIRST), person("c2", "chef", COVER_WEEKEND), person("w1", "server", FIRST)];

  it("names the later hire's doubled-up days after a losing fortnight, with their weekly cost", () => {
    const a = rotaAdvice(state(Array(14).fill(-2_000), team))!;
    expect(a.staffId).toBe("c2");
    expect(a.doubledDays).toEqual([4, 5, 6]); // Fri, Sat, Sun (Mon/Tue cover c1's days off)
    expect(a.weeklyCost).toBe(shiftCost({ wage: 1300 }) * 3);
    expect(a.dailyLoss).toBe(-2_000);
  });

  it("says nothing with under 14 days, a profitable fortnight, or no doubled-up shifts", () => {
    expect(rotaAdvice(state(Array(13).fill(-2_000), team))).toBeUndefined();
    expect(rotaAdvice(state([...Array(13).fill(-2_000), 40_000], team))).toBeUndefined();
    expect(rotaAdvice(state(Array(14).fill(-2_000), [person("c1", "chef", FIRST), person("c2", "chef", [true, true, false, false, false, false, false])]))).toBeUndefined();
    expect(rotaAdvice(state(Array(14).fill(-2_000), [person("c1", "chef", FIRST)]))).toBeUndefined();
  });

  it("reads history up to `end` (the learner's 'seen it N evenings running') and is pure on frozen input", () => {
    const s = Object.freeze(state([...Array(14).fill(-2_000), ...Array(14).fill(50_000)], team));
    expect(rotaAdvice(s, 14)?.staffId).toBe("c2");
    expect(rotaAdvice(s)).toBeUndefined();
  });
});

describe("learner vs typical on hard (real content, owner year 1)", () => {
  it("acting on the tip turns some typical busts into survivors; it never makes one worse off at the end", () => {
    // Seeds where typical busts on hard (all of them, in 100) — the learner survives a share (33/100 on the full run).
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let saved = 0;
    for (const seed of seeds) {
      const t = playOne(content, seed, 365, STRATEGIES.typical, "hard");
      const l = playOne(content, seed, 365, STRATEGIES["learner-rota"], "hard");
      expect(t.survived).toBe(false);
      if (l.survived) saved++;
      expect(l.daysPlayed).toBeGreaterThanOrEqual(t.daysPlayed - 30);
    }
    expect(saved).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
