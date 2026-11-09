/** Round 5: the session never offers, keeps or bins a ticket another cook already has. */
import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import type { GameState, KitchenTicket } from "@full-plate/sim-core";
import { createFixture } from "../src/fixture";
import { createSession, NO_INPUT, openFoodTickets, updateSession } from "../src/session";
import { DT, press, standAt, station } from "./helpers";

const tk = (id: string, extra: Partial<KitchenTicket> = {}): KitchenTicket => ({ id, customerId: "c-x", dishId: "beef_burger", createdTick: 1, ticksRemaining: 3, quality: 0, ...extra });
const state = (tickets: KitchenTicket[]): GameState => ({ ...createFixture({ role: "chef", seed: 3 }).state, tickets });

describe("a ticket another cook has (round 5)", () => {
  it("is never offered, and one the sim refused (PLAYER_CLAIMED) is let go at no cost", () => {
    const st = state([tk("a")]);
    let s = createSession(st, "chef", { content });
    expect(openFoodTickets(s, st).map((t) => t.id)).toEqual(["a"]);
    const taken = state([tk("a", { chefId: "chef-1" })]);
    expect(openFoodTickets(createSession(taken, "chef", { content }), taken)).toEqual([]);
    s = { ...s, carrying: { kind: "raw", ticketId: "a", dishId: "beef_burger" }, claimed: { a: true } };
    const r = updateSession(s, taken, NO_INPUT, DT);
    expect(r.session.carrying).toBeUndefined();
    expect(r.results).toEqual([]);
    expect(r.session.score.drops).toBe(0);
    expect(r.session.message?.text).toMatch(/Another chef already has that one/);
  });

  it("a plate whose ticket already went out is not binned: no DROPPED, no lost points", () => {
    const st = state([tk("a", { chefId: "player", claimedAtTick: 1 })]);
    let s = createSession(st, "chef", { content });
    s = { ...s, carrying: { kind: "cooked", ticketId: "a", dishId: "beef_burger", prep: 1, cook: 1 }, claimed: { a: true } };
    s = standAt(s, station(s, "pass"));
    const gone = state([]);
    let r = press(s, gone);
    for (let i = 0; i < 90; i++) { const u = updateSession(r.s, gone, NO_INPUT, DT); r = { s: u.session, results: [...r.results, ...u.results] }; }
    expect(r.results.filter((x) => x.type === "DROPPED")).toEqual([]);
    expect(r.s.score).toMatchObject({ drops: 0, points: 0 });
  });
});
