import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import type { Customer, GameState, KitchenTicket } from "@full-plate/sim-core";
import { createFixture } from "../src/fixture";
import { createSession, NO_INPUT, updateSession } from "../src/session";
import { PACING, railCapFor, rollingPpm, shiftTempo } from "../src/pacing";
import type { StationPlan } from "../src/station";
import type { HandsOnSession } from "../src/types";
import { DT } from "./helpers";

// Soup is the station's own course (round 5): a party with a burger can have two soups on the rail at once.
const plan: StationPlan = { level: 0, title: "Commis station", label: "Soup", dishIds: ["tomato_soup"], cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2, coverTicks: 8, coursed: ["tomato_soup"] };
const tk = (id: string, createdTick: number): KitchenTicket => ({ id, customerId: "c-x", dishId: "tomato_soup", createdTick, ticksRemaining: 3, quality: 0 });
function state(n: number, party: Partial<Customer> = {}): GameState {
  const f = createFixture({ role: "chef", seed: 3 }).state;
  const c: Customer = { ...f.customers[0]!, id: "c-x", stage: "ordered", order: ["beef_burger", "tomato_soup", "tomato_soup"], ...party };
  return { ...f, customers: [c], tickets: Array.from({ length: n }, (_, i) => tk(`t${i}`, i)) };
}
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

  it("round 5, pace to the pass: a ticket in hand slows the clock; the tick that would cover it waits while they work", () => {
    const st = { ...state(2), tick: 3 };
    const holding = { ...s0, carrying: { kind: "raw" as const, ticketId: "t0", dishId: "tomato_soup" }, claimed: { t0: true as const }, time: 50, lastActiveAt: 49 };
    expect(shiftTempo(holding, st).secondsPerTick).toBe(PACING.workSpt[0]);
    // its party is eating the mains and finishes at tick 10: the sim's sous chef sends the soup at tick 9
    const eating = { ...state(2, { stage: "eating", courseOut: true, eatUntil: 10, servedTick: 2 }), tick: 8 };
    expect(shiftTempo(holding, eating).secondsPerTick).toBeCloseTo(PACING.workSpt[0]! * PACING.lastTickStretch);
    // …but not for a player who has wandered off
    expect(shiftTempo({ ...holding, lastActiveAt: 50 - PACING.workingSecs - 1 }, eating).secondsPerTick).toBe(PACING.workSpt[0]);
    // a main (not its own course) is due coverTicks after it fired
    const mainPlan = { ...plan, coursed: [] };
    const m0 = { ...createSession(st, "chef", { content, station: mainPlan, playerStaffId: "player" }), carrying: holding.carrying, claimed: holding.claimed, time: 50, lastActiveAt: 49 };
    expect(shiftTempo(m0, { ...st, tick: 6 }).secondsPerTick).toBe(PACING.workSpt[0]);
    expect(shiftTempo(m0, { ...st, tick: 7 }).secondsPerTick).toBeCloseTo(PACING.workSpt[0]! * PACING.lastTickStretch);
  });
});
