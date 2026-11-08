import { describe, expect, it } from "vitest";
import { applyResults } from "../src/fixture";
import { nextHint } from "../src/hints";
import { buildLayout, isBlocked, WORLD_H, WORLD_W } from "../src/layout";
import { summarise } from "../src/score";
import { createSession, openFoodTickets, readyGroups, updateSession } from "../src/session";
import type { HandsOnResult, HandsOnSession } from "../src/types";
import { DT, input, press, run, setup, standAt, station, waitAction } from "./helpers";
import type { GameState } from "@full-plate/sim-core";

/** Chops: presses when the cursor reaches each mark (perfect=true) or never presses (all misses). */
function chop(s: HandsOnSession, state: GameState, perfect: boolean) {
  const results: HandsOnResult[] = [];
  let held = false;
  for (let i = 0; i < 400 && s.activeAction?.verb === "chop"; i++) {
    const a = s.activeAction;
    const cursor = (a.t + DT) / a.dur;
    const next = a.marked?.findIndex((m) => m === 0) ?? -1;
    const want: boolean = perfect && next >= 0 && !held && cursor >= a.marks![next]!;
    const r = updateSession(s, state, input({ interact: want }), DT);
    held = want;
    s = r.session; results.push(...r.results);
  }
  return { s, results };
}

/** Holds interact on a cook/pour until the needle reaches `target` (0..1), then releases. */
function holdUntil(s: HandsOnSession, state: GameState, target: number) {
  const results: HandsOnResult[] = [];
  let r = updateSession(s, state, input({ interact: true }), DT); // the press that starts it
  s = r.session; results.push(...r.results);
  for (let i = 0; i < 400 && s.activeAction && s.activeAction.t / s.activeAction.dur < target; i++) {
    r = updateSession(s, state, input({ interact: true }), DT);
    s = r.session; results.push(...r.results);
  }
  r = updateSession(s, state, input(), DT);
  s = r.session; results.push(...r.results);
  return { s, results };
}

describe("layout", () => {
  it("places every station from the state, including all 8 fixture tables", () => {
    const { s } = setup("server");
    const kinds = new Set(s.stations.map((x) => x.kind));
    for (const k of ["fridge", "prep", "stove", "oven", "fryer", "pass", "table", "bar", "till", "dishReturn"]) expect(kinds.has(k as never)).toBe(true);
    expect(s.stations.filter((x) => x.kind === "table")).toHaveLength(8);
    expect(s.tableNumbers.t1).toBe(1);
  });
  it("every station can be reached on foot from the spawn (kitchen and floor connected)", () => {
    for (const n of [4, 8, 12]) {
      const tables = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, seats: i % 3 === 0 ? 4 : 2, dirtyTicks: 0 }));
      const L = buildLayout(tables);
      const seen = new Set<string>();
      const q: [number, number][] = [[7, 3]];
      while (q.length) {
        const [x, y] = q.pop()!;
        const k = `${x},${y}`;
        if (seen.has(k) || isBlocked(L.grid, x, y)) continue;
        seen.add(k);
        q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      for (const st of L.stations) {
        const adj: [number, number][] = [];
        for (let x = st.x; x < st.x + st.w; x++) adj.push([x, st.y - 1], [x, st.y + st.h]);
        for (let y = st.y; y < st.y + st.h; y++) adj.push([st.x - 1, y], [st.x + st.w, y]);
        expect(adj.some(([x, y]) => seen.has(`${x},${y}`)), `${st.id} reachable with ${n} tables`).toBe(true);
      }
      expect(L.grid).toHaveLength(WORLD_H);
      expect(L.grid[0]).toHaveLength(WORLD_W);
    }
  });
});

describe("movement", () => {
  it("walks smoothly (accelerates, doesn't teleport) and stops at walls", () => {
    const { f, s } = setup("chef");
    const a = run(s, f.state, input({ right: true }), 3);
    expect(a.s.player.x).toBeGreaterThan(s.player.x);
    expect(a.s.player.x - s.player.x).toBeLessThan(0.2);
    const b = run(a.s, f.state, input({ up: true }), 200);
    expect(b.s.player.y).toBeGreaterThan(1); // the prep/stove counter row blocks
    expect(b.s.player.y).toBeLessThan(2.8);
  });
  it("chef cannot walk through the pass but can use the swing door to the floor", () => {
    const { f, s } = setup("chef");
    const blocked = run(standAt(s, station(s, "prep")), f.state, input({ down: true }), 200);
    expect(blocked.s.player.y).toBeLessThan(5);
    const atDoor = { ...structuredClone(s), player: { ...s.player, x: 16, y: 3.5 } };
    const through = run(atDoor, f.state, input({ down: true }), 200);
    expect(through.s.player.y).toBeGreaterThan(6);
  });
});

describe("chef verbs", () => {
  it("grab → chop → cook → plate emits PLATE_COOKED for the oldest ticket with the right quality", () => {
    let { f, s } = setup("chef");
    const ticket = openFoodTickets(s, f.state)[0]!;
    s = standAt(s, station(s, "fridge"));
    let r = run(s, f.state, input(), 1); s = r.s;
    expect(s.prompt?.verb).toBe("grab");
    ({ s } = press(s, f.state));
    ({ s } = waitAction(s, f.state));
    expect(s.carrying).toMatchObject({ kind: "raw", ticketId: ticket.id });
    expect(openFoodTickets(s, f.state).map((t) => t.id)).not.toContain(ticket.id); // claimed, not offered twice

    s = standAt(s, station(s, "prep"));
    ({ s } = press(s, f.state));
    expect(s.activeAction?.verb).toBe("chop");
    ({ s } = chop(s, f.state, true));
    expect(s.carrying?.kind).toBe("prepped");
    const prep = s.carrying?.kind === "prepped" ? s.carrying.prep : 0;
    expect(prep).toBeGreaterThan(0.9);

    const method = s.dishes[ticket.dishId]!.method;
    if (method !== "none") {
      s = standAt(s, station(s, method));
      r = run(s, f.state, input(), 1); s = r.s;
      expect(s.prompt?.verb).toBe("cook");
      // aim for the band centre
      const centre = 0.68;
      ({ s } = holdUntil(s, f.state, centre));
      expect(s.carrying?.kind).toBe("cooked");
    }
    s = standAt(s, station(s, "pass"));
    ({ s } = press(s, f.state));
    const done = waitAction(s, f.state);
    const cooked = done.results.find((x) => x.type === "PLATE_COOKED");
    expect(cooked).toMatchObject({ type: "PLATE_COOKED", ticketId: ticket.id });
    if (cooked?.type === "PLATE_COOKED") {
      expect(cooked.execution).toBeGreaterThan(0.6);
      expect(cooked.quality).toBeCloseTo(cooked.execution * s.dishes[ticket.dishId]!.ceiling, 0);
      expect(cooked.speedBonus).toBe(1);
    }
    expect(done.s.carrying).toBeUndefined();
    expect(done.s.score.plates).toBe(1);
    // the session now treats it as on the pass until the state catches up
    f = applyResults(f, done.results);
    expect(f.state.tickets.find((t) => t.id === ticket.id)?.ticksRemaining).toBe(0);
  });

  it("missing every chop still preps (soft fail), with a lower score", () => {
    let { f, s } = setup("chef");
    s = standAt(s, station(s, "fridge"));
    ({ s } = press(s, f.state)); ({ s } = waitAction(s, f.state));
    s = standAt(s, station(s, "prep"));
    ({ s } = press(s, f.state));
    ({ s } = chop(s, f.state, false));
    expect(s.carrying?.kind).toBe("prepped");
    if (s.carrying?.kind === "prepped") expect(s.carrying.prep).toBeCloseTo(0.4);
    expect(s.score.chopHits).toBe(0);
  });

  it("overcooking lowers quality versus a perfect cook", () => {
    const qualityAt = (target: number) => {
      let { f, s } = setup("chef");
      // find a hob dish
      const t = openFoodTickets(s, f.state).find((x) => s.dishes[x.dishId]!.method !== "none")!;
      s = { ...s, carrying: { kind: "prepped", ticketId: t.id, dishId: t.dishId, prep: 1 }, claimed: { [t.id]: true } };
      s = standAt(s, station(s, s.dishes[t.dishId]!.method));
      s = run(s, f.state, input(), 1).s;
      const band = s.prompt?.verb === "cook";
      expect(band).toBe(true);
      ({ s } = holdUntil(s, f.state, target));
      return s.carrying?.kind === "cooked" ? s.carrying.cook : -1;
    };
    const centre = qualityAt(0.68);
    const over = qualityAt(0.97);
    expect(over).toBeLessThan(centre);
    expect(over).toBeGreaterThan(0);
  });

  it("wrong station is refused with a reason, nothing happens", () => {
    let { f, s } = setup("chef");
    s = standAt(s, station(s, "stove"));
    s = run(s, f.state, input(), 1).s;
    expect(s.prompt?.enabled).toBe(false);
    const r = press(s, f.state);
    expect(r.s.activeAction).toBeUndefined();
    expect(r.s.message?.text).toMatch(/cook|Nothing/i);
  });

  it("binning a carried dish (Q twice) costs a little and frees the ticket", () => {
    let { f, s } = setup("chef");
    s = standAt(s, station(s, "fridge"));
    ({ s } = press(s, f.state)); ({ s } = waitAction(s, f.state));
    const id = s.carrying?.kind === "raw" ? s.carrying.ticketId : "";
    let r = updateSession(s, f.state, input({ cancel: true }), DT); s = r.session;
    expect(s.carrying).toBeDefined();
    r = updateSession(s, f.state, input(), DT); s = r.session;
    r = updateSession(s, f.state, input({ cancel: true }), DT); s = r.session;
    const drop = r.results.find((x) => x.type === "DROPPED");
    expect(drop).toBeDefined();
    if (drop?.type === "DROPPED") { expect(drop.cost).toBeGreaterThan(0); expect(drop.cost).toBeLessThan(1000); }
    expect(s.carrying).toBeUndefined();
    expect(openFoodTickets(s, f.state).map((t) => t.id)).toContain(id);
    expect(s.score.drops).toBe(1);
  });
});

describe("server verbs", () => {
  it("serve matching: plates only go to the table that ordered them", () => {
    let { f, s } = setup("server");
    const g = readyGroups(s, f.state, "pass")[0]!;
    expect(g).toBeDefined();
    const target = f.state.customers.find((c) => c.id === g.customerId)!;
    s = standAt(s, station(s, "pass"));
    ({ s } = press(s, f.state)); ({ s } = waitAction(s, f.state));
    expect(s.carrying?.kind).toBe("plates");

    // wrong table: refused, names the right one
    const wrong = s.stations.find((x) => x.kind === "table" && x.tableId !== target.tableId && f.state.tables.find((t) => t.id === x.tableId)?.occupiedBy)!;
    s = standAt(s, wrong);
    s = run(s, f.state, input(), 1).s;
    expect(s.prompt?.enabled).toBe(false);
    expect(s.prompt?.label).toMatch(new RegExp(`table ${s.tableNumbers[target.tableId!]}`));
    let r = press(s, f.state); s = r.s;
    expect(r.results.some((x) => x.type === "TABLE_SERVED")).toBe(false);

    // right table
    s = standAt(s, station(s, `table:${target.tableId}`));
    s = run(s, f.state, input(), 1).s;
    expect(s.prompt?.verb).toBe("serve");
    ({ s } = press(s, f.state));
    r = waitAction(s, f.state); s = r.s;
    const served = r.results.filter((x) => x.type === "TABLE_SERVED");
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ customerId: target.id, ticketId: g.tickets[0]!.id });
    expect(s.carrying).toBeUndefined();
    const before = target.platesReady ?? 0;
    f = applyResults(f, r.results);
    expect(f.state.customers.find((c) => c.id === target.id)!.platesReady).toBe(before + 1);
    expect(f.state.tickets.find((t) => t.id === g.tickets[0]!.id)).toBeUndefined();
  });

  it("clear a dirty table (three taps) → TABLE_CLEARED, then drop plates at the wash-up", () => {
    let { f, s } = setup("server");
    const dirty = f.state.tables.find((t) => t.dirtyTicks > 0 && !t.occupiedBy)!;
    s = standAt(s, station(s, `table:${dirty.id}`));
    ({ s } = press(s, f.state));
    expect(s.activeAction?.verb).toBe("clear");
    const results: HandsOnResult[] = [];
    for (let i = 0; i < 3; i++) { const r = press(s, f.state); s = r.s; results.push(...r.results); }
    expect(results).toContainEqual({ type: "TABLE_CLEARED", tableId: dirty.id });
    expect(s.carrying?.kind).toBe("dirty");
    s = standAt(s, station(s, "dishReturn"));
    ({ s } = press(s, f.state)); ({ s } = waitAction(s, f.state));
    expect(s.carrying).toBeUndefined();
    f = applyResults(f, results);
    expect(f.state.tables.find((t) => t.id === dirty.id)!.dirtyTicks).toBe(0);
  });

  it("take payment at the till from the paying party", () => {
    let { f, s } = setup("server");
    const payer = f.state.customers.find((c) => c.stage === "paying")!;
    s = standAt(s, station(s, "till"));
    ({ s } = press(s, f.state));
    const r = waitAction(s, f.state);
    expect(r.results).toContainEqual({ type: "PAYMENT_TAKEN", customerId: payer.id });
    const cash = f.state.cash;
    f = applyResults(f, r.results);
    expect(f.state.cash).toBeGreaterThan(cash);
    expect(f.state.customers.find((c) => c.id === payer.id)?.stage ?? "left").toBe("left");
  });

  it("one full-speed bump with three plates drops them (costs, re-fires); one plate just wobbles", () => {
    let { f, s } = setup("server");
    // make three plates for T1/T2 ready on the pass and pick them up
    for (const t of f.state.tickets.filter((x) => x.dishId !== "lager" && x.dishId !== "lemonade").slice(0, 3)) t.ticksRemaining = 0;
    const tray = f.state.tickets.filter((t) => t.ticksRemaining <= 0).slice(0, 3);
    s = { ...s, carrying: { kind: "plates", plates: tray.map((t) => ({ ticketId: t.id, dishId: t.dishId, customerId: t.customerId, readyAt: 0 })) }, picked: Object.fromEntries(tray.map((t) => [t.id, true])) };
    s = { ...s, player: { ...s.player, x: 20.5, y: 6.5 } };
    const r = run(s, f.state, input({ right: true }), 140);
    const drop = r.results.find((x) => x.type === "DROPPED");
    expect(drop).toBeDefined();
    if (drop?.type === "DROPPED") {
      expect(drop.ticketIds).toHaveLength(3);
      expect(drop.cost).toBeGreaterThan(0);
      expect(drop.cost).toBeLessThan(3000);
    }
    expect(r.s.carrying).toBeUndefined();
    f = applyResults(f, r.results);
    expect(f.state.tickets.find((t) => t.id === tray[0]!.id)!.ticksRemaining).toBeGreaterThan(0);

    // one plate: the same bump only wobbles
    const one = { ...s, carrying: { kind: "plates" as const, plates: [{ ticketId: tray[0]!.id, dishId: tray[0]!.dishId, customerId: tray[0]!.customerId, readyAt: 0 }] } };
    const r1 = run(one, f.state, input({ right: true }), 140);
    expect(r1.results.some((x) => x.type === "DROPPED")).toBe(false);
    expect(r1.s.carrying?.kind).toBe("plates");
  });

  it("chef can't serve tables; server can't use the hob", () => {
    const chef = setup("chef");
    let s = standAt(chef.s, station(chef.s, "table:t1"));
    s = run(s, chef.f.state, input(), 1).s;
    expect(s.prompt?.enabled).toBe(false);
    const srv = setup("server");
    s = standAt(srv.s, station(srv.s, "stove"));
    s = run(s, srv.f.state, input(), 1).s;
    expect(s.prompt?.enabled).toBe(false);
  });
});

describe("bar verbs", () => {
  it("pour to the line → PLATE_COOKED for the drink ticket; overflow is a small spill", () => {
    let { f, s } = setup("bar");
    s = standAt(s, station(s, "bar"));
    s = run(s, f.state, input(), 1).s;
    expect(s.prompt?.verb).toBe("pour");
    const pourTo = (sess: HandsOnSession, target: number) => holdUntil(sess, f.state, target);
    const line = 0.78; // approx; quality checked relative
    const good = pourTo(s, line);
    const cooked = good.results.find((x) => x.type === "PLATE_COOKED");
    expect(cooked?.type).toBe("PLATE_COOKED");
    if (cooked?.type === "PLATE_COOKED") { expect(cooked.station).toBe("pour"); expect(cooked.execution).toBeGreaterThan(0.6); }
    // overflow: hold to the end
    let s2 = good.s;
    s2 = run(s2, f.state, input(), 1).s;
    if (s2.prompt?.verb === "pour") {
      const spill = pourTo(s2, 1.01);
      expect(spill.results.some((x) => x.type === "DROPPED")).toBe(true);
    }
  });
});

describe("tutorial hints", () => {
  it("point the chef at the fridge, then the board, then the right cooker, then the pass", () => {
    let { f, s } = setup("chef");
    expect(nextHint(s, f.state)?.stationId).toBe("fridge");
    s = standAt(s, station(s, "fridge"));
    ({ s } = press(s, f.state)); ({ s } = waitAction(s, f.state));
    expect(nextHint(s, f.state)?.stationId).toBe("prep");
    s = { ...s, carrying: { kind: "prepped", ticketId: "x", dishId: "fish_and_chips", prep: 1 } };
    expect(nextHint(s, f.state)?.stationId).toBe("fryer");
    s = { ...s, carrying: { kind: "cooked", ticketId: "x", dishId: "fish_and_chips", prep: 1, cook: 1 } };
    expect(nextHint(s, f.state)?.stationId).toBe("pass");
  });
  it("server: food on the pass first, then the table it's for", () => {
    let { f, s } = setup("server");
    expect(nextHint(s, f.state)?.stationId).toBe("pass");
    s = standAt(s, station(s, "pass"));
    ({ s } = press(s, f.state)); ({ s } = waitAction(s, f.state));
    const h = nextHint(s, f.state);
    expect(h?.stationId).toMatch(/^table:/);
    expect(h?.text).toMatch(/table \d/);
  });
});

describe("shift mode and score", () => {
  it("ends at the timer, freezes input, and gives a summary with a tip", () => {
    const { f, s } = setup("chef", 2);
    const r = run(s, f.state, input({ right: true }), 150);
    expect(r.s.shift?.over).toBe(true);
    const x = r.s.player.x;
    const after = run(r.s, f.state, input({ right: true }), 30);
    expect(after.s.player.x).toBe(x);
    const sum = summarise(after.s);
    expect(sum.tip.length).toBeGreaterThan(10);
    expect(sum.lines.length).toBeGreaterThan(2);
  });
  it("createSession is serialisable", () => {
    const { s } = setup("server");
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it("creates a session for a state with no tables or tickets", () => {
    const { f } = setup("server");
    const empty = { ...f.state, tables: [], tickets: [], customers: [] };
    const s = createSession(empty, "server");
    const r = run(s, empty, input({ interact: true }), 10);
    expect(r.results).toEqual([]);
  });
});
