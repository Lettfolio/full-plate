/** Round 2: IncidentSystem — conditions, limits, options, timeouts, and the evening summary. */
import { describe, expect, it } from "vitest";
import { applyCommand, runDay, tick } from "../src/index";
import { INCIDENT, INCIDENT_MAX_LIVE } from "../src/constants";
import { INCIDENT_TEXT, fill } from "../src/incidents/text";
import { closeIncidents, cornerShopCost, floorSystem, incidentSystem, liveIncidents, respondIncident } from "../src/systems/incidents";
import { multMod } from "../src/systems/system";
import type { GameState, Incident, IncidentKind } from "../src/types";
import { C, customer, inService, ready, rng, staffMember, step } from "./helpers";

/** Runs incidentSystem on a state until an incident of `kind` starts (or gives up). */
function startOne(s0: GameState, kind: IncidentKind, tries = 400): { state: GameState; inc: Incident } {
  for (let seed = 1; seed < tries; seed++) {
    const r = incidentSystem(C, s0, rng(seed));
    const inc = liveIncidents(r.state).find((i) => i.kind === kind);
    if (inc) return { state: r.state, inc };
  }
  throw new Error(`no ${kind} incident started`);
}

function respond(s: GameState, inc: Incident, optionId: string): GameState {
  const r = applyCommand(C, s, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId });
  expect(r.events.some((e) => e.type === "INCIDENT_RESOLVED")).toBe(true);
  return r.state;
}

const seatedAt = (id: string, table: string, over = {}) =>
  customer(id, { stage: "eating", tableId: table, stageTick: 10, order: ["burger", "soup"], qualitySum: 60, platesReady: 2, servedTick: 10, spend: 2100, eatUntil: 18, ...over });

describe("incident conditions", () => {
  it("a plate below quality 45 can be sent back; remake ties up a chef, replaces the plate and books food cost", () => {
    const base = inService(ready());
    const s = { ...base, customers: [seatedAt("c1", "T1", { eatUntil: 12 })] }; // mean quality 30
    const { state, inc } = startOne(s, "sent_back");
    expect(inc.options.map((o) => o.id)).toEqual(["remake", "comp", "apologise"]);
    expect(inc.options.find((o) => o.id === "comp")!.cost).toBe(2100);
    expect(inc.tableId).toBe("T1");
    expect(inc.ticksLeft).toBeGreaterThanOrEqual(6);
    expect(inc.ticksLeft).toBeLessThanOrEqual(12);
    const after = respond(state, inc, "remake");
    const remake = after.tickets.find((t) => t.remakeOf !== undefined)!;
    expect(remake.chefId).toBe(after.staff.find((x) => x.role === "chef")!.id);
    expect(remake.ticksRemaining).toBe(INCIDENT.remakeTicks);
    expect(after.service!.foodCost).toBeGreaterThan(0);
    expect(after.customers[0]!.eatUntil).toBe(state.tick + INCIDENT.remakeTicks + INCIDENT.remakeWaitTicks);
    expect(after.incidents![0]!.outcome).toMatch(/table 1/);
    expect(after.incidentsHandled).toBe(1);
  });

  it("comp frees the meal; apologise adds a charm-scaled bonus", () => {
    const s = { ...inService(ready()), customers: [seatedAt("c1", "T1")] };
    const { state, inc } = startOne(s, "sent_back");
    expect(respond(state, inc, "comp").customers[0]!.comped).toBe(true);
    const sorry = respond(state, inc, "apologise").customers[0]!;
    expect(sorry.satisfactionBonus).toBeGreaterThan(0);
    expect(sorry.satisfactionBonus).toBeLessThanOrEqual(INCIDENT.apologyMaxBonus);
  });

  it("ignoring a sent-back plate costs satisfaction on timeout", () => {
    const s = { ...inService(ready()), customers: [seatedAt("c1", "T1", { eatUntil: 99 })] };
    let { state } = startOne(s, "sent_back");
    for (let i = 0; i < 13 && liveIncidents(state).length; i++) state = incidentSystem(C, { ...state, tick: state.tick + 1 }, rng(i)).state;
    expect(state.incidents![0]!.resolution).toBe("ignored");
    expect(state.customers[0]!.satisfactionBonus).toBe(INCIDENT.sentBackIgnoredHit);
  });

  it("spills: mopping ties up the floor briefly unless a porter is on", () => {
    const s = { ...inService(ready()), customers: Array.from({ length: 6 }, (_, i) => seatedAt(`c${i}`, `T${i + 1}`, { qualitySum: 160 })) };
    const { state, inc } = startOne(s, "spill");
    const mopped = respond(state, inc, "mop");
    expect(mopped.service!.mods!.some((m) => m.kind === "actions" && m.value < 0)).toBe(true);
    const porter = { ...state, staff: [...state.staff, staffMember({ id: "p", role: "porter" })] };
    expect(respond(porter, inc, "mop").service!.mods!.some((m) => m.kind === "actions")).toBe(false);
    expect(respond(state, inc, "leave").customers.find((c) => c.id === inc.customerId)!.satisfactionBonus).toBeLessThan(0);
  });

  it("big parties: pushing two tables together seats them (and ties up a server); declining costs a little popularity", () => {
    const base = inService(ready());
    const s = { ...base, service: { ...base.service!, arrivals: [{ segment: "families", potentialParties: 40, entryLogit: 0 }] } };
    const { state, inc } = startOne(s, "big_party", 2000);
    expect(inc.value).toBeGreaterThan(C.balance.seatsPerTable);
    const pushed = respond(state, inc, "push");
    const guest = pushed.customers.at(-1)!;
    expect(guest.partySize).toBe(inc.value);
    expect(pushed.tables.filter((t) => t.occupiedBy === guest.id)).toHaveLength(2);
    const declined = respond(state, inc, "decline");
    expect(declined.service!.popularityBonus).toBeLessThan(0);
    // No room: two free clean tables are needed.
    const full = { ...state, tables: state.tables.map((t) => ({ ...t, occupiedBy: "x" })) };
    const r = applyCommand(C, full, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: "push" });
    expect(r.state.incidents).toEqual(full.incidents);
  });

  it("rushes need a long queue on a busy day; the surge and the fixes are timed mods", () => {
    const base = inService(ready());
    const queue = Array.from({ length: 5 }, (_, i) => customer(`q${i}`, { stage: "queue" }));
    const s = { ...base, customers: queue, service: { ...base.service!, potentialParties: 60 } };
    const { state, inc } = startOne(s, "rush");
    expect(multMod(state, "arrivals")).toBeCloseTo(INCIDENT.rushArrivalMult);
    const called = respond(state, inc, "callin");
    expect(called.cash).toBe(state.cash - INCIDENT.rushCallInCost);
    expect(called.service!.incidentCosts).toBe(INCIDENT.rushCallInCost);
    expect(multMod(called, "kitchen")).toBeGreaterThan(1);
    const simple = respond(state, inc, "simplify");
    expect(simple.eightySixed).toContain(inc.dishId);
    // A quiet day never rushes.
    const quiet = { ...s, service: { ...s.service!, potentialParties: 5 } };
    for (let i = 1; i < 60; i++) expect(liveIncidents(incidentSystem(C, quiet, rng(i)).state).some((x) => x.kind === "rush")).toBe(false);
  });

  it("supplier short: the corner shop costs 2.5× and adds stock; pulling 86s every dish that needs it", () => {
    const base = inService(ready());
    const s = { ...base, shortDelivery: { ingredientId: "beef", missing: 10 } };
    const { state, inc } = startOne(s, "supplier_short");
    const cost = cornerShopCost(C, state);
    expect(cost).toBe(Math.round(320 * 10 * 2.5));
    const shop = respond(state, inc, "shop");
    expect(shop.cash).toBe(state.cash - cost);
    expect(shop.stock.find((x) => x.ingredientId === "beef")!.qty).toBe(50);
    expect(shop.stock.find((x) => x.ingredientId === "beef")!.batches!.at(-1)!.cost).toBe(800);
    expect(shop.shortDelivery).toBeUndefined();
    const beef = C.ingredients.find((x) => x.id === "beef")!.name;
    expect(shop.incidents![0]!.outcome).toContain(`10 ${beef}`); // not "10 stock" (text filled before shortDelivery clears)
    const pulled = respond(state, inc, "pull");
    expect(pulled.eightySixed).toEqual(expect.arrayContaining(["burger", "steak"]));
  });

  it("equipment slows the kitchen until fixed; the engineer is quick but costs", () => {
    const base = inService(ready());
    const s = { ...base, tickets: [{ id: "t1", customerId: "c", dishId: "burger", createdTick: 0, ticksRemaining: 3, quality: 0 }] };
    const { state, inc } = startOne(s, "equipment", 4000);
    expect(multMod(state, "kitchen")).toBeLessThan(1);
    const eng = respond(state, inc, "engineer");
    expect(eng.cash).toBe(state.cash - INCIDENT.engineerCost);
    expect(multMod(eng, "kitchen")).toBeCloseTo(INCIDENT.engineerKitchen);
    const fixed = respond(state, inc, "fix");
    expect(multMod(fixed, "kitchen")).toBeCloseTo(INCIDENT.equipmentFixKitchen);
  });

  it("VIPs only come once popular; their rating moves prestige", () => {
    const base = inService(ready());
    const seated = [customer("v", { stage: "seated", tableId: "T1", stageTick: 10 })];
    const unpopular = { ...base, customers: seated, reputation: { popularity: 50, prestige: 50 } };
    for (let i = 1; i < 200; i++) expect(liveIncidents(incidentSystem(C, unpopular, rng(i)).state).some((x) => x.kind === "vip")).toBe(false);
    const s = { ...base, customers: seated, reputation: { popularity: 80, prestige: 50 } };
    const { state, inc } = startOne(s, "vip", 4000);
    expect(state.customers[0]!.vip).toBe(true);
    const best = respond(state, inc, "best");
    expect(best.customers[0]!.satisfactionBonus).toBeGreaterThan(0);
    const free = respond(state, inc, "freebie");
    expect(free.cash).toBeLessThan(state.cash);
    // Paying: a 5★ critic adds prestige.
    const paying = { ...best, customers: [{ ...best.customers[0]!, stage: "paying" as const, order: ["steak"], qualitySum: 95, platesReady: 1, servedTick: 10, spend: 2600, satisfactionBonus: 30 }] };
    const r = tick(C, paying);
    expect(r.state.service!.prestigeBonus).toBeGreaterThan(0);
  });

  it("staff wobble when tired; a break takes them off the floor and the floor system brings them back", () => {
    const base = inService(ready());
    const tired = { ...base, staff: base.staff.map((x) => (x.role === "server" ? { ...x, fatigue: 90 } : x)) };
    const { state, inc } = startOne(tired, "staff_wobble");
    const server = state.staff.find((x) => x.id === inc.staffId)!;
    const rested = respond(state, inc, "break");
    const after = rested.staff.find((x) => x.id === server.id)!;
    expect(after.fatigue).toBe(70);
    expect(after.breakUntilTick).toBe(state.tick + 6);
    expect(rested.service!.actionsPerTick).toBeLessThan(state.service!.actionsPerTick + 1e-9);
    const back = floorSystem(C, { ...rested, tick: state.tick + 6 }, rng()).state;
    expect(back.staff.find((x) => x.id === server.id)!.breakUntilTick).toBeUndefined();
    expect(respond(state, inc, "push").staff.find((x) => x.id === server.id)!.mood).toBeLessThan(server.mood);
  });
});

describe("incident limits and plumbing", () => {
  it("never more than 2 live, never two of a kind, and a gap between starts", () => {
    let s: GameState = step(ready(3), { type: "START_SERVICE" });
    let maxLive = 0;
    while (s.phase === "service") {
      const live = liveIncidents(s);
      maxLive = Math.max(maxLive, live.length);
      expect(new Set(live.map((i) => i.kind)).size).toBe(live.length);
      s = tick(C, s).state;
    }
    expect(maxLive).toBeLessThanOrEqual(INCIDENT_MAX_LIVE);
  });

  it("averages 1-3 incidents per service and lists them in the DayResult", () => {
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = runDay(C, ready(seed)).state;
      const day = r.history.at(-1)!;
      total += day.incidents!.length;
      for (const i of day.incidents!) expect(i.outcome.length).toBeGreaterThan(0);
    }
    expect(total / 10).toBeGreaterThanOrEqual(1);
    expect(total / 10).toBeLessThanOrEqual(3);
  });

  it("rejects bad responses with a reason and leaves state alone", () => {
    const s = { ...inService(ready()), customers: [seatedAt("c1", "T1")] };
    const { state, inc } = startOne(s, "sent_back");
    for (const cmd of [
      { incidentId: "nope", optionId: "comp" },
      { incidentId: inc.id, optionId: "nope" },
    ]) {
      const r = applyCommand(C, state, { type: "RESPOND_INCIDENT", ...cmd });
      expect(r.state.incidents).toBe(state.incidents);
      expect(r.events[0]!.type).toBe("LOG");
    }
    const done = respond(state, inc, "comp");
    expect(applyCommand(C, done, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: "comp" }).state.incidents).toBe(done.incidents);
    expect(applyCommand(C, { ...state, phase: "planning" }, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: "comp" }).events[0]!.type).toBe("LOG");
    const broke = { ...inService(ready()), cash: 0, shortDelivery: { ingredientId: "beef", missing: 10 } };
    const short = startOne(broke, "supplier_short");
    expect(respondIncident(C, short.state, short.inc.id, "shop")).toHaveProperty("error");
  });

  it("closing time resolves anything still live without effects", () => {
    const s = { ...inService(ready()), customers: [seatedAt("c1", "T1")] };
    const { state } = startOne(s, "sent_back");
    const closed = closeIncidents(state).state;
    expect(liveIncidents(closed)).toHaveLength(0);
    expect(closed.incidents![0]!.resolution).toBe("ignored");
    expect(closed.customers).toEqual(state.customers);
  });

  it("every kind has text for every option it offers, and fill() leaves unknown placeholders visible", () => {
    for (const t of Object.values(INCIDENT_TEXT)) {
      expect(t.title.length).toBeGreaterThan(0);
      for (const o of Object.values(t.options)) expect(o.label && o.description && o.outcome).toBeTruthy();
    }
    expect(fill("Hi {name}, {who}", { name: "Ali" })).toBe("Hi Ali, {who}");
  });
});

describe("integration: contract polish (tone, disabled, reward, start log)", () => {
  it("INCIDENT_RESOLVED carries a tone; the start line is info without a doubled '!'", () => {
    const s = { ...inService(ready()), customers: Array.from({ length: 6 }, (_, i) => seatedAt(`c${i}`, `T${i + 1}`, { qualitySum: 160 })) };
    let found: { state: GameState; inc: Incident; events: import("../src/types").SimEvent[] } | undefined;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const r = incidentSystem(C, s, rng(seed));
      const inc = liveIncidents(r.state).find((i) => i.kind === "spill");
      if (inc) found = { state: r.state, inc, events: r.events };
    }
    const { state, inc, events } = found!;
    const start = events.find((e) => e.type === "LOG")!;
    expect(start.type === "LOG" && start.entry.kind).toBe("info");
    expect(start.type === "LOG" && start.entry.text).toBe(inc.title);
    expect(inc.title.endsWith("!!")).toBe(false);
    const tone = (opt: string) => {
      const r = applyCommand(C, state, { type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: opt });
      const e = r.events.find((x) => x.type === "INCIDENT_RESOLVED");
      return e?.type === "INCIDENT_RESOLVED" ? e.tone : undefined;
    };
    expect(tone("mop")).toBe("good");
    expect(tone("leave")).toBe("bad");
  });

  it("push tables is disabled (with a reason) while there aren't two free tables, and re-enabled when there are", () => {
    const base = inService(ready());
    const s = { ...base, service: { ...base.service!, arrivals: [{ segment: "families", potentialParties: 40, entryLogit: 0 }] } };
    const { state, inc } = startOne(s, "big_party", 2000);
    expect(inc.options.find((o) => o.id === "push")!.disabled).toBeUndefined();
    const full = { ...state, tables: state.tables.map((t) => ({ ...t, occupiedBy: "x" })), tick: state.tick + 1 };
    const next = incidentSystem(C, full, rng(1)).state;
    const push = next.incidents!.find((i) => i.id === inc.id)!.options.find((o) => o.id === "push")!;
    expect(push.disabled).toMatch(/two free/i);
    const freed = incidentSystem(C, { ...next, tables: state.tables, tick: next.tick + 1 }, rng(2)).state;
    expect(freed.incidents!.find((i) => i.id === inc.id)!.options.find((o) => o.id === "push")!.disabled).toBeUndefined();
  });

  it("GOAL_COMPLETED carries the reward it paid", () => {
    let s = ready();
    let reward: unknown;
    for (let d = 0; d < 6 && reward === undefined; d++) {
      const r = runDay(C, s);
      for (const e of r.events) if (e.type === "GOAL_COMPLETED" && e.reward) reward = e.reward;
      s = r.state.phase === "event" ? applyCommand(C, r.state, { type: "RESOLVE_EVENT", choiceId: "x" }).state : applyCommand(C, r.state, { type: "END_DAY" }).state;
    }
    expect(reward).toMatchObject({});
    expect(Object.keys(reward as object).length).toBeGreaterThan(0);
  });
});

describe("review round 2: the porter earns its keep", () => {
  it("a porter mops a spill before it needs a decision, and adds front-of-house actions", async () => {
    const { serverActionsPerTick } = await import("../src/systems/system");
    const base = inService(ready());
    const porter = staffMember({ id: "p", role: "porter" });
    const withPorter = { ...base, staff: [...base.staff, porter], customers: Array.from({ length: 6 }, (_, i) => seatedAt(`c${i}`, `T${i + 1}`, { qualitySum: 160 })) };
    expect(serverActionsPerTick(C, withPorter)).toBeCloseTo(serverActionsPerTick(C, base) + 0.5);
    let done: Incident | undefined;
    for (let seed = 1; seed < 400 && !done; seed++) done = incidentSystem(C, withPorter, rng(seed)).state.incidents?.find((i) => i.kind === "spill");
    expect(done!.resolution).toBe("porter");
    expect(done!.outcome).toMatch(/porter mopped/);
  });
});
