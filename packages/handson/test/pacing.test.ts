import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import type { GameState, KitchenTicket } from "@full-plate/sim-core";
import { createFixture } from "../src/fixture";
import { createSession, NO_INPUT, updateSession } from "../src/session";
import { PACING, railCapFor, rollingPpm, shiftTempo } from "../src/pacing";
import type { StationPlan } from "../src/station";
import type { HandsOnSession } from "../src/types";
import { DT } from "./helpers";

const plan: StationPlan = { level: 0, title: "Commis station", label: "Soup", dishIds: ["tomato_soup"], cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2 };
const tk = (id: string, createdTick: number): KitchenTicket => ({ id, customerId: "c-x", dishId: "tomato_soup", createdTick, ticksRemaining: 3, quality: 0 });
const state = (n: number): GameState => ({ ...createFixture({ role: "chef", seed: 3 }).state, tickets: Array.from({ length: n }, (_, i) => tk(`t${i}`, i)) });
const at = (s: HandsOnSession, time: number, plateTimes: number[] = []): HandsOnSession => ({ ...s, time, plateTimes });

describe("station pacing (round 4)", () => {
  const s0 = createSession(state(0), "chef", { content, station: plan, playerStaffId: "player" });

  it("fast-forwards an empty rail, hurries a rail with room, and slows a full rail for a slow player", () => {
    expect(shiftTempo(s0, state(0))).toMatchObject({ secondsPerTick: PACING.drySpt, dry: true });
    expect(shiftTempo(s0, state(1)).secondsPerTick).toBeCloseTo(PACING.baseSpt[0]! * PACING.roomFactor);
    // full rail, on target (warm-up)
    expect(shiftTempo(s0, state(2)).secondsPerTick).toBeCloseTo(PACING.baseSpt[0]!);
    // full rail, two plates in two minutes (1/min vs 2.2 target): the restaurant slows to the cap
    const slow = at(s0, 120, [30, 90]);
    expect(rollingPpm(slow)).toBeCloseTo(1);
    expect(shiftTempo(slow, state(2)).secondsPerTick).toBeCloseTo(PACING.baseSpt[0]! * PACING.maxSlowFactor);
    // no station: the flat 1.5 s
    const plain = createSession(state(2), "chef", { content });
    expect(shiftTempo(plain, state(2)).secondsPerTick).toBe(PACING.flatSpt);
  });

  it("a fast player earns a bigger rail; the session tells the sim (RAIL_RESIZED)", () => {
    expect(railCapFor(s0)).toBe(2);
    const quick = at(s0, 120, Array.from({ length: 7 }, (_, i) => 60 + i * 8)); // 7 plates in the last 2 min = 3.5/min
    expect(railCapFor(quick)).toBe(3);
    const r = updateSession(quick, state(0), NO_INPUT, DT);
    expect(r.results).toContainEqual({ type: "RAIL_RESIZED", cap: 3 });
    expect(r.session.railCap).toBe(3);
    expect(updateSession(r.session, state(0), NO_INPUT, DT).results).toEqual([]);
  });
});
