import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import type { GameState, KitchenTicket, MenuItem } from "@full-plate/sim-core";
import { createFixture } from "../src/fixture";
import { createSession, NO_INPUT, openFoodTickets, updateSession } from "../src/session";
import { commisStation, STATION_LEVELS, stationTickets, type StationPlan } from "../src/station";
import { nextHint } from "../src/hints";
import { DT } from "./helpers";

const item = (dishId: string, sold7d: number): MenuItem => ({ dishId, price: 1000, active: true, sold7d, margin7d: 0 });
/** The balanced career employer's real menu (3 mains, a coffee, 2 desserts) with a week of sales. */
const EMPLOYER = [item("fish_and_chips", 70), item("steak_ale_pie", 60), item("beef_burger", 75), item("flat_white", 50), item("sticky_toffee", 9), item("brownie", 8)];

function withMenu(menu: MenuItem[]): GameState {
  return { ...createFixture({ role: "chef", seed: 3 }).state, menu };
}

describe("commisStation (round 4)", () => {
  it("a commis owns desserts plus the easiest main when the menu has no starters; higher rungs widen it", () => {
    const s0 = commisStation(withMenu(EMPLOYER), content, 0)!;
    expect(s0.dishIds).toEqual(["sticky_toffee", "brownie", "beef_burger"]);
    expect(s0.label).toBe("Desserts · Burgers");
    expect(s0).toMatchObject({ cap: STATION_LEVELS[0]!.cap, title: "Commis station" });
    const s1 = commisStation(withMenu(EMPLOYER), content, 1)!;
    expect(s1.dishIds).toEqual(["sticky_toffee", "brownie", "beef_burger", "fish_and_chips"]);
    const s2 = commisStation(withMenu(EMPLOYER), content, 2)!;
    expect(s2.dishIds.length).toBe(5);
    expect(s2.label).toBe("Every food ticket");
    expect(s2.idleCoverSecs).toBeLessThan(s0.idleCoverSecs);
    // round 5: the sim covers by ticket age in ticks, tighter as the rung (and the section) grows
    expect(s0.coverTicks).toBe(8);
    expect(s1.coverTicks!).toBeLessThan(s0.coverTicks!);
    expect(s2.coverTicks!).toBeLessThan(s1.coverTicks!);
  });

  it("starters and sides come first; drinks are never on a station; an empty menu has none", () => {
    const menu = [item("tomato_soup", 30), item("chunky_chips", 30), item("beef_burger", 60), item("lager", 40)];
    const s = commisStation(withMenu(menu), content, 0)!;
    expect(s.dishIds).toEqual(["tomato_soup", "chunky_chips"]); // 50% of food already: no main needed
    expect(s.label).toBe("Starters · Sides");
    expect(commisStation(withMenu([item("lager", 3)]), content, 0)).toBeUndefined();
  });
});

describe("the player's rail and the sous chef (round 4)", () => {
  const plan = (dishIds: string[], extra: Partial<StationPlan> = {}): StationPlan => ({
    level: 0, title: "Commis station", label: "Test", dishIds, cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2, ...extra,
  });
  const tk = (id: string, dishId: string, createdTick: number, extra: Partial<KitchenTicket> = {}): KitchenTicket =>
    ({ id, customerId: "c-x", dishId, createdTick, ticksRemaining: 3, quality: 0, ...extra });
  function state(tickets: KitchenTicket[]): GameState {
    const f = createFixture({ role: "chef", seed: 3 });
    return { ...f.state, tickets };
  }

  it("shows only the station's oldest `cap` unassigned tickets; AI-assigned and other dishes are not the player's", () => {
    const party = { ...createFixture({ role: "chef", seed: 3 }).state.customers[0]!, id: "c-x", stage: "ordered" as const, order: ["beef_burger", "tomato_soup"] };
    const st = { ...state([tk("a", "tomato_soup", 1), tk("b", "beef_burger", 2), tk("c", "tomato_soup", 3, { chefId: "chef-1" }), tk("d", "tomato_soup", 4), tk("e", "tomato_soup", 5)]), customers: [party] };
    const s = createSession(st, "chef", { content, station: plan(["tomato_soup"], { coursed: ["tomato_soup"] }), playerStaffId: "player" });
    expect(stationTickets(s, st).map((t) => t.id)).toEqual(["a", "d"]);
    expect(openFoodTickets(s, st).map((t) => t.id)).toEqual(["a", "d"]);
    // round 5: at most one main on the rail (soup for a party with no main is a main; the next goes to the AI)
    const mains = createSession(st, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    expect(stationTickets(mains, st).map((t) => t.id)).toEqual(["a"]);
    expect(nextHint(s, st)?.text).toMatch(/^Your ticket: /);
    const empty = state([tk("b", "beef_burger", 2)]);
    expect(openFoodTickets(s, empty)).toEqual([]);
    expect(nextHint(s, empty)?.text).toMatch(/Commis station is clear/);
  });

  it("round 5: an idle player is nudged and reminded, but the session never plates for them (the sim covers)", () => {
    const st = state([tk("a", "tomato_soup", 1), tk("d", "tomato_soup", 4)]);
    let s = createSession(st, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    const said: string[] = [];
    const results = [];
    for (let i = 0; i < 31 * 60; i++) {
      const r = updateSession(s, st, NO_INPUT, DT);
      s = r.session;
      results.push(...r.results);
      if (s.message && said.at(-1) !== s.message.text) said.push(s.message.text);
    }
    expect(said.some((t) => t.includes("Need a hand"))).toBe(true);
    expect(said.some((t) => t.includes("still on the rail"))).toBe(true);
    expect(results.filter((r) => r.type === "PLATE_COOKED")).toEqual([]);
    expect(s.score.covered ?? 0).toBe(0);
  });

  it("round 5: a rail ticket that vanishes uncooked while its party is in was covered by the sim: let go, counted, said", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const cust = f.state.customers[0]!;
    const before: GameState = {
      ...f.state,
      customers: f.state.customers.map((c) => (c.id === cust.id ? { ...c, stage: "ordered", order: ["beef_burger", "tomato_soup", "tomato_soup"] } : c)),
      tickets: [tk("a", "tomato_soup", 1, { customerId: cust.id, chefId: "player", claimedAtTick: 2 }), tk("d", "tomato_soup", 4, { customerId: cust.id })],
    };
    let s = createSession(before, "chef", { content, station: plan(["tomato_soup"], { coursed: ["tomato_soup"] }), playerStaffId: "player" });
    s = { ...s, carrying: { kind: "raw", ticketId: "a", dishId: "tomato_soup" }, claimed: { a: true }, lastActiveAt: 0 };
    s = updateSession(s, before, NO_INPUT, DT).session;
    expect(s.railSeen?.map((x) => x.id).sort()).toEqual(["a", "d"]);
    const after: GameState = { ...before, tickets: before.tickets.filter((t) => t.id !== "a") };
    const r = updateSession(s, after, NO_INPUT, DT);
    expect(r.results.filter((x) => x.type === "PLATE_COOKED" || x.type === "DROPPED")).toEqual([]);
    expect(r.session.carrying).toBeUndefined();
    expect(r.session.score).toMatchObject({ covered: 1, plates: 0, drops: 0 });
    expect(r.session.message?.text).toMatch(/I've sent .*Soup|I've sent .*— grab your next ticket/);
    // a ticket whose table walked out is nobody's fault and not a cover
    const left: GameState = { ...after, customers: after.customers.map((c) => ({ ...c, stage: "left", walkedOut: true })), tickets: [] };
    const r2 = updateSession(r.session, left, NO_INPUT, DT);
    expect(r2.session.score.covered).toBe(1);
  });

  it("waiting for a ticket is not idling: the nudge clock starts when the work arrives", () => {
    const quiet = state([]);
    let s = createSession(quiet, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    for (let i = 0; i < 40 * 60; i++) s = updateSession(s, quiet, NO_INPUT, DT).session;
    const busy = state([tk("a", "tomato_soup", 1)]);
    const nudged = () => !!s.message?.text.includes("Need a hand");
    for (let i = 0; i < 17 * 60; i++) { s = updateSession(s, busy, NO_INPUT, DT).session; expect(nudged()).toBe(false); }
    for (let i = 0; i < 2 * 60; i++) s = updateSession(s, busy, NO_INPUT, DT).session;
    expect(nudged()).toBe(true);
  });
});

describe("a vanished station ticket (round 4)", () => {
  it("costs nothing: the table left, it isn't the player's fault", async () => {
    const { standAt, station, press } = await import("./helpers");
    const f = createFixture({ role: "chef", seed: 3 });
    const tk: KitchenTicket = { id: "a", customerId: "c-x", dishId: "tomato_soup", createdTick: 1, ticksRemaining: 3, quality: 0 };
    const st: GameState = { ...f.state, tickets: [tk] };
    let s = createSession(st, "chef", { content, playerStaffId: "player", station: { level: 0, title: "Commis station", label: "Soup", dishIds: ["tomato_soup"], cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2 } });
    s = { ...s, carrying: { kind: "cooked", ticketId: "a", dishId: "tomato_soup", prep: 1, cook: 1 }, claimed: { a: true } };
    s = standAt(s, station(s, "pass"));
    const gone: GameState = { ...st, tickets: [] };
    let r = press(s, gone);
    for (let i = 0; i < 90; i++) { const u = updateSession(r.s, gone, NO_INPUT, DT); r = { s: u.session, results: [...r.results, ...u.results] }; }
    expect(r.results.filter((x) => x.type === "DROPPED")).toEqual([]);
    expect(r.s.score.drops).toBe(0);
    expect(r.s.carrying).toBeUndefined();
  });
});
