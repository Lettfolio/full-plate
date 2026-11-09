/** Round 3 hooks: hands-on commands, pass hold, closed days, set menus, owner profile, recruitment fee, DayResult extras. */
import { describe, expect, it } from "vitest";
import { content as libraryContent, fullContent, goalText, incidentText } from "../../content/src/index";
import {
  CLOSED_DAY_WAGE_SHARE,
  HANDS_ON,
  PLAYER_COOK_ID,
  RECRUITMENT_FEE,
  Rng,
  STRATEGIES,
  applyCommand,
  candidates,
  deserialize,
  expectedCovers,
  goalLadderOf,
  hashSeed,
  incidentLinesOf,
  incidentTextOf,
  newGame,
  recruitmentFeeOf,
  runDay,
  runStrategyDay,
  serialize,
  setFootfallMod,
  shiftCost,
  strategies,
  suggestedOrder,
  tick,
} from "../src/index";
import { INCIDENT_LINES, INCIDENT_TEXT } from "../src/incidents/text";
import { GOAL_LADDER } from "../src/goals/text";
import { ownerStats } from "../src/systems/system";
import { worksToday } from "../src/util";
import { entryLogit, offeredDishes, setOfferFor } from "../src/systems/arrival";
import { satisfactionOf } from "../src/systems/payment";
import type { Command, ContentPack, Customer, GameState, KitchenTicket } from "../src/types";
import { C, customer, fresh, inService, playDays, ready, step, tickOnce } from "./helpers";

const ticket = (id: string, customerId: string, over: Partial<KitchenTicket> = {}): KitchenTicket => ({
  id, customerId, dishId: "burger", createdTick: 10, ticksRemaining: 3, quality: 0, ...over,
});

/** A service state with one seated-and-ordered party c1 (2 × burger) and their two tickets. */
function withOrder(s0 = ready(), over: Partial<Customer> = {}): GameState {
  const s = inService(s0);
  const c = customer("c1", { stage: "ordered", tableId: "T1", order: ["burger", "burger"], spend: 2 * 1450, stageTick: 8, ...over });
  return {
    ...s,
    tables: s.tables.map((t) => (t.id === "T1" ? { ...t, occupiedBy: "c1" } : t)),
    customers: [c],
    tickets: [ticket("k1", "c1"), ticket("k2", "c1")],
  };
}

const apply = (s: GameState, cmd: Command) => applyCommand(C, s, cmd);
const rejected = (s: GameState, cmd: Command) => {
  const r = apply(s, cmd);
  expect(r.events[0]).toMatchObject({ type: "LOG", entry: { kind: "bad" } });
  const { log: _a, ...after } = r.state;
  const { log: _b, ...before } = s;
  expect(after).toEqual(before);
};

describe("exports", () => {
  it("re-exports Rng/hashSeed and the strategies namespace", () => {
    expect(new Rng([1, 2, 3, 4]).float()).toBeTypeOf("number");
    expect(Rng.fromSeed(hashSeed(1, 2)).getState()).toHaveLength(4);
    expect(strategies.STRATEGIES.typical).toBe(STRATEGIES.typical);
    expect(typeof strategies.playOne).toBe("function");
  });

  it("runStrategyDay plays one owner day from planning to the next planning", () => {
    const s0 = fresh(4);
    const s1 = runStrategyDay(C, s0, STRATEGIES.balanced);
    expect(s1.phase).toBe("planning");
    expect(s1.day).toBe(1);
    expect(s1.menu.length).toBeGreaterThan(0);
    expect(s1.history).toHaveLength(1);
    // Same as the first day of playOne.
    let s = fresh(4);
    for (let d = 0; d < 5; d++) s = runStrategyDay(C, s, STRATEGIES.balanced);
    expect(s.day).toBe(5);
  });
});

describe("PLAYER_COOKED", () => {
  it("plates a ticket now with the clamped quality and delivers it (no hands-on hold)", () => {
    const s = withOrder();
    const r = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 140 });
    expect(r.events).toContainEqual({ type: "DISH_PLATED", ticketId: "k1", quality: 100 });
    expect(r.state.tickets.map((t) => t.id)).toEqual(["k2"]);
    const c = r.state.customers[0]!;
    expect(c.platesReady).toBe(1);
    expect(c.qualitySum).toBe(100);
    expect(r.state.service!.plates).toBe(1);
    expect(r.state.service!.chefs![PLAYER_COOK_ID]).toEqual({ plates: 1, qualitySum: 100 });
    expect(r.state.service!.dishes.burger!.plated).toBe(1);
    expect(apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: -5 }).state.customers[0]!.qualitySum).toBe(0);
  });

  it("holds the plate at the pass when a human is serving", () => {
    const s = { ...withOrder(), handsOn: { role: "server" as const, since: 0 } };
    const r = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 });
    const t = r.state.tickets.find((x) => x.id === "k1")!;
    expect(t).toMatchObject({ atPass: true, platedAtTick: 10, quality: 70, ticksRemaining: 0 });
    expect(r.state.customers[0]!.platesReady).toBe(0);
  });

  it("rejects unknown tickets, plates already at the pass, non-numbers and outside service", () => {
    const s = withOrder();
    rejected(s, { type: "PLAYER_COOKED", ticketId: "nope", quality: 50 });
    rejected(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: Number.NaN });
    const held = { ...s, tickets: [ticket("k1", "c1", { atPass: true, quality: 60, ticksRemaining: 0 })] };
    rejected(held, { type: "PLAYER_COOKED", ticketId: "k1", quality: 50 });
    rejected(ready(), { type: "PLAYER_COOKED", ticketId: "k1", quality: 50 });
  });

  it("a human-cooked ticket is never also cooked by the AI", () => {
    const s = { ...withOrder(), handsOn: { role: "server" as const, since: 0 } };
    let cur = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 80 }).state;
    cur = tickOnce(cur);
    expect(cur.service!.chefs![PLAYER_COOK_ID]!.plates).toBe(1);
    expect(cur.tickets.find((t) => t.id === "k1")!.quality).toBe(80);
  });
});

describe("PLAYER_SERVED", () => {
  const held = (over: Partial<KitchenTicket> = {}) => {
    const s = { ...withOrder(), handsOn: { role: "server" as const, since: 0 } };
    return { ...s, tickets: [ticket("k1", "c1", { atPass: true, platedAtTick: 9, quality: 72, ticksRemaining: 0, ...over }), ticket("k2", "c1")] };
  };

  it("delivers a held plate and adds up to +8 satisfaction across the party's plates", () => {
    const r = apply(held(), { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k1", speedBonus: 1 });
    const c = r.state.customers[0]!;
    expect(r.state.tickets.map((t) => t.id)).toEqual(["k2"]);
    expect(c.platesReady).toBe(1);
    expect(c.qualitySum).toBe(72);
    expect(c.satisfactionBonus).toBe(HANDS_ON.speedBonusSatisfaction / 2);
    // speedBonus is clamped to 0-1
    expect(apply(held(), { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k1", speedBonus: 9 }).state.customers[0]!.satisfactionBonus).toBe(4);
    expect(apply(held(), { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k1", speedBonus: -1 }).state.customers[0]!.satisfactionBonus).toBe(0);
  });

  it("serving the last plate sets servedTick so the party eats", () => {
    let s = apply(held(), { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k1", speedBonus: 0.5 }).state;
    s = { ...s, tickets: [ticket("k2", "c1", { atPass: true, platedAtTick: 10, quality: 60, ticksRemaining: 0 })] };
    s = apply(s, { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k2", speedBonus: 0.5 }).state;
    expect(s.customers[0]!.servedTick).toBe(10);
    expect(s.customers[0]!.satisfactionBonus).toBe(4);
  });

  it("rejects plates not at the pass, the wrong table and parties that left", () => {
    const s = held();
    rejected(s, { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k2", speedBonus: 1 });
    rejected(s, { type: "PLAYER_SERVED", customerId: "c9", ticketId: "k1", speedBonus: 1 });
    const gone = { ...s, customers: s.customers.map((c) => ({ ...c, stage: "left" as const })) };
    rejected(gone, { type: "PLAYER_SERVED", customerId: "c1", ticketId: "k1", speedBonus: 1 });
  });
});

describe("pass hold and AI fallback", () => {
  it("with a human server, AI-cooked plates wait at the pass; an AI server carries them after passHoldTicks", () => {
    let s: GameState = { ...withOrder(), handsOn: { role: "server", since: 0 } };
    const chef = s.staff.find((x) => x.role === "chef")!.id;
    s = { ...s, tickets: [ticket("k1", "c1", { ticksRemaining: 1, chefId: chef }), ticket("k2", "c1", { ticksRemaining: 1, chefId: chef })] };
    s = tickOnce(s); // tick 10: both plated
    const plated = s.tickets.filter((t) => t.atPass);
    expect(plated).toHaveLength(2);
    expect(plated[0]!.platedAtTick).toBe(10);
    expect(s.customers[0]!.platesReady).toBe(0);
    for (let i = 1; i < HANDS_ON.passHoldTicks; i++) {
      s = tickOnce(s);
      expect(s.tickets.filter((t) => t.atPass)).toHaveLength(2);
    }
    s = tickOnce(s); // waited passHoldTicks
    expect(s.tickets).toHaveLength(0);
    expect(s.customers[0]!.platesReady).toBe(2);
  });

  it("with a human bar, only drinks are held", () => {
    let s: GameState = { ...withOrder(), handsOn: { role: "bar", since: 0 } };
    const chef = s.staff.find((x) => x.role === "chef")!.id;
    s = { ...s, customers: [{ ...s.customers[0]!, order: ["burger", "lemonade"] }], tickets: [ticket("k1", "c1", { ticksRemaining: 1, chefId: chef }), ticket("k2", "c1", { dishId: "lemonade", ticksRemaining: 1 })] };
    // the human bar reserves the drink; mark it plated by the player instead
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k2", quality: 75 }).state;
    s = tickOnce(s);
    expect(s.tickets.map((t) => [t.id, !!t.atPass])).toEqual([["k2", true]]);
    expect(s.customers[0]!.platesReady).toBe(1);
  });

  it("SET_HANDS_ON null releases held plates on the next tick", () => {
    let s: GameState = { ...withOrder(), handsOn: { role: "server", since: 0 } };
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 }).state;
    s = apply(s, { type: "SET_HANDS_ON", role: null }).state;
    expect(s.handsOn).toBeUndefined();
    s = tickOnce(s);
    expect(s.customers[0]!.platesReady).toBe(1);
  });

  it("a human chef: AI chefs leave the oldest 3 tickets until each has waited reserveFallbackTicks", () => {
    let s: GameState = { ...withOrder(), handsOn: { role: "chef", since: 0 } };
    const c = customer("c1", { stage: "ordered", tableId: "T1", order: Array(5).fill("burger"), spend: 5 * 1450, stageTick: 8 });
    s = { ...s, customers: [c], tickets: [1, 2, 3, 4, 5].map((n) => ticket(`k${n}`, "c1", { createdTick: 10, ticksRemaining: 20 })) };
    s = tickOnce(s);
    // one chef (capacity CHEF_PARALLEL_TICKETS) takes only tickets beyond the 3 reserved
    expect(s.tickets.slice(0, 3).every((t) => !t.chefId)).toBe(true);
    expect(s.tickets.slice(3).some((t) => t.chefId)).toBe(true);
    // the human takes k1 (plates it): only k2, k3 stay reserved, k4/k5 already AI
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 }).state;
    for (let i = 0; i < HANDS_ON.reserveFallbackTicks; i++) s = tickOnce(s);
    // tick 10 + reserveFallbackTicks: the reserved ones have waited long enough and the AI picks them up
    expect(s.tickets.filter((t) => t.id === "k2" || t.id === "k3").some((t) => t.chefId)).toBe(true);
  });

  it("hands-on server: AI takes payment only after payHoldTicks; PLAYER_TOOK_PAYMENT is immediate", () => {
    const paying = (s0: GameState) => ({
      ...s0,
      tickets: [],
      customers: [customer("c1", { stage: "paying", tableId: "T1", order: ["burger"], spend: 1450, qualitySum: 70, platesReady: 1, servedTick: 9, stageTick: 10 })],
      handsOn: { role: "server" as const, since: 0 },
    });
    let s: GameState = paying(withOrder());
    for (let i = 0; i < HANDS_ON.payHoldTicks; i++) {
      s = tickOnce(s);
      expect(s.customers[0]!.stage).toBe("paying");
    }
    s = tickOnce(s);
    expect(s.customers[0]?.stage ?? "left").toBe("left");
    const r = apply(paying(withOrder()), { type: "PLAYER_TOOK_PAYMENT", customerId: "c1" });
    expect(r.state.customers[0]!.stage).toBe("left");
    expect(r.state.todays.revenue).toBe(1450);
    expect(r.state.cash).toBe(withOrder().cash + 1450);
    expect(r.events.some((e) => e.type === "CUSTOMER_PAID")).toBe(true);
    expect(r.state.service!.actionsLeft).toBe(withOrder().service!.actionsLeft); // no FOH action spent
  });

  it("a whole service with a human server who never acts still serves everyone (fallback)", () => {
    const base = ready(12);
    const open = step(base, { type: "START_SERVICE" });
    const plain = runDay(C, base).state.history.at(-1)!;
    let s = apply(open, { type: "SET_HANDS_ON", role: "server" }).state;
    while (s.phase === "service") s = tickOnce(s);
    const held = s.history.at(-1)!;
    expect(held.covers).toBeGreaterThan(plain.covers * 0.7);
    expect(s.handsOn).toBeUndefined(); // the human leaves the floor at close
  });
});

describe("PLAYER_CLEARED / PLAYER_TOOK_PAYMENT / PLAYER_DROPPED", () => {
  it("clears a dirty free table now; rejects occupied or clean tables", () => {
    const s = withOrder();
    const dirty = { ...s, tables: s.tables.map((t) => (t.id === "T2" ? { ...t, dirtyTicks: 3 } : t)) };
    expect(apply(dirty, { type: "PLAYER_CLEARED", tableId: "T2" }).state.tables.find((t) => t.id === "T2")!.dirtyTicks).toBe(0);
    rejected(dirty, { type: "PLAYER_CLEARED", tableId: "T1" });
    rejected(s, { type: "PLAYER_CLEARED", tableId: "T2" });
    rejected(s, { type: "PLAYER_CLEARED", tableId: "T99" });
  });

  it("PLAYER_TOOK_PAYMENT rejects parties that aren't paying", () => {
    rejected(withOrder(), { type: "PLAYER_TOOK_PAYMENT", customerId: "c1" });
  });

  it("PLAYER_DROPPED charges plate waste and sends tickets back to be cooked again", () => {
    let s: GameState = { ...withOrder(), handsOn: { role: "server", since: 0 } };
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 }).state;
    const before = s;
    const r = apply(s, { type: "PLAYER_DROPPED", ticketIds: ["k1"], cost: 250 });
    const t = r.state.tickets.find((x) => x.id === "k1")!;
    expect(t.atPass).toBeUndefined();
    expect(t.chefId).toBeUndefined();
    expect(t.ticksRemaining).toBe(C.dishes.find((d) => d.id === "burger")!.prepTicks);
    expect(t.createdTick).toBe(10);
    expect(r.state.cash).toBe(before.cash - 250);
    expect(r.state.service!.plateWaste).toBe(before.service!.plateWaste + 250);
    expect(r.state.service!.foodCost).toBe((before.service!.foodCost ?? 0) + 250);
    // the dropped plate is off the books
    expect(r.state.service!.plates).toBe(0);
    expect(r.state.service!.chefs![PLAYER_COOK_ID]!.plates).toBe(0);
    // capped, and rejects bad costs
    expect(apply(s, { type: "PLAYER_DROPPED", ticketIds: [], cost: 999_999 }).state.cash).toBe(before.cash - HANDS_ON.maxDropCost);
    rejected(s, { type: "PLAYER_DROPPED", ticketIds: [], cost: -1 });
    rejected(s, { type: "PLAYER_DROPPED", ticketIds: [], cost: 1.5 });
  });

  it("a dropped plate's cost reaches the day's food cost and plate waste", () => {
    let s = step(ready(5), { type: "START_SERVICE" });
    s = apply(s, { type: "PLAYER_DROPPED", ticketIds: [], cost: 300 }).state;
    while (s.phase === "service") s = tickOnce(s);
    expect(s.history.at(-1)!.waste.plate).toBeGreaterThanOrEqual(300);
  });
});

describe("SET_HANDS_ON", () => {
  it("sets the role with the service tick and an optional staffId; rejects bad input", () => {
    const s = withOrder();
    expect(apply(s, { type: "SET_HANDS_ON", role: "chef" }).state.handsOn).toEqual({ role: "chef", since: 10 });
    expect(apply(ready(), { type: "SET_HANDS_ON", role: "server" }).state.handsOn).toEqual({ role: "server", since: 0 });
    const id = s.staff[0]!.id;
    expect(apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: id }).state.handsOn).toEqual({ role: "chef", since: 10, staffId: id });
    rejected(s, { type: "SET_HANDS_ON", role: "chef", staffId: "nobody" });
    rejected(s, { type: "SET_HANDS_ON", role: "wizard" as never });
    const ev = { ...ready(), phase: "evening" as const };
    rejected(ev, { type: "SET_HANDS_ON", role: "chef" });
  });

  it("career staffId attributes the human's plates to that Staff id", () => {
    const s0 = withOrder();
    const id = s0.staff[0]!.id;
    const s = apply(s0, { type: "SET_HANDS_ON", role: "chef", staffId: id }).state;
    const r = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 66 });
    expect(r.state.service!.chefs![id]).toEqual({ plates: 1, qualitySum: 66 });
  });

  it("is cleared at END_DAY", () => {
    let s = apply(ready(), { type: "SET_HANDS_ON", role: "server" }).state;
    s = runDay(C, s).state;
    if (s.phase === "event") s = step(s, { type: "RESOLVE_EVENT", choiceId: C.events.find((e) => e.id === s.activeEvent!.eventId)!.choices.at(-1)!.id });
    else s = step(s, { type: "END_DAY" });
    expect(s.handsOn).toBeUndefined();
  });
});

describe("CLOSE_TODAY", () => {
  it("goes to the evening with a zero-cover closed DayResult; rent/loan/overheads paid, rostered wages at 50%", () => {
    const s = ready(3);
    const r = apply(s, { type: "CLOSE_TODAY" });
    const st = r.state;
    expect(["evening", "event"]).toContain(st.phase);
    const h = st.history.at(-1)!;
    expect(h).toMatchObject({ closed: true, covers: 0, revenue: 0, walkouts: 0, day: 0 });
    expect(h.rent).toBeGreaterThan(0);
    expect(h.loanPayment).toBeGreaterThan(0);
    expect(h.overheads).toBeGreaterThan(0);
    const rostered = s.staff.filter((x) => worksToday(x, s.day)).reduce((a, x) => a + shiftCost(x), 0);
    expect(rostered).toBeGreaterThan(0);
    expect(h.labourCost).toBe(Math.round(rostered * CLOSED_DAY_WAGE_SHARE));
    expect(h.ownerCovered).toEqual([]);
    expect(st.stats.daysOpen).toBe(0);
    expect(r.events.some((e) => e.type === "SERVICE_ENDED")).toBe(true);
    expect(expectedCovers(C, st)).toBe(0);
    expect(suggestedOrder(C, st)).toEqual([]);
    // staff rest
    for (const x of st.staff) expect(x.fatigue).toBe(0);
  });

  it("only in planning; the next day opens normally and still buys opening stock if never opened", () => {
    rejected(withOrder(), { type: "CLOSE_TODAY" });
    let s = apply(fresh(2), { type: "CLOSE_TODAY" }).state;
    s = step(s, { type: "END_DAY" });
    expect(s.day).toBe(1);
    expect(expectedCovers(C, s)).toBeGreaterThan(0);
    s = playDays(step(readyLike(s)), 1);
    expect(s.history.at(-1)!.covers).toBeGreaterThan(0);
  });

  it("closed days don't count as demand for the forecast", () => {
    let s = playDays(ready(4), 3);
    const before = expectedCovers(C, s);
    s = step(apply(s, { type: "CLOSE_TODAY" }).state, { type: "END_DAY" });
    expect(expectedCovers(C, s)).toBe(before);
  });
});

/** Adds the fixture menu and a chef/server to a state that may be past day 0. */
function readyLike(s0: GameState): GameState {
  let s = s0;
  for (const d of C.dishes) s = step(s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
  const pool = candidates(C, s);
  s = step(s, { type: "HIRE", candidateIndex: pool.findIndex((c) => c.role === "chef") });
  return step(s, { type: "HIRE", candidateIndex: pool.findIndex((c) => c.role === "server") });
}

describe("set menu", () => {
  const SET = ["soup", "steak", "crumble"];
  const setOn = (s: GameState, price = 6500) => step(s, { type: "SET_SET_MENU", dishIds: SET, price, active: true });

  it("SET_SET_MENU validates and stores; empty+inactive removes", () => {
    const s = setOn(ready());
    expect(s.setMenu).toEqual({ dishIds: SET, price: 6500, active: true });
    rejected(ready(), { type: "SET_SET_MENU", dishIds: ["nope"], price: 6500, active: true });
    rejected(ready(), { type: "SET_SET_MENU", dishIds: ["soup", "soup"], price: 6500, active: true });
    rejected(ready(), { type: "SET_SET_MENU", dishIds: [], price: 6500, active: true });
    rejected(ready(), { type: "SET_SET_MENU", dishIds: SET, price: 65.5, active: true });
    rejected(withOrder(), { type: "SET_SET_MENU", dishIds: SET, price: 6500, active: true });
    expect(step(s, { type: "SET_SET_MENU", dishIds: [], price: 0, active: false }).setMenu).toBeUndefined();
  });

  it("foodie parties order every set dish per guest as one sale; families stay à la carte", () => {
    let s = setOn(ready(9));
    s = step(s, { type: "START_SERVICE" });
    let sawSet = false;
    let sawCarte = false;
    while (s.phase === "service") {
      for (const c of s.customers) {
        if (c.stage === "ordered" && c.setMenu) {
          sawSet = true;
          expect(c.segment).toBe("foodies");
          expect(c.order).toHaveLength(SET.length * c.partySize);
          expect(c.spend).toBe(6500 * c.partySize);
        } else if (c.stage === "ordered" && c.segment === "families") sawCarte = true;
      }
      s = tickOnce(s);
    }
    expect(sawSet && sawCarte).toBe(true);
    const h = s.history.at(-1)!;
    // per-dish revenue sums to the day's revenue (set sales split by suggested price)
    const sum = Object.values(h.perDish!).reduce((a, d) => a + d.revenue, 0);
    expect(Math.abs(sum - h.revenue)).toBeLessThanOrEqual(Object.keys(h.perDish!).length);
  });

  it("the foodie entry/value comparison uses averageBudget × 1.6 against the set price", () => {
    const s = setOn(ready(), 5000);
    const foodies = C.segments.find((x) => x.id === "foodies")!;
    const set = setOfferFor(C, s, "foodies")!;
    expect(set.price).toBe(5000);
    expect(setOfferFor(C, s, "families")).toBeUndefined();
    const offered = offeredDishes(C, s);
    // a £50 set reads as within a tasting budget (£32 × 1.6 = £51.20), à la carte at £50/head would not
    const withSet = entryLogit(foodies, offered, 50, set);
    const asIfCarte = entryLogit({ ...foodies }, offered.map((o) => ({ ...o, item: { ...o.item, price: 5000 } })), 50);
    expect(withSet).toBeGreaterThan(asIfCarte);
    const base = { quality: 80, waitTicks: 10, spendPerHead: 5000, charm: 50, comped: false };
    expect(satisfactionOf(foodies, { ...base, budgetMult: 1.6 })).toBeGreaterThan(satisfactionOf(foodies, base));
  });

  it("the forecast and suggested order cover the set dishes", () => {
    const s = setOn(ready());
    const plain = suggestedOrder(C, { ...ready(), stock: [] });
    const withSet = suggestedOrder(C, { ...s, stock: [] });
    const qty = (xs: { ingredientId: string; qty: number }[], id: string) => xs.find((x) => x.ingredientId === id)?.qty ?? 0;
    expect(qty(withSet, "veg")).toBeGreaterThan(qty(plain, "veg"));
  });

  it("an inactive set menu changes nothing", () => {
    const s = step(ready(6), { type: "SET_SET_MENU", dishIds: SET, price: 6500, active: false });
    const a = runDay(C, ready(6)).state.history.at(-1)!;
    const b = runDay(C, s).state.history.at(-1)!;
    expect(b.covers).toBe(a.covers);
    expect(b.revenue).toBe(a.revenue);
  });

  it("the Stars path's £75 tasting menus are viable on fullContent", () => {
    const tm = (fullContent as ContentPack & { dishes: { id: string }[] }).dishes;
    expect(tm.length).toBeGreaterThan(libraryContent.dishes.length);
  });
});

describe("owner profile and recruitment fee", () => {
  it("SET_OWNER_PROFILE replaces the OWNER constants (clamped) when covering", () => {
    const s0 = fresh();
    const before = ownerStats(s0);
    const s = step(s0, { type: "SET_OWNER_PROFILE", skill: 80, speed: 70, charm: 120 });
    expect(s.ownerProfile).toEqual({ skill: 80, speed: 70, charm: 100 });
    const after = ownerStats(s);
    expect(after.skill).toBe(80);
    expect(after.charm).toBe(100);
    expect(after.skill).toBeGreaterThan(before.skill);
    rejected(s0, { type: "SET_OWNER_PROFILE", skill: Number.NaN, speed: 1, charm: 1 });
    rejected(withOrder(), { type: "SET_OWNER_PROFILE", skill: 1, speed: 1, charm: 1 });
  });

  it("a skilled owner cooks better plates than the default owner", () => {
    const solo = (s: GameState) => {
      let cur = step(s, { type: "START_SERVICE" });
      while (cur.phase === "service") cur = tickOnce(cur);
      return cur.history.at(-1)!.perChef!.owner!;
    };
    let s = fresh(7);
    for (const d of C.dishes) s = step(s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
    const plain = solo(s);
    const pro = solo(step(s, { type: "SET_OWNER_PROFILE", skill: 85, speed: 70, charm: 70 }));
    expect(pro.qualityMean).toBeGreaterThan(plain.qualityMean);
  });

  it("GameState.recruitmentFee overrides RECRUITMENT_FEE in HIRE", () => {
    const s = ready();
    expect(recruitmentFeeOf(s)).toBe(RECRUITMENT_FEE);
    const cheap = { ...fresh(), recruitmentFee: 7_500 };
    const pool = candidates(C, cheap);
    const hired = step(cheap, { type: "HIRE", candidateIndex: 0 });
    expect(hired.staff).toHaveLength(1);
    expect(cheap.cash - hired.cash).toBe(7_500);
    const normal = step(fresh(), { type: "HIRE", candidateIndex: 0 });
    expect(fresh().cash - normal.cash).toBe(RECRUITMENT_FEE);
    expect(pool.length).toBeGreaterThan(0);
  });
});

describe("DayResult extras", () => {
  it("perDish, perChef and freshnessMean are consistent with the day", () => {
    const s = playDays(ready(2), 3);
    const h = s.history.at(-1)!;
    const lines = Object.values(h.perDish!);
    expect(lines.reduce((a, d) => a + d.sold, 0)).toBeGreaterThan(0);
    const plates = Object.values(h.perChef!).reduce((a, c) => a + c.plates, 0);
    expect(plates).toBe(lines.reduce((a, d) => a + d.plated, 0));
    for (const d of lines) {
      expect(d.qualityMean).toBeGreaterThanOrEqual(0);
      expect(d.qualityMean).toBeLessThanOrEqual(100);
      expect(Number.isInteger(d.revenue) && Number.isInteger(d.foodCost)).toBe(true);
    }
    const chefIds = s.staff.filter((x) => x.role === "chef").map((x) => x.id);
    expect(Object.keys(h.perChef!).every((id) => chefIds.includes(id) || id === "owner")).toBe(true);
    expect(h.revenue).toBe(lines.reduce((a, d) => a + d.revenue, 0));
    expect(Math.abs(lines.reduce((a, d) => a + d.foodCost, 0) - h.foodCost)).toBeLessThanOrEqual(lines.length);
    expect(typeof h.freshnessMean).toBe("number");
  });
});

describe("footfall mods by source", () => {
  it("setFootfallMod replaces only its own tagged mod", () => {
    let s = { ...fresh(), footfallMods: [{ mult: 1.2, daysRemaining: 3 }, { mult: 1.1, daysRemaining: 5, source: "career" }] };
    s = setFootfallMod(s, "stars", { mult: 1.3, daysRemaining: 2 });
    s = setFootfallMod(s, "stars", { mult: 1.4, daysRemaining: 2 });
    expect(s.footfallMods).toEqual([{ mult: 1.2, daysRemaining: 3 }, { mult: 1.1, daysRemaining: 5, source: "career" }, { mult: 1.4, daysRemaining: 2, source: "stars" }]);
    s = setFootfallMod(s, "stars", null);
    expect(s.footfallMods.map((m) => m.source)).toEqual([undefined, "career"]);
    // source survives the morning tick-down
    const day = runDay(C, { ...ready(), footfallMods: s.footfallMods }).state;
    const next = day.phase === "evening" ? step(day, { type: "END_DAY" }) : day;
    if (next.phase === "planning") expect(next.footfallMods.find((m) => m.source === "career")).toEqual({ mult: 1.1, daysRemaining: 4, source: "career" });
  });
});

describe("content text and packs", () => {
  it("falls back to built-in text with no pack text, and uses pack text key by key when present", () => {
    expect(incidentTextOf(C)).toBe(INCIDENT_TEXT);
    expect(incidentLinesOf(undefined)).toBe(INCIDENT_LINES);
    expect(goalLadderOf(C)).toBe(GOAL_LADDER);
    const custom: ContentPack = {
      ...C,
      incidentText: { INCIDENT_TEXT: { spill: { ...INCIDENT_TEXT.spill, title: "Whoops, a spill!" } }, INCIDENT_LINES: { closingTime: "Doors shut." } },
      goalText: { GOAL_LADDER: [{ id: "only", kind: "add_dishes", tier: 0, title: "Add {target} dishes", hint: "Menu tab", target: 2 }, { id: "bad", kind: "nonsense", tier: 0, title: "x", hint: "y", target: 1 }], GOAL_LINES: { completed: "Yay: {title}" } },
    };
    expect(incidentTextOf(custom).spill.title).toBe("Whoops, a spill!");
    expect(incidentTextOf(custom).rush).toBe(INCIDENT_TEXT.rush);
    expect(incidentLinesOf(custom).closingTime).toBe("Doors shut.");
    expect(incidentLinesOf(custom).vipWalkout).toBe(INCIDENT_LINES.vipWalkout);
    const g = newGame(custom, { type: "NEW_GAME", seed: 1, districtId: "highstreet", restaurantName: "X", difficulty: "normal" });
    expect(g.goals!.map((x) => x.id)).toEqual(["only"]);
    const r = applyCommand(custom, applyCommand(custom, g, { type: "ADD_MENU_ITEM", dishId: "soup", price: 500 }).state, { type: "ADD_MENU_ITEM", dishId: "steak", price: 2000 });
    expect(r.events.some((e) => e.type === "LOG" && e.entry.text === "Yay: Add 2 dishes")).toBe(true);
  });

  it("the content package's incidentText/goalText give identical behaviour to the built-in text", () => {
    const pack: ContentPack = { ...libraryContent, incidentText, goalText };
    const play = (c: ContentPack) => serialize(strategies.playOne(c, 3, 30, STRATEGIES.typical, "normal").final!);
    expect(play(pack)).toBe(play(libraryContent));
  });

  it("runs on fullContent (more dishes) without assuming the library size", () => {
    const r = strategies.playOne(fullContent, 2, 20, STRATEGIES.typical, "normal");
    expect(r.daysPlayed).toBe(20);
    expect(r.covers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe("saves", () => {
  it("round-trips every round-3 field mid-service and continues identically", () => {
    let s = step(ready(8), { type: "SET_SET_MENU", dishIds: ["soup", "steak"], price: 4800, active: true }, { type: "SET_OWNER_PROFILE", skill: 60, speed: 60, charm: 60 });
    s = { ...s, recruitmentFee: 5000, footfallMods: [{ mult: 1.1, daysRemaining: 3, source: "stars" }] };
    s = step(s, { type: "START_SERVICE" }, { type: "SET_HANDS_ON", role: "server" });
    for (let i = 0; i < 40; i++) s = tickOnce(s);
    const held = s.tickets.find((t) => t.atPass);
    if (held) s = apply(s, { type: "PLAYER_SERVED", customerId: held.customerId, ticketId: held.id, speedBonus: 1 }).state;
    for (let i = 0; i < 5; i++) s = tickOnce(s);
    const json = serialize(s);
    const restored = deserialize(json);
    expect(restored.version).toBe(1);
    expect(serialize(restored)).toBe(json);
    let a = s;
    let b = restored;
    while (a.phase === "service") a = tickOnce(a);
    while (b.phase === "service") b = tickOnce(b);
    expect(serialize(b)).toBe(serialize(a));
    expect(a.history.at(-1)!.perDish).toBeDefined();
  });

  it("a closed-day evening round-trips", () => {
    const s = apply(ready(2), { type: "CLOSE_TODAY" }).state;
    expect(serialize(deserialize(serialize(s)))).toBe(serialize(s));
  });

  it("the new commands are deterministic", () => {
    const run = () => {
      let s = step(ready(5), { type: "START_SERVICE" }, { type: "SET_HANDS_ON", role: "chef" });
      for (let i = 0; i < 60; i++) {
        const t = s.tickets.find((x) => !x.chefId && !x.atPass);
        if (t && i % 3 === 0) s = apply(s, { type: "PLAYER_COOKED", ticketId: t.id, quality: 70 + (i % 20) }).state;
        s = tickOnce(s);
      }
      while (s.phase === "service") s = tick(C, s).state;
      return serialize(s);
    };
    expect(run()).toBe(run());
  });
});

describe("HIRE_STAFF (round 3 review)", () => {
  const known = (over: Partial<import("../src/types").Staff> = {}) => ({
    id: "former-orla", name: "Orla Gallagher", role: "chef" as const, skill: 74.5, speed: 61, charm: 40, wage: 1650, mood: 12, fatigue: 90,
    traits: ["steady"], hiredDay: -300, potential: 80, rota: [true, true, true, true, true, true, true], ...over,
  });

  it("hires a known person: keeps who they are, starts them fresh, charges the fee", () => {
    const s = fresh(5);
    const r = apply(s, { type: "HIRE_STAFF", staff: known() });
    const o = r.state.staff.find((x) => x.id === "former-orla")!;
    expect(o).toMatchObject({ name: "Orla Gallagher", role: "chef", skill: 74.5, wage: 1650, potential: 80, traits: ["steady"], mood: 70, fatigue: 0, hiredDay: s.day });
    expect(o.rota).toEqual([false, false, true, true, true, true, true]);
    expect(r.state.cash).toBe(s.cash - recruitmentFeeOf(s));
    // the per-game fee (manager perk) applies too
    const cheap = apply({ ...s, recruitmentFee: 0 }, { type: "HIRE_STAFF", staff: known() });
    expect(cheap.state.cash).toBe(s.cash);
  });

  it("rejects duplicates, bad records, a full team, no cash, and outside planning", () => {
    const s = fresh(5);
    const once = apply(s, { type: "HIRE_STAFF", staff: known() }).state;
    rejected(once, { type: "HIRE_STAFF", staff: known() });
    rejected(s, { type: "HIRE_STAFF", staff: known({ role: "wizard" as never }) });
    rejected(s, { type: "HIRE_STAFF", staff: known({ wage: 12.5 }) });
    rejected(s, { type: "HIRE_STAFF", staff: known({ name: "" }) });
    rejected({ ...s, cash: 0 }, { type: "HIRE_STAFF", staff: known() });
    rejected({ ...s, staff: Array.from({ length: 12 }, (_, i) => ({ ...known(), id: `x${i}`, name: `X ${i}` })) }, { type: "HIRE_STAFF", staff: known() });
    rejected(inService(ready(5)), { type: "HIRE_STAFF", staff: known() });
  });
});

describe("career hands-on chef (round 3 review)", () => {
  /** A second chef on the rota whose Staff record is the human's (the career player). */
  function careerChef() {
    const s0 = withOrder();
    const ai = s0.staff.find((x) => x.role === "chef")!;
    const me = { ...ai, id: "player", name: "Mia", skill: 22 };
    const c = customer("c1", { stage: "ordered", tableId: "T1", order: Array(6).fill("burger"), spend: 6 * 1450, stageTick: 8 });
    const s = { ...s0, staff: [...s0.staff, me], customers: [c], tickets: [1, 2, 3, 4, 5, 6].map((n) => ticket(`k${n}`, "c1", { createdTick: 10, ticksRemaining: 20 })) };
    return { s: apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player" }).state, ai };
  }

  it("the human's own Staff record is not an AI cook: no ticket is ever assigned to them by the kitchen", () => {
    let { s } = careerChef();
    for (let i = 0; i < 3; i++) s = tickOnce(s);
    expect(s.tickets.some((t) => t.chefId === "player")).toBe(false);
    expect(s.tickets.slice(0, 3).every((t) => !t.chefId)).toBe(true); // reserved for the human
  });

  it("PLAYER_CLAIMED keeps a ticket the human picked up until claimTimeoutTicks, then an AI cook takes it", () => {
    let { s } = careerChef();
    s = apply(s, { type: "PLAYER_CLAIMED", ticketId: "k1" }).state;
    expect(s.tickets[0]).toMatchObject({ chefId: "player", claimedAtTick: s.tick });
    for (let i = 0; i < HANDS_ON.reserveFallbackTicks + 2; i++) s = tickOnce(s);
    expect(s.tickets.find((t) => t.id === "k1")!.chefId).toBe("player"); // still theirs past the reserve fallback
    const r = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 80 });
    expect(r.state.service!.chefs!.player).toEqual({ plates: 1, qualitySum: 80 });
    // a claim the child walks away from goes back to the AI
    s = apply(s, { type: "PLAYER_CLAIMED", ticketId: "k2" }).state;
    for (let i = 0; i < HANDS_ON.claimTimeoutTicks + 1; i++) s = tickOnce(s);
    const k2 = s.tickets.find((t) => t.id === "k2");
    expect(!k2 || (k2.chefId !== "player" && k2.claimedAtTick === undefined)).toBe(true);
  });

  it("PLAYER_CLAIMED is rejected without hands-on, for a gone or cooked ticket; released when hands-on stops", () => {
    const { s } = careerChef();
    rejected({ ...s, handsOn: undefined }, { type: "PLAYER_CLAIMED", ticketId: "k1" });
    rejected(s, { type: "PLAYER_CLAIMED", ticketId: "nope" });
    rejected({ ...s, tickets: s.tickets.map((t) => (t.id === "k1" ? { ...t, ticksRemaining: 0 } : t)) }, { type: "PLAYER_CLAIMED", ticketId: "k1" });
    let t = apply(s, { type: "PLAYER_CLAIMED", ticketId: "k1" }).state;
    t = apply(t, { type: "SET_HANDS_ON", role: null }).state;
    t = tickOnce(t);
    expect(t.tickets.find((x) => x.id === "k1")!.chefId).not.toBe("player");
  });
});

describe("commis station (round 4: SET_HANDS_ON station)", () => {
  /** Six tickets: soup ×3 (the human's station), burger ×3 (the AI's). */
  function stationKitchen(cap = 2, extra: { dishIds?: string[]; coverTicks?: number } = {}) {
    const s0 = withOrder();
    const ai = s0.staff.find((x) => x.role === "chef")!;
    const me = { ...ai, id: "player", name: "Mia", skill: 22 };
    const c = customer("c1", { stage: "ordered", tableId: "T1", order: ["soup", "soup", "soup", "burger", "burger", "burger"], spend: 6 * 1000, stageTick: 8 });
    const dishes = ["soup", "burger", "soup", "burger", "soup", "burger"];
    const s = { ...s0, staff: [...s0.staff, me], customers: [c], tickets: dishes.map((d, n) => ticket(`k${n + 1}`, "c1", { dishId: d, createdTick: 10 + n, ticksRemaining: 20 })) };
    return apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player", station: { dishIds: extra.dishIds ?? ["soup"], cap, ...(extra.coverTicks ? { coverTicks: extra.coverTicks } : {}) } }).state;
  }

  it("AI cooks never take the human's rail (oldest `cap` station tickets) and are not held back on other dishes", () => {
    // Round 5: coverTicks 40 and a party that orders soup only, so neither the age cover nor the course deadline fires.
    let s = stationKitchen(2, { coverTicks: 40 });
    s = { ...s, customers: s.customers.map((c) => ({ ...c, order: c.order.map(() => "soup") })) };
    expect(s.handsOn!.station).toEqual({ dishIds: ["soup"], cap: 2, coverTicks: 40 });
    for (let i = 0; i < 6; i++) s = tickOnce(s);
    const by = (id: string) => s.tickets.find((t) => t.id === id);
    expect(by("k1")?.chefId).toBeUndefined(); // soup, on the rail
    expect(by("k3")?.chefId).toBeUndefined(); // soup, on the rail
    expect(!by("k5") || by("k5")!.chefId !== undefined).toBe(true); // third soup is beyond the rail: the AI's
    expect(s.tickets.filter((t) => t.dishId === "burger").every((t) => t.chefId !== undefined)).toBe(true);
    // the rail holds well past the old 4-tick reserve fallback
    for (let i = 0; i < HANDS_ON.reserveFallbackTicks * 4; i++) s = tickOnce(s);
    expect(by("k1")?.chefId).toBeUndefined();
  });

  it("a claimed ticket counts toward the rail and stays the human's after the claim times out", () => {
    // Round 5: the sim's sous chef covers by ticket age (and soup would be its own course), so this rail holds every
    // food dish and covers only after 40 ticks.
    let s = stationKitchen(2, { dishIds: ["soup", "burger"], coverTicks: 40 });
    s = apply(s, { type: "PLAYER_CLAIMED", ticketId: "k1" }).state;
    for (let i = 0; i < HANDS_ON.claimTimeoutTicks + 2; i++) s = tickOnce(s);
    const k1 = s.tickets.find((t) => t.id === "k1")!;
    expect(k1.chefId === undefined || k1.chefId === "player").toBe(true);
    expect(apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 }).state.service!.chefs!.player).toEqual({ plates: 1, qualitySum: 70 });
  });

  it("the safety net: a rail ticket nobody touches for stationFallbackTicks goes to the AI", () => {
    let s = stationKitchen(1);
    for (let i = 0; i < HANDS_ON.stationFallbackTicks + 2 && s.phase === "service"; i++) s = tickOnce(s);
    const k1 = s.tickets.find((t) => t.id === "k1");
    expect(!k1 || k1.chefId !== undefined).toBe(true);
  });

  it("re-sending SET_HANDS_ON with a new rail keeps `since`; bad stations are rejected", () => {
    let s = stationKitchen(2);
    const since = s.handsOn!.since;
    s = tickOnce(tickOnce(s));
    s = apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player", station: { dishIds: ["soup", "crumble"], cap: 3 } }).state;
    expect(s.handsOn).toMatchObject({ since, station: { dishIds: ["soup", "crumble"], cap: 3 } });
    rejected(s, { type: "SET_HANDS_ON", role: "chef", station: { dishIds: ["soup"], cap: 0 } });
    rejected(s, { type: "SET_HANDS_ON", role: "chef", station: { dishIds: ["soup"], cap: 99 } });
    rejected(s, { type: "SET_HANDS_ON", role: "server", station: { dishIds: ["soup"], cap: 2 } });
    // without a station the old reserve rule is unchanged
    const plain = apply(s, { type: "SET_HANDS_ON", role: "chef", staffId: "player" }).state;
    expect(plain.handsOn!.station).toBeUndefined();
  });
});
