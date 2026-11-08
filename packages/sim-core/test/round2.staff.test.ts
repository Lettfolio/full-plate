/** Round 2: owner covering, staff that matter, TRAIN and GIVE_BREAK. */
import { describe, expect, it } from "vitest";
import { applyCommand, runDay, tick } from "../src/index";
import { BREAK_TICKS, OWNER, TRAINING_FEE } from "../src/constants";
import { cooksOnShift, cookTicks, plateQuality } from "../src/systems/kitchen";
import { charmUpgradeChance, tipOf } from "../src/systems/payment";
import { charmPatienceMult } from "../src/systems/service";
import { nextOwnerFatigue } from "../src/systems/staffMood";
import { coveringRoles, frontCharm, ownerStats, serverActionsPerTick } from "../src/systems/system";
import { dirtyTicksFor } from "../src/systems/clearing";
import type { GameState } from "../src/types";
import { C, inService, ready, readyEmpty, rng, staffMember, step, stocked } from "./helpers";

const dish = C.dishes.find((d) => d.id === "steak")!;

describe("the owner covering", () => {
  it("covers missing roles; covering both halves kitchen throughput and floor actions", () => {
    const s = ready();
    expect(coveringRoles(s)).toEqual([]);
    const none = { ...s, staff: [] };
    expect(coveringRoles(none)).toEqual(["chef", "server"]);
    const chefOnly = { ...s, staff: s.staff.filter((x) => x.role === "chef") };
    expect(coveringRoles(chefOnly)).toEqual(["server"]);
    expect(ownerStats(chefOnly).actions).toBeCloseTo(OWNER.serverActions);
    expect(ownerStats(none).actions).toBeCloseTo(OWNER.serverActions / 2);
    const owner = cooksOnShift(C, none)[0]!;
    expect(owner.id).toBe("owner");
    expect(owner.passDelay).toBe(1);
    expect(cookTicks(dish, owner.speed, "x", owner.focus)).toBeGreaterThan(cookTicks(dish, owner.speed, "x"));
    expect(dirtyTicksFor(none)).toBeGreaterThan(dirtyTicksFor(chefOnly));
    expect(frontCharm(C, none)).toBe(OWNER.charm);
  });

  it("is set on the state at START_SERVICE and recorded on the DayResult", () => {
    const owner = step(stocked(readyEmpty()), ...ready().staff.map((x) => ({ type: "FIRE" as const, staffId: x.id })));
    const open = step({ ...owner, staff: [] }, { type: "START_SERVICE" });
    expect(open.ownerCovering).toEqual(["chef", "server"]);
    expect(open.log.some((l) => /cooking AND serving/.test(l.text))).toBe(true);
    const done = runDay(C, open).state;
    expect(done.history.at(-1)!.ownerCovered).toEqual(["chef", "server"]);
    expect(runDay(C, ready()).state.history.at(-1)!.ownerCovered).toEqual([]);
  });

  it("owner fatigue builds while covering, persists, wears the owner down and recovers on staffed days", () => {
    // Fatigue follows the rota (who was meant to be in today), not the live minute-by-minute ownerCovering.
    const staffed = ready();
    const s = { ...staffed, staff: [], todays: { reviews: [], covers: 30 } };
    expect(nextOwnerFatigue(s)).toBeCloseTo(2 * 22 + 3);
    expect(nextOwnerFatigue({ ...staffed, todays: { reviews: [], covers: 30 }, ownerFatigue: 50 })).toBe(25);
    // A short break doesn't count as covering the role for the day.
    expect(nextOwnerFatigue({ ...staffed, ownerCovering: ["chef"], todays: { reviews: [], covers: 30 }, ownerFatigue: 50 })).toBe(25);
    const tired = { ...s, staff: [], ownerFatigue: 100 };
    expect(ownerStats(tired).skill).toBeLessThan(ownerStats({ ...tired, ownerFatigue: 0 }).skill);
    expect(serverActionsPerTick(C, tired)).toBeLessThan(serverActionsPerTick(C, { ...tired, ownerFatigue: 0 }));
    let alone: GameState = { ...ready(), staff: [] };
    for (let d = 0; d < 3; d++) {
      alone = runDay(C, alone).state;
      const ev = C.events.find((e) => e.id === alone.activeEvent?.eventId);
      alone = ev ? step(alone, { type: "RESOLVE_EVENT", choiceId: ev.choices.at(-1)!.id }) : step(alone, { type: "END_DAY" });
      alone = stocked(alone, 30);
    }
    expect(alone.ownerFatigue).toBeGreaterThan(80);
  });

  it("a day with nobody rostered does worse than a staffed day", () => {
    let staffed = 0;
    let owner = 0;
    let staffedRating = 0;
    let ownerRating = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const a = runDay(C, stocked(ready(seed), 80)).state.history.at(-1)!;
      const b = runDay(C, { ...stocked(ready(seed), 80), staff: [] }).state.history.at(-1)!;
      staffed += a.covers;
      owner += b.covers;
      staffedRating += a.averageRating;
      ownerRating += b.averageRating;
    }
    expect(owner).toBeLessThan(staffed * 0.75);
    expect(ownerRating).toBeLessThan(staffedRating);
  });
});

describe("good staff pay", () => {
  it("skill lifts plate quality more than one-for-one around the pivot; speed cuts cook time", () => {
    const cook = (skill: number, speed = 50) => ({ id: "x", skill, speed, fatigue: 0, mistakeMult: 0, capacity: 3, drinksOnly: false });
    const q = (skill: number) => plateQuality(rng(1), dish, cook(skill), 0).quality;
    expect(q(80) - q(60)).toBeGreaterThan(20);
    expect(cookTicks(dish, 90, "a")).toBeLessThan(cookTicks(dish, 30, "a"));
    // Fractional cook times are dithered per ticket so even one-tick dishes reward speed on average.
    const oneTick = { ...dish, prepTicks: 1 };
    const mean = (speed: number) => Array.from({ length: 200 }, (_, i) => cookTicks(oneTick, speed, `t${i}`)).reduce((a, b) => a + b, 0) / 200;
    expect(mean(20)).toBeGreaterThan(mean(80));
  });

  it("charm slows patience loss, raises tips and can turn a 3★ into a 4★", () => {
    expect(charmPatienceMult(90)).toBeLessThan(1);
    expect(charmPatienceMult(10)).toBeGreaterThan(1);
    expect(charmPatienceMult(50)).toBe(1);
    const seg = C.segments[0]!;
    expect(tipOf(seg, 5000, 5, 90)).toBeGreaterThan(tipOf(seg, 5000, 5, 30));
    expect(charmUpgradeChance(30)).toBe(0);
    expect(charmUpgradeChance(100)).toBeCloseTo(0.4);
  });

  it("a porter clears tables fastest", () => {
    const s = ready();
    expect(dirtyTicksFor({ ...s, staff: [...s.staff, staffMember({ id: "p", role: "porter" })] })).toBeLessThan(dirtyTicksFor(s));
  });
});

describe("TRAIN", () => {
  it("costs the fee, raises skill 3-6 toward potential and takes them off the floor today", () => {
    const s = ready();
    const chef = s.staff.find((x) => x.role === "chef")!;
    const trained = step(s, { type: "TRAIN", staffId: chef.id });
    const after = trained.staff.find((x) => x.id === chef.id)!;
    expect(trained.cash).toBe(s.cash - TRAINING_FEE);
    expect(after.skill - chef.skill).toBeGreaterThanOrEqual(3);
    expect(after.skill - chef.skill).toBeLessThanOrEqual(Math.min(6, chef.potential - chef.skill));
    expect(after.trainingDay).toBe(s.day);
    const open = step(trained, { type: "START_SERVICE" });
    expect(open.ownerCovering).toEqual(["chef"]);
    const evening = runDay(C, open).state;
    const later = evening.staff.find((x) => x.id === chef.id)!;
    expect(later.trainingDay).toBeUndefined();
    expect(later.fatigue).toBe(chef.fatigue); // no shift worked
  });

  it("rejects twice in a day, at potential, without cash, outside planning, or for strangers", () => {
    const s = ready();
    const id = s.staff[0]!.id;
    const once = step(s, { type: "TRAIN", staffId: id });
    for (const bad of [
      { state: once, staffId: id },
      { state: { ...s, staff: s.staff.map((x) => ({ ...x, potential: x.skill })) }, staffId: id },
      { state: { ...s, cash: 0 }, staffId: id },
      { state: { ...s, phase: "evening" as const }, staffId: id },
      { state: s, staffId: "nobody" },
    ]) {
      const r = applyCommand(C, bad.state, { type: "TRAIN", staffId: bad.staffId });
      expect(r.state.staff).toBe(bad.state.staff);
      expect(r.events[0]!.type).toBe("LOG");
    }
  });
});

describe("GIVE_BREAK", () => {
  it("cuts fatigue by 20 and takes them off the floor for ~6 ticks", () => {
    let s: GameState = step({ ...ready(), staff: ready().staff.map((x) => ({ ...x, fatigue: 50 })) }, { type: "START_SERVICE" });
    s = tick(C, s).state;
    const server = s.staff.find((x) => x.role === "server")!;
    const before = s.service!.actionsPerTick;
    const r = applyCommand(C, s, { type: "GIVE_BREAK", staffId: server.id });
    const on = r.state.staff.find((x) => x.id === server.id)!;
    expect(on.fatigue).toBe(30);
    expect(on.breakUntilTick).toBe(s.tick + BREAK_TICKS);
    expect(r.state.service!.actionsPerTick).toBeLessThan(before);
    expect(coveringRoles(r.state)).toEqual(["server"]);
    expect(applyCommand(C, r.state, { type: "GIVE_BREAK", staffId: server.id }).state.staff).toBe(r.state.staff);
    let t = r.state;
    for (let i = 0; i <= BREAK_TICKS; i++) t = tick(C, t).state; // back on the floor at tick + 6; flag cleared next tick
    expect(t.staff.find((x) => x.id === server.id)!.breakUntilTick).toBeUndefined();
    expect(t.service!.actionsPerTick).toBeCloseTo(before);
  });

  it("re-homes a chef's tickets while they rest", () => {
    let s: GameState = step(ready(), { type: "START_SERVICE" });
    while (!s.tickets.some((t) => t.chefId && t.chefId !== "owner")) s = tick(C, s).state;
    const chef = s.staff.find((x) => x.role === "chef")!;
    s = step(s, { type: "GIVE_BREAK", staffId: chef.id });
    s = tick(C, s).state;
    expect(s.tickets.every((t) => t.chefId !== chef.id)).toBe(true);
  });

  it("only during service, for someone on the floor", () => {
    const s = ready();
    expect(applyCommand(C, s, { type: "GIVE_BREAK", staffId: s.staff[0]!.id }).events[0]!.type).toBe("LOG");
    const svc = inService({ ...s, staff: s.staff.map((x) => ({ ...x, rota: [false, false, false, false, false, false, false] })) });
    expect(applyCommand(C, svc, { type: "GIVE_BREAK", staffId: s.staff[0]!.id }).state.staff).toBe(svc.staff);
    expect(applyCommand(C, svc, { type: "GIVE_BREAK", staffId: "ghost" }).state).toEqual(svc.log ? { ...svc, log: expect.any(Array) } : svc);
  });
});

describe("review round 2: live ownerCovering", () => {
  it("a lone chef's break makes ownerCovering include chef until they're back, but the day isn't 'owner covered'", () => {
    let s = inService(ready());
    const chef = s.staff.find((x) => x.role === "chef")!;
    expect(s.staff.filter((x) => x.role === "chef")).toHaveLength(1);
    s = step(s, { type: "GIVE_BREAK", staffId: chef.id });
    expect(s.ownerCovering).toContain("chef");
    for (let i = 0; i < 12 && s.phase === "service"; i++) s = tick(C, s).state;
    expect(s.ownerCovering ?? []).not.toContain("chef");
    while (s.phase === "service") s = tick(C, s).state;
    expect(s.history.at(-1)!.ownerCovered).toEqual([]);
  });
});
