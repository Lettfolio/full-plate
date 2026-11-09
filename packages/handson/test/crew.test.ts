/** Round 6: the crew on the canvas — rail owners, the course marker, the helper at her station, the sous chef's walk. */
import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { HANDS_ON, type Customer, type GameState, type KitchenTicket } from "@full-plate/sim-core";
import { createFixture } from "../src/fixture";
import { createSession, NO_INPUT, updateSession } from "../src/session";
import type { StationPlan } from "../src/station";
import { courseMarkers, coverSoon, helperAtWork, railView } from "../src/crew";
import { bookSousWalk, PASS_STAND, SOUS_POST, SOUS_WALK, SOUS_WALK_TOTAL, sousLine, sousPose, RAIL_STAND_Y } from "../src/sous";
import { render } from "../src/render";
import { DT } from "./helpers";

const plan: StationPlan = {
  level: 0, title: "Commis station", label: "Desserts · Burgers", dishIds: ["brownie", "beef_burger"], cap: 2,
  idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2, coverTicks: 8, coursed: ["brownie"],
};
const tk = (id: string, customerId: string, dishId: string, createdTick: number, extra: Partial<KitchenTicket> = {}): KitchenTicket =>
  ({ id, customerId, dishId, createdTick, ticksRemaining: 3, quality: 0, ...extra });

/** Two parties at tables 1 and 2: c1 eats a burger + brownie, c2 a burger. */
function world(tickets: KitchenTicket[], c1: Partial<Customer> = {}, tick = 5): GameState {
  const f = createFixture({ role: "chef", seed: 3 });
  const [a, b] = f.state.customers.length >= 2 ? f.state.customers : [f.state.customers[0]!, { ...f.state.customers[0]!, id: "c-b" }];
  const t1 = f.state.tables[0]!.id, t2 = f.state.tables[1]!.id;
  const customers: Customer[] = [
    { ...a!, id: "c1", tableId: t1, stage: "ordered", order: ["beef_burger", "brownie"], patience: 90, ...c1 },
    { ...b!, id: "c2", tableId: t2, stage: "ordered", order: ["beef_burger"], patience: 90 },
  ];
  const tables = f.state.tables.map((t) => (t.id === t1 ? { ...t, occupiedBy: "c1" } : t.id === t2 ? { ...t, occupiedBy: "c2" } : t));
  return { ...f.state, tick, customers, tables, tickets, handsOn: { role: "chef", staffId: "kid", since: 0, station: { dishIds: plan.dishIds, cap: 2, coverTicks: 8 } } } as GameState;
}
const session = (st: GameState) => createSession(st, "chef", { content, station: plan, playerStaffId: "kid" });

describe("railView: hers, the sous chef's, a helper's", () => {
  it("her rail is hers; a ticket due to be covered within a tick is the sous chef's; her dishes on other cooks are helpers'", () => {
    const st = world([
      tk("b1", "c1", "beef_burger", 1),
      tk("d1", "c1", "brownie", 1),
      tk("b2", "c2", "beef_burger", 2, { chefId: "kid~ai" }), // the second main went to her AI hands
      tk("x", "c2", "fish_and_chips", 2, { chefId: "chef-1" }), // not her station: never on her rail
    ]);
    const s = session(st);
    expect(railView(s, st).map((e) => [e.ticket.id, e.owner, e.cook])).toEqual([
      ["b1", "hers", undefined], ["d1", "hers", undefined], ["b2", "helper", "kid~ai"],
    ]);
    // b1 fired at tick 1, covered 8 ticks after: at tick 8 it goes within a tick
    expect(railView(s, { ...st, tick: 7 })[0]!.owner).toBe("hers");
    expect(railView(s, { ...st, tick: 8 })[0]!.owner).toBe("sous");
    // a table at its last patience is covered at once (not its own course)
    const cross = world(st.tickets, { patience: HANDS_ON.coverPatience });
    expect(coverSoon(s, cross, cross.tickets[0]!)).toBe(true);
    expect(coverSoon(s, cross, cross.tickets[1]!)).toBe(false); // the brownie is its own course: patience doesn't send it
    // helpers capped, nothing without a station
    expect(railView(s, st, 0).map((e) => e.owner)).toEqual(["hers", "hers"]);
    expect(railView(createSession(st, "chef", { content }), st)).toEqual([]);
  });

  it("a coursed ticket whose party is eating the mains is marked as the course coming", () => {
    const st = world([tk("d1", "c1", "brownie", 1)], { stage: "eating", courseOut: true, servedTick: 4, eatUntil: 14, platesReady: 1 });
    const [e] = railView(session(st), st);
    expect(e).toMatchObject({ owner: "hers", course: true });
  });
});

describe("courseMarkers: dessert coming", () => {
  it("shows on a table eating its mains while its course cooks, fills towards the cover tick, and clears when it lands", () => {
    const eating = { stage: "eating" as const, courseOut: true, servedTick: 4, eatUntil: 14, platesReady: 1 };
    const st = world([tk("d1", "c1", "brownie", 1)], eating, 4);
    const s = session(st);
    const [k] = courseMarkers(s, st);
    const due = 14 - HANDS_ON.courseLeadTicks;
    expect(k).toMatchObject({ customerId: "c1", tableId: st.customers[0]!.tableId, ticketIds: ["d1"], dishIds: ["brownie"], owner: "hers", progress: 0, dueTick: due });
    expect(courseMarkers(s, { ...st, tick: 4 + (due - 4) / 2 })[0]!.progress).toBeCloseTo(0.5);
    expect(courseMarkers(s, { ...st, tick: due + 3 })[0]!.progress).toBe(1);
    // the course has started but the party isn't eating yet (startCourses this tick): marker, empty ring
    const starting = world([tk("d1", "c1", "brownie", 1)], { ...eating, stage: "ordered", eatUntil: undefined }, 4);
    expect(courseMarkers(s, starting)[0]).toMatchObject({ progress: 0, dueTick: Infinity });
    // a helper cooking it: still marked, sky not tomato
    const helped = world([tk("d1", "c1", "brownie", 1, { chefId: "chef-1" })], eating, 6);
    expect(courseMarkers(s, helped)[0]!.owner).toBe("helper");
    // landed: courseOut cleared (sim-core deliverPlate) → no marker; plated by her (session.cooked) → no marker
    expect(courseMarkers(s, world([], { stage: "eating", servedTick: 4, eatUntil: 16, platesReady: 2 }, 8))).toEqual([]);
    expect(courseMarkers({ ...s, cooked: { d1: true } }, st)).toEqual([]);
    // no course out → nothing
    expect(courseMarkers(s, world([tk("d1", "c1", "brownie", 1)]))).toEqual([]);
  });
});

describe("helperAtWork: her AI hands at her station", () => {
  it("finds the oldest station dish on `<staffId>~ai`, at the dish's own station", () => {
    const st = world([
      tk("b2", "c2", "beef_burger", 3, { chefId: "kid~ai" }),
      tk("d9", "c2", "brownie", 2, { chefId: "kid~ai" }),
      tk("x", "c2", "fish_and_chips", 1, { chefId: "kid~ai" }), // not her station's dish
    ]);
    const s = session(st);
    expect(helperAtWork(s, st)).toMatchObject({ cook: "kid~ai", stationId: "oven" });
    expect(helperAtWork(s, world([tk("b2", "c2", "beef_burger", 3, { chefId: "kid~ai" })]))?.stationId).toBe(s.dishes["beef_burger"]?.method === "none" ? "prep" : s.dishes["beef_burger"]?.method);
    expect(helperAtWork(s, world([tk("b2", "c2", "beef_burger", 3, { chefId: "chef-1" })]))).toBeUndefined();
    expect(helperAtWork(s, world([tk("b2", "c2", "beef_burger", 3, { chefId: "kid~ai", ticksRemaining: 0, atPass: true })]))).toBeUndefined();
  });
});

describe("the sous chef's walk (cosmetic)", () => {
  const railX = (slot: number) => 6 + slot * 4;
  it("walks post → under the slip → the pass → back, carrying from the take until the plate is down", () => {
    const walks = bookSousWalk(undefined, { ticketId: "d1", dishId: "brownie", table: 3 }, 1, 10);
    expect(walks).toEqual([{ items: [{ ticketId: "d1", dishId: "brownie", table: 3 }], slot: 1, at: 10 }]);
    expect(sousPose(walks, 9.9, railX)).toMatchObject({ phase: "idle", x: SOUS_POST.x, y: SOUS_POST.y, talking: false });
    expect(sousPose(walks, 10, railX)).toMatchObject({ phase: "toRail", x: SOUS_POST.x, carrying: false, talking: true, facing: "left" });
    const atRail = sousPose(walks, 10 + SOUS_WALK.toRail + 0.01, railX);
    expect(atRail).toMatchObject({ phase: "take", facing: "up" });
    expect(atRail.x).toBeCloseTo(10); expect(atRail.y).toBeCloseTo(RAIL_STAND_Y);
    expect(sousPose(walks, 10 + SOUS_WALK.toRail + SOUS_WALK.take * 0.75, railX).carrying).toBe(true);
    const toPass = sousPose(walks, 10 + SOUS_WALK.toRail + SOUS_WALK.take + SOUS_WALK.toPass / 2, railX);
    expect(toPass).toMatchObject({ phase: "toPass", carrying: true, moving: true });
    const set = sousPose(walks, 10 + SOUS_WALK.toRail + SOUS_WALK.take + SOUS_WALK.toPass + 0.01, railX);
    expect(set).toMatchObject({ phase: "set", x: PASS_STAND.x, y: PASS_STAND.y });
    expect(sousPose(walks, 10 + SOUS_WALK_TOTAL - 0.01, railX)).toMatchObject({ phase: "back", talking: false, carrying: false });
    expect(sousPose(walks, 10 + SOUS_WALK_TOTAL, railX).phase).toBe("idle");
    const short = (d: string) => (d === "brownie" ? "Brownie" : "Chips");
    expect(sousLine([{ dishId: "brownie", table: 3 }], short)).toBe("I've got table 3's Brownie!");
    expect(sousLine([{ dishId: "brownie" }], short)).toBe("I've got the Brownie!");
    expect(sousLine([{ dishId: "chips", table: 1 }, { dishId: "chips", table: 5 }], short)).toBe("I've got the Chips for tables 1 and 5!");
    expect(sousLine([{ dishId: "chips", table: 2 }, { dishId: "brownie", table: 4 }, { dishId: "chips", table: 6 }], short)).toBe("I've got tables 2, 4 and 6!");
    expect(sousLine([{ dishId: "chips", table: 2 }, { dishId: "chips", table: 2 }], short)).toBe("I've got the Chips for table 2!");
  });

  it("a cover before he has the slip joins the trip; later ones queue one deep; never mutates", () => {
    const item = (ticketId: string) => ({ ticketId, dishId: "brownie" });
    const one = Object.freeze(bookSousWalk(undefined, item("a"), 0, 10));
    const joined = bookSousWalk(one, item("b"), 1, 10.5);
    expect(joined).toEqual([{ items: [item("a"), item("b")], slot: 0, at: 10 }]);
    expect(one[0]!.items).toHaveLength(1);
    const after = 10 + SOUS_WALK.toRail + SOUS_WALK.take;
    const two = bookSousWalk(one, item("b"), 1, after);
    expect(two.map((w) => w.at)).toEqual([10, 10 + SOUS_WALK_TOTAL]);
    // a third while the second is still queued joins it (he hasn't set off for it yet)
    expect(bookSousWalk(two, item("c"), 0, after + 0.1).map((w) => w.items.length)).toEqual([1, 2]);
    // past its take, the next trip queues behind it
    const busy = bookSousWalk(two, item("c"), 0, 10 + SOUS_WALK_TOTAL + SOUS_WALK.toRail + SOUS_WALK.take);
    expect(busy.map((w) => w.items.map((i) => i.ticketId))).toEqual([["b"], ["c"]]);
    // so a trip never waits more than one leg's worth: at most one queued behind the one walking
    expect(busy).toHaveLength(2);
    expect(bookSousWalk(two, item("d"), 2, 100)).toEqual([{ items: [item("d")], slot: 2, at: 100 }]);
  });

  it("the session books a walk when the sim covers a rail ticket (with its table and slip), and drops it when done", () => {
    const before = world([tk("b1", "c1", "beef_burger", 1), tk("b3", "c2", "brownie", 2)]);
    let s = session(before);
    s = updateSession(s, before, NO_INPUT, DT).session;
    expect(s.railSeen?.map((x) => x.id)).toEqual(["b1", "b3"]);
    const after: GameState = { ...before, tickets: before.tickets.filter((t) => t.id !== "b3") };
    s = updateSession(s, after, NO_INPUT, DT).session;
    expect(s.score.covered).toBe(1);
    expect(s.sousWalks).toEqual([{ items: [{ ticketId: "b3", dishId: "brownie", table: 2 }], slot: 1, at: s.time }]);
    for (let i = 0; i < Math.ceil((SOUS_WALK_TOTAL + SOUS_WALK.toRail + 0.1) / DT); i++) s = updateSession(s, after, NO_INPUT, DT).session;
    expect(s.sousWalks).toBeUndefined();
  });
});

describe("render (round 6 crew)", () => {
  /** A recording 2D context: every call is a no-op; fonts and texts are kept. */
  function fakeCtx() {
    const texts: { text: string; px: number }[] = [];
    let font = "";
    const grad = { addColorStop() {} };
    const target: Record<string, unknown> = {
      fillText: (t: string) => texts.push({ text: t, px: Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0) }),
      strokeText: () => {}, measureText: (t: string) => ({ width: t.length * 7 }), createLinearGradient: () => grad,
    };
    const ctx = new Proxy(target, {
      get: (o, k: string) => (k in o ? o[k] : k === "font" ? font : () => {}),
      set: (o, k: string, v) => { if (k === "font") font = v; else o[k] = v; return true; },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
  }

  it("draws the sous chef's line, the helper badge, the HELPER pill and the course marker, all text ≥ 13 px", () => {
    const st = world(
      [tk("d1", "c1", "brownie", 1), tk("b2", "c2", "beef_burger", 2, { chefId: "kid~ai" })],
      { stage: "eating", courseOut: true, servedTick: 4, eatUntil: 14, platesReady: 1 },
      6,
    );
    const s = { ...session(st), time: 20, sousWalks: [{ items: [{ ticketId: "q", dishId: "brownie", table: 1 }], slot: 0, at: 19.5 }] };
    const { ctx, texts } = fakeCtx();
    render(ctx, s, st, { width: 1024, height: 600 });
    const all = texts.map((t) => t.text);
    expect(all).toContain("I've got table 1's Brownie!");
    expect(all).toContain("helping");
    expect(all).toContain("HELPER");
    expect(Math.min(...texts.map((t) => t.px))).toBeGreaterThanOrEqual(13);
  });
});
