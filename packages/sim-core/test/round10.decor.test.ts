/** Round 10: decorating (decor.ts) — commands, cash, the fitting day, wear, bounded effects, saves. */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { applyCommand, deserialize, newGame, runDay, serialize, tick } from "../src/index";
import {
  closedTableIds, decorEffects, decorStyle, decorStyleName, findDecorItem, fitPending, installed, NO_DECOR_EFFECTS, wearOf,
} from "../src/decor";
import { DECOR_CAPS, DECOR_SLOTS } from "../src/constants";
import { nextPopularity, nextPrestige } from "../src/systems/reputation";
import { eatTicks, serviceSystem } from "../src/systems/service";
import { newCustomer } from "../src/systems/arrival";
import { Rng } from "../src/rng";
import { playOne, STRATEGIES } from "../src/strategies";
import type { Command, ContentPack, DecorSlot, GameState } from "../src/types";

const noDecor: ContentPack = { ...content, decor: undefined };

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

function start(seed = 3, pack: ContentPack = content): GameState {
  let s = newGame(pack, { type: "NEW_GAME", seed, districtId: "highstreet", restaurantName: "Paint Pot", difficulty: "normal" });
  const pick = ["main", "main", "main", "starter", "dessert", "drink"];
  const used = new Set<string>();
  for (const course of pick) {
    const d = pack.dishes.find((x) => x.course === course && !used.has(x.id))!;
    used.add(d.id);
    s = applyCommand(pack, s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  }
  s = applyCommand(pack, s, { type: "HIRE", candidateIndex: 0 }).state;
  s = applyCommand(pack, s, { type: "HIRE", candidateIndex: 1 }).state;
  return s;
}

const send = (s: GameState, cmd: Command, pack: ContentPack = content) => applyCommand(pack, deepFreeze(s), cmd);
const buy = (slot: DecorSlot, itemId: string): Command => ({ type: "BUY_DECOR", slot, itemId });
/** Service → evening → next morning (END_DAY or the event's first choice). */
function nextDay(s: GameState, pack: ContentPack = content): GameState {
  let r = runDay(pack, s).state;
  if (r.phase === "event") r = applyCommand(pack, r, { type: "RESOLVE_EVENT", choiceId: pack.events.find((e) => e.id === r.activeEvent?.eventId)!.choices[0]!.id }).state;
  else if (r.phase === "evening") r = applyCommand(pack, r, { type: "END_DAY" }).state;
  return r;
}

describe("the starter kit (no decor in state)", () => {
  it("every slot holds its starter item and the room has no effects", () => {
    const s = start();
    expect(s.decor).toBeUndefined();
    for (const slot of DECOR_SLOTS) {
      const it = installed(content, s, slot);
      expect(it?.item.starter, slot).toBe(true);
      expect(it?.bought).toBe(false);
    }
    expect(decorEffects(content, s)).toBe(NO_DECOR_EFFECTS);
    expect(decorStyleName(content, s)).toBe(content.decor!.plainName);
  });

  it("a game that never decorates is byte-identical with or without the catalogue", () => {
    let a = start(5, content);
    let b = start(5, noDecor);
    for (let d = 0; d < 6; d++) { a = nextDay(a, content); b = nextDay(b, noDecor); }
    expect(serialize(a)).toBe(serialize(b));
    expect(serialize(a)).not.toContain('"decor"');
  });

  it("an old save (no decor key) loads and plays", () => {
    const old = serialize(start());
    const s = deserialize(old);
    expect(s.decor).toBeUndefined();
    expect(nextDay(s).day).toBe(1);
  });
});

describe("BUY_DECOR", () => {
  it("pays now, fits tomorrow morning, and closes tables that night", () => {
    let s = start();
    const lamp = findDecorItem(content, "light_brass")!;
    const r = send(s, buy("lighting", lamp.id));
    expect(r.state.cash).toBe(s.cash - lamp.price);
    expect(r.state.decor?.pending).toEqual([{ slot: "lighting", itemId: lamp.id, paid: lamp.price, tables: lamp.fitTables }]);
    expect(installed(content, r.state, "lighting")?.item.starter).toBe(true); // still the bulbs today
    s = nextDay(r.state);
    expect(s.decor?.slots.lighting).toEqual({ itemId: lamp.id, since: s.day });
    expect(s.decor?.pending).toBeUndefined();
    expect(s.decor?.fitting).toEqual({ day: s.day, tables: lamp.fitTables, slots: ["lighting"] });
    const closed = closedTableIds(s);
    expect(closed).toHaveLength(lamp.fitTables);
    // nobody sits at the fitters' tables during service
    let cur = applyCommand(content, s, { type: "START_SERVICE" }).state;
    let seatedAnywhere = 0;
    while (cur.phase === "service") {
      for (const c of cur.customers) if (c.tableId) { seatedAnywhere++; expect(closed).not.toContain(c.tableId); }
      cur = tick(content, cur).state;
    }
    expect(seatedAnywhere).toBeGreaterThan(0);
    const night = cur.history.at(-1)!;
    expect(night.decor).toEqual({ fitted: [{ slot: "lighting", itemId: lamp.id }], tablesClosed: lamp.fitTables, tired: [] });
    // the next morning the fitters have gone
    cur = cur.phase === "event" ? applyCommand(content, cur, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === cur.activeEvent?.eventId)!.choices[0]!.id }).state : applyCommand(content, cur, { type: "END_DAY" }).state;
    expect(cur.decor?.fitting).toBeUndefined();
    expect(closedTableIds(cur)).toEqual([]);
  });

  it("is allowed in the evening too, and rejected during service", () => {
    let s = start();
    s = applyCommand(content, s, { type: "START_SERVICE" }).state;
    const during = send(s, buy("signage", "sign_chalk"));
    expect(during.state.cash).toBe(s.cash);
    expect(during.events[0]).toMatchObject({ type: "LOG", entry: { kind: "bad" } });
    const evening = runDay(content, s).state;
    if (evening.phase === "evening") expect(send(evening, buy("signage", "sign_chalk")).state.decor?.pending?.[0]?.itemId).toBe("sign_chalk");
  });

  it("rejects what doesn't fit, what you have, and what you can't afford", () => {
    const s = start();
    for (const cmd of [buy("floor", "light_brass"), buy("floor", "nope"), buy("roof" as DecorSlot, "floor_rugs"), buy("floor", "floor_oak")]) {
      const r = send(s, cmd);
      expect(r.state).toEqual({ ...s, log: r.state.log });
      expect(r.events[0]).toMatchObject({ type: "LOG", entry: { kind: "bad" } });
    }
    const poor = { ...s, cash: 100 };
    expect(send(poor, buy("lighting", "light_chandelier")).state.cash).toBe(100);
    expect(send(s, buy("lighting", "light_brass"), noDecor).state.decor).toBeUndefined();
  });

  it("changing your mind before the fitters come refunds the first choice", () => {
    let s = start();
    const cash = s.cash;
    s = send(s, buy("seating", "seat_velvet")).state;
    s = send(s, buy("seating", "seat_cushions")).state;
    expect(s.cash).toBe(cash - findDecorItem(content, "seat_cushions")!.price);
    expect(s.decor?.pending?.map((p) => p.itemId)).toEqual(["seat_cushions"]);
    // picking what's already there cancels the fitting
    s = send(s, buy("seating", "seat_wood")).state;
    expect(s.cash).toBe(cash);
    expect(s.decor?.pending).toBeUndefined();
    expect(send(s, buy("seating", "seat_cushions")).state.decor?.pending).toHaveLength(1);
  });
});

describe("wear and REFRESH_DECOR", () => {
  const withItem = (itemId: string, since: number, day: number): GameState => {
    const item = findDecorItem(content, itemId)!;
    const s = start();
    return { ...s, day, decor: { slots: { [item.slot]: { itemId, since } } } };
  };

  it("fresh → worn (75%) → tired (100%), and starter items never tire", () => {
    const rugs = findDecorItem(content, "floor_rugs")!;
    expect(wearOf(rugs, 10, 10)).toBe("fresh");
    expect(wearOf(rugs, 10, 10 + Math.ceil(rugs.lifeDays * 0.75) - 1)).toBe("fresh");
    expect(wearOf(rugs, 10, 10 + Math.ceil(rugs.lifeDays * 0.75))).toBe("worn");
    expect(wearOf(rugs, 10, 10 + rugs.lifeDays)).toBe("tired");
    expect(wearOf(findDecorItem(content, "floor_oak")!, 0, 5000)).toBe("fresh");
  });

  it("a tired item gives half its good effects and drags prestige", () => {
    const fresh = decorEffects(content, withItem("walls_damask", 0, 10));
    const tired = decorEffects(content, withItem("walls_damask", 0, 400));
    expect(fresh.prestige).toBe(2);
    expect(tired.prestige).toBe(1 - 1);
    const gingham = withItem("table_gingham", 0, 200);
    expect(decorEffects(content, gingham).popularity).toBe(0);
    expect(decorEffects(content, gingham).prestige).toBe(-1);
    expect(decorEffects(content, gingham).upkeep).toBe(findDecorItem(content, "table_gingham")!.effects.upkeep);
  });

  it("refreshing a worn item costs its refresh price and makes it new; a fresh one can't be refreshed", () => {
    const item = findDecorItem(content, "plant_baskets")!;
    const s = withItem(item.id, 0, item.lifeDays);
    const r = send(s, { type: "REFRESH_DECOR", slot: "plants" });
    expect(r.state.cash).toBe(s.cash - item.refreshCost);
    expect(r.state.decor?.slots.plants).toEqual({ itemId: item.id, since: s.day });
    expect(wearOf(item, r.state.decor!.slots.plants!.since, r.state.day)).toBe("fresh");
    expect(send(r.state, { type: "REFRESH_DECOR", slot: "plants" }).state.cash).toBe(r.state.cash);
    expect(send(start(), { type: "REFRESH_DECOR", slot: "plants" }).events[0]).toMatchObject({ entry: { kind: "bad" } });
    expect(send({ ...s, cash: 0 }, { type: "REFRESH_DECOR", slot: "plants" }).state.cash).toBe(0);
  });

  it("the evening says when something turns tired", () => {
    const item = findDecorItem(content, "sign_chalk")!;
    let s = withItem(item.id, 0, item.lifeDays - 1);
    s = { ...s, day: item.lifeDays }; // tonight it crosses into tired
    const night = runDay(content, s).state.history.at(-1)!;
    expect(night.decor?.tired).toEqual(["signage"]);
  });
});

describe("effects", () => {
  const kit = (ids: string[]): GameState => {
    const s = start();
    const slots: NonNullable<GameState["decor"]>["slots"] = {};
    for (const id of ids) slots[findDecorItem(content, id)!.slot] = { itemId: id, since: 0 };
    return { ...s, day: 1, decor: { slots } };
  };
  const priciest = () => DECOR_SLOTS.map((slot) => content.decor!.items.filter((i) => i.slot === slot).sort((a, b) => b.price - a.price)[0]!.id);

  it("a full lavish kit is worth a few prestige points, within the caps, for real money", () => {
    const ids = priciest();
    const e = decorEffects(content, kit(ids));
    expect(e.prestige).toBeGreaterThanOrEqual(3);
    expect(e.prestige).toBeLessThanOrEqual(DECOR_CAPS.prestige);
    const cost = ids.reduce((a, id) => a + findDecorItem(content, id)!.price, 0);
    expect(cost).toBeGreaterThan(1_500_000); // > £15,000
    expect(e.style).toBe("posh");
  });

  it("no combination exceeds the caps (best item per effect in every slot)", () => {
    for (const key of ["prestige", "popularity", "comfort", "stay", "spend"] as const) {
      const ids = DECOR_SLOTS.map((slot) => content.decor!.items.filter((i) => i.slot === slot).sort((a, b) => (b.effects[key] ?? 0) - (a.effects[key] ?? 0))[0]!.id);
      const e = decorEffects(content, kit(ids));
      expect(e[key]).toBeLessThanOrEqual(DECOR_CAPS[key]);
    }
  });

  it("style: three bought items sharing a tag make the room's style; a tie is a mix", () => {
    const cosy = kit(["seat_cushions", "music_radio", "sign_chalk"]);
    expect(decorStyle(content, cosy)).toBe("cosy");
    expect(decorStyleName(content, cosy)).toBe("Cosy café");
    expect(decorEffects(content, cosy).segments.families).toBeGreaterThan(0);
    const mixed = kit(["seat_cushions", "music_jukebox"]);
    expect(decorStyle(content, mixed)).toBeNull();
    expect(decorStyleName(content, mixed)).toBe(content.decor!.mixedName);
  });

  it("prestige and popularity settle `lift` points higher", () => {
    const rep = { popularity: 52, prestige: 51 };
    expect(nextPrestige(content, rep, [], 0)).toBeLessThan(51);
    expect(nextPrestige(content, rep, [], 4)).toBeGreaterThan(51);
    expect(nextPrestige(content, { ...rep, prestige: 54 }, [], 4)).toBe(54);
    expect(nextPopularity(content, rep, 3, 0, 3)).toBeGreaterThan(nextPopularity(content, rep, 3, 0, 0));
  });

  it("upkeep is paid with the bills, comfort lifts satisfaction, and stays run longer", () => {
    const base = start(9);
    const plain = runDay(content, base).state.history.at(-1)!;
    const decked = runDay(content, { ...base, decor: { slots: { tables: { itemId: "table_linen", since: 0 }, seating: { itemId: "seat_velvet", since: 0 } } } }).state;
    const night = decked.history.at(-1)!;
    expect((night.overheads ?? 0) - (plain.overheads ?? 0)).toBeGreaterThanOrEqual(findDecorItem(content, "table_linen")!.effects.upkeep! - 50);
    expect(decorEffects(content, decked).comfort).toBe(3);
    expect(decorEffects(content, decked).stay).toBe(2);
  });
});

describe("stay: guests linger only while nobody is queueing", () => {
  it("adds the room's stay ticks to eating time on a quiet floor, none with a queue at the door", () => {
    const base = start();
    const seg = content.segments[0]!;
    const served = { ...newCustomer("c0-1", seg, 2, 0), stage: "ordered" as const, servedTick: 10, tableId: base.tables[0]!.id, order: ["x"] };
    const decor = { slots: { lighting: { itemId: "light_lanterns", since: 0 }, seating: { itemId: "seat_cushions", since: 0 } } };
    const s = { ...base, phase: "service" as const, tick: 12, decor, customers: [served] };
    const quiet = serviceSystem(content, s, new Rng([1, 2, 3, 4])).state.customers[0]!;
    expect(quiet.eatUntil).toBe(12 + eatTicks(2) + 2);
    const queued = { ...s, customers: [served, newCustomer("c0-2", seg, 2, 11)] };
    expect(serviceSystem(content, queued, new Rng([1, 2, 3, 4])).state.customers[0]!.eatUntil).toBe(12 + eatTicks(2));
  });

  it("round 10 review: none once half the tables are taken (the rush is coming)", () => {
    const base = start();
    const seg = content.segments[0]!;
    const served = { ...newCustomer("c0-1", seg, 2, 0), stage: "ordered" as const, servedTick: 10, tableId: base.tables[0]!.id, order: ["x"] };
    const decor = { slots: { lighting: { itemId: "light_lanterns", since: 0 }, seating: { itemId: "seat_cushions", since: 0 } } };
    const half = Math.ceil(base.tables.length / 2) + 1;
    const tables = base.tables.map((t, i) => (i < half ? { ...t, occupiedBy: `x${i}` } : t));
    const s = { ...base, phase: "service" as const, tick: 12, decor, tables, customers: [served] };
    expect(serviceSystem(content, s, new Rng([1, 2, 3, 4])).state.customers[0]!.eatUntil).toBe(12 + eatTicks(2));
  });
});

describe("saves, determinism and purity", () => {
  it("round-trips a decorated game", () => {
    let s = start();
    s = send(s, buy("walls", "walls_sunny")).state;
    s = nextDay(s);
    s = send(s, buy("signage", "sign_neon")).state;
    expect(deserialize(serialize(s))).toEqual(s);
    expect(serialize(deserialize(serialize(s)))).toBe(serialize(s));
  });

  it("same seed and decor commands ⇒ the same game", () => {
    const play = () => {
      let s = start(21);
      s = send(s, buy("lighting", "light_lanterns")).state;
      for (let d = 0; d < 3; d++) s = nextDay(s);
      s = send(s, buy("music", "music_jukebox")).state;
      for (let d = 0; d < 3; d++) s = nextDay(s);
      return serialize(s);
    };
    expect(play()).toBe(play());
  });

  it("fitPending keeps nothing stale", () => {
    expect(fitPending(undefined, 3)).toBeUndefined();
    const d = { slots: {}, fitting: { day: 2, tables: 1, slots: ["floor" as const] } };
    expect(fitPending(d, 3)).toEqual({ slots: {} });
  });

  it("the decorator owner buys a kit in year 1 and keeps it fresh", () => {
    const r = playOne(content, 4, 200, STRATEGIES.decorator, "normal");
    const slots = Object.keys(r.final?.decor?.slots ?? {});
    expect(slots.length).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
