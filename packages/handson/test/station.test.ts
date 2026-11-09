import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import type { GameState, KitchenTicket, MenuItem } from "@full-plate/sim-core";
import { createFixture } from "../src/fixture";
import { COVER_PATIENCE, createSession, NO_INPUT, openFoodTickets, updateSession } from "../src/session";
import { commisStation, COVER_EXECUTION, STATION_LEVELS, stationTickets, type StationPlan } from "../src/station";
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
    const st = state([tk("a", "tomato_soup", 1), tk("b", "beef_burger", 2), tk("c", "tomato_soup", 3, { chefId: "chef-1" }), tk("d", "tomato_soup", 4), tk("e", "tomato_soup", 5)]);
    const s = createSession(st, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    expect(stationTickets(s, st).map((t) => t.id)).toEqual(["a", "d"]);
    expect(openFoodTickets(s, st).map((t) => t.id)).toEqual(["a", "d"]);
    expect(nextHint(s, st)?.text).toMatch(/^Your ticket: /);
    const empty = state([tk("b", "beef_burger", 2)]);
    expect(openFoodTickets(s, empty)).toEqual([]);
    expect(nextHint(s, empty)?.text).toMatch(/Commis station is clear/);
  });

  it("an idle player is nudged, then the sous chef covers the oldest ticket (lower quality, no points)", () => {
    const st = state([tk("a", "tomato_soup", 1), tk("d", "tomato_soup", 4)]);
    let s = createSession(st, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    let nudged = false;
    const results = [];
    for (let i = 0; i < 31 * 60; i++) {
      const r = updateSession(s, st, NO_INPUT, DT);
      s = r.session;
      results.push(...r.results);
      if (s.message?.text.includes("Need a hand")) nudged = true;
    }
    expect(nudged).toBe(true);
    const covered = results.filter((r) => r.type === "PLATE_COOKED");
    expect(covered).toHaveLength(1);
    expect(covered[0]).toMatchObject({ ticketId: "a", covered: true, execution: COVER_EXECUTION, speedBonus: 0 });
    expect(s.score).toMatchObject({ covered: 1, idleCovers: 1, plates: 0, points: 0 });
    expect(s.message?.text).toMatch(/plated .*Soup|grab your next ticket/);
    expect(stationTickets(s, st).map((t) => t.id)).toEqual(["d"]);
  });

  it("round 4 review: a table about to give up is covered at once, even while the player is busy with it", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const cust = f.state.customers[0]!;
    const mk = (patience: number): GameState => ({
      ...f.state,
      customers: f.state.customers.map((c) => (c.id === cust.id ? { ...c, stage: "ordered", patience } : c)),
      tickets: [tk("a", "tomato_soup", 1, { customerId: cust.id }), tk("d", "tomato_soup", 4)],
    });
    const calm = mk(80);
    let s = createSession(calm, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    s = { ...s, carrying: { kind: "raw", ticketId: "a", dishId: "tomato_soup" }, claimed: { a: true }, lastActiveAt: 0 };
    const r0 = updateSession(s, calm, NO_INPUT, DT);
    expect(r0.results.filter((r) => r.type === "PLATE_COOKED")).toEqual([]);
    const cross = mk(COVER_PATIENCE);
    const r1 = updateSession(r0.session, cross, NO_INPUT, DT);
    expect(r1.results.filter((r) => r.type === "PLATE_COOKED")).toEqual([expect.objectContaining({ ticketId: "a", covered: true })]);
    expect(r1.session.carrying).toBeUndefined();
    expect(r1.session.message?.text).toMatch(/can't wait any longer/);
    expect(r1.session.score.idleCovers ?? 0).toBe(0);
  });

  it("waiting for a ticket is not idling: the clock starts when the work arrives", () => {
    const quiet = state([]);
    let s = createSession(quiet, "chef", { content, station: plan(["tomato_soup"]), playerStaffId: "player" });
    for (let i = 0; i < 40 * 60; i++) s = updateSession(s, quiet, NO_INPUT, DT).session;
    const busy = state([tk("a", "tomato_soup", 1)]);
    let out = 0;
    for (let i = 0; i < 20 * 60; i++) { const r = updateSession(s, busy, NO_INPUT, DT); s = r.session; out += r.results.length; }
    expect(out).toBe(0);
    for (let i = 0; i < 11 * 60; i++) { const r = updateSession(s, busy, NO_INPUT, DT); s = r.session; out += r.results.length; }
    expect(out).toBe(1);
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
