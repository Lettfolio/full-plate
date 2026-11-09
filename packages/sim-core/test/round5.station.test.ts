/**
 * Round 5: the hands-on commis station in sim time (systems/station.ts) — coursing, cover by ticket age in ticks,
 * station dilation and the commis's AI hands.
 */
import { describe, expect, it } from "vitest";
import { CHEF_PARALLEL_TICKETS, HANDS_ON } from "../src/constants";
import { applyCommand, stationRailTickets } from "../src/index";
import { cooksOnShift, deliverPlate, SHADOW_COOK_SUFFIX } from "../src/systems/kitchen";
import { serviceSystem, eatTicks } from "../src/systems/service";
import { aiTicks, startCourses, ticketsToCover } from "../src/systems/station";
import { Rng } from "../src/rng";
import type { Command, Customer, GameState, HandsOnStation, KitchenTicket } from "../src/types";
import { C, customer, inService, ready, tickOnce } from "./helpers";

const apply = (s: GameState, cmd: Command) => applyCommand(C, s, cmd);
const ticket = (id: string, customerId: string, dishId: string, over: Partial<KitchenTicket> = {}): KitchenTicket => ({
  id, customerId, dishId, createdTick: 10, ticksRemaining: 3, quality: 0, ...over,
});

/** A service with the AI chef, the human commis ("player", a copy of the AI chef) and one party c1 with `order`. */
function kitchen(order: string[], station: HandsOnStation, over: Partial<Customer> = {}): GameState {
  const s0 = inService(ready());
  const ai = s0.staff.find((x) => x.role === "chef")!;
  const me = { ...ai, id: "player", name: "Mia", skill: 22 };
  const c = customer("c1", { stage: "ordered", tableId: "T1", order, spend: 3000, stageTick: 8, patience: 90, ...over });
  const s = {
    ...s0,
    staff: [...s0.staff, me],
    tables: s0.tables.map((t) => (t.id === "T1" ? { ...t, occupiedBy: "c1" } : t)),
    customers: [c],
    tickets: order.map((d, n) => ticket(`k${n + 1}`, "c1", d, { ticksRemaining: C.dishes.find((x) => x.id === d)!.prepTicks })),
    // no new arrivals: the tests follow c1 only
    service: { ...s0.service!, arrivals: [] },
  };
  return apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player", station }).state;
}
const c1 = (s: GameState) => s.customers.find((c) => c.id === "c1")!;
const has = (s: GameState, id: string) => s.tickets.some((t) => t.id === id);
const aiChefId = (s: GameState) => s.staff.find((x) => x.role === "chef" && x.id !== "player")!.id;

describe("coursing: the station's dessert is its own course (rule 1)", () => {
  it("the party eats its mains while the human's crumble is out, pays only once it lands; the sim sends it just in time", () => {
    let s = kitchen(["burger", "crumble"], { dishIds: ["crumble"], cap: 2, coverTicks: 40 });
    while (has(s, "k1")) s = tickOnce(s); // the AI cooks the burger
    expect(c1(s)).toMatchObject({ stage: "eating", courseOut: true, platesReady: 1 });
    const eatUntil = c1(s).eatUntil!;
    expect(eatUntil - c1(s).servedTick!).toBe(eatTicks(2)); // no dilation: the burger was an AI plate
    // (systems run at s.tick, then the clock moves on)
    while (s.tick < eatUntil - HANDS_ON.courseLeadTicks) {
      s = tickOnce(s);
      expect(has(s, "k2")).toBe(true); // nobody holds up the table yet, nobody takes the human's dessert
      expect(c1(s).stage).toBe("eating");
    }
    s = tickOnce(s); // eatUntil − 1: the sous chef sends it
    expect(has(s, "k2")).toBe(false);
    expect(c1(s).courseOut).toBeUndefined();
    expect(c1(s).platesReady).toBe(2);
    expect(c1(s).eatUntil).toBe(eatUntil); // landed in time: no extra eating
    expect(s.service!.chefs![aiChefId(s)]!.plates).toBe(2); // booked to the cook who covered, not the player
    expect(s.service!.chefs!.player).toBeUndefined();
    s = tickOnce(s);
    expect(["paying", "left"]).toContain(c1(s).stage); // asked for the bill (and maybe paid) on time
    expect(c1(s).walkedOut).toBeFalsy();
  });

  it("the human plating the course during the meal ends it; a party with no main waits as before (not coursed)", () => {
    let s = kitchen(["burger", "crumble"], { dishIds: ["crumble"], cap: 2, coverTicks: 40 });
    while (has(s, "k1")) s = tickOnce(s);
    const eatUntil = c1(s).eatUntil!;
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k2", quality: 77 }).state;
    expect(c1(s)).toMatchObject({ platesReady: 2, eatUntil, qualitySum: expect.any(Number) });
    expect(c1(s).courseOut).toBeUndefined();
    expect(s.service!.chefs!.player).toEqual({ plates: 1, qualitySum: 77 });

    let solo = kitchen(["crumble", "lemonade"], { dishIds: ["crumble"], cap: 2, coverTicks: 40 });
    for (let i = 0; i < 4; i++) solo = tickOnce(solo);
    expect(c1(solo).stage).toBe("ordered");
    expect(c1(solo).courseOut).toBeUndefined();
  });

  it("startCourses is a no-op without a station (owner play is untouched)", () => {
    const s = kitchen(["burger", "crumble"], { dishIds: ["crumble"], cap: 2 });
    const { handsOn: _h, ...owner } = s;
    const fed = owner.customers.map((c) => ({ ...c, platesReady: 1 }));
    expect(startCourses(C, owner as GameState, fed, [owner.tickets[1]!])).toBe(fed);
  });
});

describe("cover by ticket age in ticks (rule 2)", () => {
  it("a rail main is covered `coverTicks` after it fired — picked up or not — at the covering cook's quality less a penalty", () => {
    for (const claim of [false, true]) {
      let s = kitchen(["burger"], { dishIds: ["burger"], cap: 2, coverTicks: 4 });
      if (claim) s = apply(s, { type: "PLAYER_CLAIMED", ticketId: "k1" }).state;
      for (let i = 0; i < 4; i++) {
        s = tickOnce(s); // the kitchen sees ages 0…3
        expect(s.tickets.find((t) => t.id === "k1")!.chefId).toBe(claim ? "player" : undefined);
      }
      expect(s.tick - 10).toBe(4);
      s = tickOnce(s); // age 4
      expect(has(s, "k1")).toBe(false);
      expect(c1(s).platesReady).toBe(1);
      const booked = s.service!.chefs![aiChefId(s)]!;
      expect(booked.plates).toBe(1);
      expect(booked.qualitySum).toBeLessThanOrEqual(75 - HANDS_ON.coverQualityHit + 10); // ceiling 75, rushed
      expect(s.service!.chefs!.player).toBeUndefined();
    }
  });

  it("a party down to HANDS_ON.coverPatience is covered at once; the default cover age is HANDS_ON.stationCoverTicks", () => {
    const s = kitchen(["burger"], { dishIds: ["burger"], cap: 2 }, { patience: HANDS_ON.coverPatience });
    expect(ticketsToCover(C, s, s.tickets).map((t) => t.id)).toEqual(["k1"]);
    const calm = kitchen(["burger"], { dishIds: ["burger"], cap: 2 });
    expect(ticketsToCover(C, { ...calm, tick: 10 + HANDS_ON.stationCoverTicks - 1 }, calm.tickets)).toEqual([]);
    expect(ticketsToCover(C, { ...calm, tick: 10 + HANDS_ON.stationCoverTicks }, calm.tickets).map((t) => t.id)).toEqual(["k1"]);
  });

  it("the rail holds at most one main: a second goes to the AI at once", () => {
    let s = kitchen(["burger", "burger", "crumble", "crumble"], { dishIds: ["burger", "crumble"], cap: 3, coverTicks: 40 });
    expect(stationRailTickets(C, s, s.handsOn!.station!).map((t) => t.id)).toEqual(["k1", "k3", "k4"]);
    s = tickOnce(s);
    expect(s.tickets.find((t) => t.id === "k2")?.chefId ?? "plated").not.toBeUndefined();
    expect(s.tickets.find((t) => t.id === "k1")!.chefId).toBeUndefined();
  });
});

describe("station dilation (rule 3)", () => {
  it("a party kept waiting by the human beyond an AI's time eats that much faster (not below the floor) and doesn't rate the wait", () => {
    let s = kitchen(["burger"], { dishIds: ["burger"], cap: 2, coverTicks: 40 });
    for (let i = 0; i < 6; i++) s = tickOnce(s);
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 }).state;
    const due = 10 + aiTicks(C, "burger");
    expect(c1(s)).toMatchObject({ dueTick: due, servedTick: s.tick });
    s = tickOnce(s); // ordered → eating at tick s.tick − 1
    const owed = c1(s).servedTick! - due;
    expect(owed).toBeGreaterThan(0);
    expect(c1(s).eatUntil! - (s.tick - 1)).toBe(Math.max(HANDS_ON.dilationMinEatTicks, eatTicks(2) - owed));
  });

  it("while every plate it waits for is on the human's rail, a party loses patience at stationPatienceMult", () => {
    const human = kitchen(["burger"], { dishIds: ["burger"], cap: 2, coverTicks: 40 });
    const ai = { ...human, tickets: human.tickets.map((t) => ({ ...t, chefId: aiChefId(human) })) };
    const fall = (s: GameState) => 90 - c1(serviceSystem(C, s, new Rng([1, 2, 3, 4])).state).patience;
    expect(fall(human)).toBeCloseTo(fall(ai) * HANDS_ON.stationPatienceMult, 5);
  });

  it("AI plates and owner play set no dueTick", () => {
    const c = customer("c9", { order: ["burger", "soup"] });
    expect(deliverPlate(c, 60, 12, undefined)).not.toHaveProperty("dueTick");
    expect(deliverPlate(deliverPlate(c, 60, 12, undefined, 11), 60, 14, undefined).dueTick).toBe(14);
  });
});

describe("the commis's AI hands (round5.claims.test.ts: never cooking twice)", () => {
  it("with a station, the player's Staff record keeps a day off's AI capacity under its own id", () => {
    const s = kitchen(["burger"], { dishIds: ["crumble"], cap: 2 });
    const cooks = cooksOnShift(C, s);
    expect(cooks.map((k) => k.id)).toContain(`player${SHADOW_COOK_SUFFIX}`);
    expect(cooks.find((k) => k.id === `player${SHADOW_COOK_SUFFIX}`)!.capacity).toBe(CHEF_PARALLEL_TICKETS);
    expect(cooks.map((k) => k.id)).not.toContain("player");
    const plain = apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player" }).state;
    expect(cooksOnShift(C, plain).map((k) => k.id).some((id) => id.startsWith("player"))).toBe(false);
  });

  it("SET_HANDS_ON keeps a sensible coverTicks and refuses a silly one", () => {
    const s = kitchen(["burger"], { dishIds: ["crumble"], cap: 2, coverTicks: 6 });
    expect(s.handsOn!.station).toEqual({ dishIds: ["crumble"], cap: 2, coverTicks: 6 });
    for (const coverTicks of [0, 2.5, HANDS_ON.stationMaxCoverTicks + 1]) {
      const r = apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player", station: { dishIds: ["crumble"], cap: 2, coverTicks } });
      expect(r.events[0]).toMatchObject({ type: "LOG", entry: { kind: "bad" } });
    }
  });
});
