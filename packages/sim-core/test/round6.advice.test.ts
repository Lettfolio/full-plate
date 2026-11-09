/**
 * Round 6: the evening's one tip (advice.ts eveningAdvice) — over-stock, a dud dish, an idle second chef, under-pricing
 * and the round-5 rota tip — its priority and cooldown, the END_DAY advice log, and the learner owners who follow it.
 */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  ADVICE_RULES, adviceSentences, allAdvice, eveningAdvice, fillAdvice, onCooldown, poundsText, recordAdvice, rotaAdvice,
} from "../src/advice";
import { applyCommand, deserialize, newGame, serialize } from "../src/index";
import { followTips, LEARNER_NOTICE_SHOWS, playOne, STRATEGIES, stepper, stockDaysOf } from "../src/strategies";
import { shiftCost } from "../src/systems/finance";
import type { AdviceLog, DayResult, GameState, MenuItem, Staff } from "../src/types";
import { weekdayOf } from "../src/util";

type Day = Partial<DayResult>;
const FIRST = [false, false, true, true, true, true, true];
const COVER_WEEKEND = [true, true, false, false, true, true, true];
const person = (id: string, role: Staff["role"], rota: boolean[], wage = 1300) => ({ id, name: id.toUpperCase(), role, rota, wage }) as Staff;
const item = (dishId: string, price = content.dishes.find((d) => d.id === dishId)!.suggestedPrice): MenuItem => ({ dishId, price, active: true, sold7d: 0, margin7d: 0 });
const MAINS = ["fish_and_chips", "sausage_and_mash", "steak_frites", "beef_burger"];

/** n days of history (day 0…n−1), each built by `f(i)` over a quiet profitable default. */
function history(n: number, f: (i: number) => Day = () => ({})): DayResult[] {
  return Array.from({ length: n }, (_, i) => ({ day: i, covers: 60, walkouts: 0, revenue: 100_000, profit: 5_000, waste: { prep: 0, plate: 0, spoil: 0 }, perDish: {}, perChef: {}, ...f(i) }) as DayResult);
}

type S = Parameters<typeof eveningAdvice>[0];
function state(h: DayResult[], over: Partial<S> = {}): S {
  return { history: h, staff: [person("c1", "chef", FIRST)], menu: MAINS.map((d) => item(d)), reputation: { popularity: 50, prestige: 20 }, day: h.length - 1, ...over };
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** Plates per dish per day, with a revenue and food cost per plate. */
const line = (sold: number, price: number, food: number) => ({ sold, plated: sold, qualityMean: 70, revenue: sold * price, foodCost: sold * food });

// ── over-stock ──
describe("over-stock tip", () => {
  const binCod = (qty: number, cost: number, used = 10) => (): Day => ({ spoiled: { cod: { qty, cost } }, perDish: { fish_and_chips: line(used, 1245, 400) } });

  it("names the ingredient binned far beyond what the week used, with the numbers", () => {
    const a = allAdvice(state(history(7, binCod(4, 400))), content, ["overstock"])[0]!;
    expect(a.kind).toBe("overstock");
    expect(a.subject).toBe("cod");
    expect(a.vars).toMatchObject({ ingredient: "Cod fillet", used: "70", binned: "28", cost: "£28", shelfLife: "2" });
    expect(a.commands).toEqual([]);
    expect(a.tab).toBe("stock");
    const t = adviceSentences(a, content);
    expect(t.title).toBe("You're buying more cod fillet than you can use.");
    expect(t.why).toBe("In the last 7 days your kitchen used 70 portions of cod fillet and threw away 28: £28 in the bin. It keeps for 2 days.");
  });

  it("stays quiet when little was binned, when it was small next to use, or with under a week of history", () => {
    expect(allAdvice(state(history(7, binCod(1, 100))), content, ["overstock"])).toEqual([]); // £7 a week
    expect(allAdvice(state(history(7, binCod(4, 400, 100))), content, ["overstock"])).toEqual([]); // 28 of 700 used
    expect(allAdvice(state(history(6, binCod(4, 400))), content, ["overstock"])).toEqual([]);
  });

  it("picks the costliest ingredient, ties broken by id", () => {
    const h = history(7, () => ({ spoiled: { cod: { qty: 4, cost: 400 }, beef_steak: { qty: 2, cost: 600 }, butter: { qty: 9, cost: 400 } } }));
    expect(allAdvice(state(h), content, ["overstock"])[0]!.subject).toBe("beef_steak");
    const tie = history(7, () => ({ spoiled: { cod: { qty: 4, cost: 400 }, butter: { qty: 9, cost: 400 } } }));
    expect(allAdvice(state(tie), content, ["overstock"])[0]!.subject).toBe("butter");
  });
});

// ── dud dish ──
describe("dud-dish tip", () => {
  // Three good mains (12 a day, £7.40 a plate ex-VAT margin) and the steak selling 1 a day at a thin margin.
  const dud = (i: number): Day => ({
    perDish: {
      fish_and_chips: line(12, 1245, 300), sausage_and_mash: line(12, 1200, 300), beef_burger: line(12, 1245, 300),
      ...(i >= 0 ? { steak_frites: line(1, 1000, 700) } : {}),
    },
  });

  it("names a dish that sold under half its course's average at a lower margin, two weeks running", () => {
    const a = allAdvice(state(history(14, dud)), content, ["dog"])[0]!;
    expect(a).toMatchObject({ kind: "dog", subject: "steak_frites", tab: "menu", commands: [{ type: "REMOVE_MENU_ITEM", dishId: "steak_frites" }] });
    expect(a.vars).toMatchObject({ dish: "Sirloin steak frites", sold: "14", days: "14", course: "main", courseSold: "130" });
    expect(adviceSentences(a, content).title).toBe("Hardly anyone orders the Sirloin steak frites.");
  });

  it("stays quiet for a popular-enough dish, a profitable one, a new one, a short course, or under 14 days", () => {
    const busy = (i: number): Day => ({ perDish: { ...dud(i).perDish, steak_frites: line(7, 1000, 700) } });
    expect(allAdvice(state(history(14, busy)), content, ["dog"])).toEqual([]);
    const rich = (i: number): Day => ({ perDish: { ...dud(i).perDish, steak_frites: line(1, 2345, 400) } });
    expect(allAdvice(state(history(14, rich)), content, ["dog"])).toEqual([]);
    const fresh = (i: number): Day => (i < 7 ? { perDish: { fish_and_chips: line(12, 1245, 300), sausage_and_mash: line(12, 1200, 300), beef_burger: line(12, 1245, 300) } } : dud(i));
    expect(allAdvice(state(history(14, fresh)), content, ["dog"])).toEqual([]);
    expect(allAdvice(state(history(14, dud), { menu: [item("fish_and_chips"), item("steak_frites")] }), content, ["dog"])).toEqual([]);
    expect(allAdvice(state(history(13, dud)), content, ["dog"])).toEqual([]);
  });
});

// ── idle second chef ──
describe("idle-chef tip", () => {
  const team = [person("c1", "chef", FIRST), person("c2", "chef", COVER_WEEKEND, 1400)];
  // c2 is on with c1 on Fri–Sun; solo days c1 (Wed/Thu) or c2 (Mon/Tue).
  const day = (doubledPlates: number) => (i: number): Day => {
    const wd = weekdayOf(i);
    if (wd >= 4) return { perChef: { c1: { plates: doubledPlates - 40, qualityMean: 70 }, c2: { plates: 40, qualityMean: 70 } } };
    return { perChef: { [wd <= 1 ? "c2" : "c1"]: { plates: 150, qualityMean: 70 } } };
  };

  it("names the later hire whose doubled days plated no more than one chef alone, with the saving", () => {
    const a = allAdvice(state(history(14, day(120)), { staff: team }), content, ["idleChef"])[0]!;
    expect(a).toMatchObject({ kind: "idleChef", subject: "c2", tab: "staff" });
    expect(a.vars).toMatchObject({ name: "C2", days: "Friday, Saturday and Sunday", weeklyCost: poundsText(shiftCost(team[1]!) * 3), plates: "120", soloPeak: "150" });
    expect(a.commands).toEqual([{ type: "SET_ROTA", staffId: "c2", rota: [true, true, false, false, false, false, false] }]);
  });

  it("stays quiet when the doubled days were busier than one chef manages, with one chef, or without a solo day to compare", () => {
    expect(allAdvice(state(history(14, day(180)), { staff: team }), content, ["idleChef"])).toEqual([]);
    expect(allAdvice(state(history(14, day(120)), { staff: [team[0]!] }), content, ["idleChef"])).toEqual([]);
    const allDoubled = history(14, () => ({ perChef: { c1: { plates: 60, qualityMean: 70 }, c2: { plates: 40, qualityMean: 70 } } }));
    expect(allAdvice(state(allDoubled, { staff: team }), content, ["idleChef"])).toEqual([]);
  });
});

// ── under-pricing ──
describe("under-pricing tip", () => {
  const packed = (): Day => ({ walkouts: 8, revenue: 150_000, profit: 2_000 });

  it("very popular, turning people away, and keeping almost nothing: raise every price 10% (to 10p)", () => {
    const a = allAdvice(state(history(14, packed), { reputation: { popularity: 80, prestige: 20 } }), content, ["underpriced"])[0]!;
    expect(a).toMatchObject({ kind: "underpriced", subject: "menu", tab: "menu" });
    expect(a.commands).toContainEqual({ type: "SET_MENU_ITEM", dishId: "fish_and_chips", price: 1370 });
    expect(a.commands).toHaveLength(4);
    expect(adviceSentences(a, content).why).toMatch(/about 8 people a night couldn't get a table.*\(80\/100\).*kept only 1p from every pound\.$/);
    const losing = allAdvice(state(history(14, () => ({ ...packed(), profit: -1_000 })), { reputation: { popularity: 80, prestige: 20 } }), content, ["underpriced"])[0]!;
    expect(adviceSentences(losing, content).why).toMatch(/you lost money overall\.$/);
  });

  it("stays quiet when not popular enough, not full, already making money, or already dear", () => {
    const pop = { reputation: { popularity: 80, prestige: 20 } };
    expect(allAdvice(state(history(14, packed), { reputation: { popularity: 60, prestige: 20 } }), content, ["underpriced"])).toEqual([]);
    expect(allAdvice(state(history(14, () => ({ ...packed(), walkouts: 2 })), pop), content, ["underpriced"])).toEqual([]);
    expect(allAdvice(state(history(14, () => ({ ...packed(), profit: 15_000 })), pop), content, ["underpriced"])).toEqual([]);
    expect(allAdvice(state(history(14, packed), { ...pop, menu: MAINS.map((d) => item(d, Math.round(content.dishes.find((x) => x.id === d)!.suggestedPrice * 1.1))) }), content, ["underpriced"])).toEqual([]);
  });
});

// ── the round-5 rota tip, unchanged ──
describe("rota tip inside eveningAdvice", () => {
  const team = [person("c1", "chef", FIRST), person("c2", "chef", COVER_WEEKEND)];
  it("is rotaAdvice exactly, with its words, and its button drops the doubled days", () => {
    const s = state(history(14, () => ({ profit: -3_000 })), { staff: team });
    const r = rotaAdvice(s)!;
    const a = eveningAdvice(s, content)!;
    expect(a.kind).toBe("rota");
    expect(a.subject).toBe(r.staffId);
    expect(a.vars).toMatchObject({ dailyLoss: "£30", days: "Friday, Saturday and Sunday", weeklyCost: poundsText(r.weeklyCost) });
    const t = adviceSentences(a, content);
    expect(t.title).toBe("Two weeks of losing money (about £30 a day).");
    expect(t.body).toBe(`C2 works Friday, Saturday and Sunday, when another chef is already on. Those shifts cost ${poundsText(r.weeklyCost)} a week. Take them off the rota until things pick up?`);
    expect(a.commands).toEqual([{ type: "SET_ROTA", staffId: "c2", rota: [true, true, false, false, false, false, false] }]);
  });

  it("agrees with rotaAdvice on every evening of a real hard run (the round-5 learner's signal)", () => {
    const run = playOne(content, 3, 120, STRATEGIES.typical, "hard").final!;
    for (let end = 14; end <= run.history.length; end += 5) {
      const s = { ...run, history: run.history.slice(0, end) };
      expect(allAdvice(s, content, ["rota"])[0]?.subject).toBe(rotaAdvice(s)?.staffId);
    }
  });
});

// ── one tip, priority, cooldown, determinism ──
describe("eveningAdvice: one tip, in priority order, with a cooldown", () => {
  const team = [person("c1", "chef", FIRST), person("c2", "chef", COVER_WEEKEND)];
  const both = () => state(history(14, () => ({ profit: -3_000, spoiled: { cod: { qty: 4, cost: 400 } } })), { staff: team });

  it("shows only the first kind in priority that holds", () => {
    expect(allAdvice(both(), content).map((a) => a.kind)).toEqual(["rota", "overstock"]);
    expect(eveningAdvice(both(), content)!.kind).toBe("rota");
    expect(eveningAdvice({ ...both(), staff: [team[0]!] }, content)!.kind).toBe("overstock");
  });

  it("rests a tip for cooldownDays after it was shown; the rota tip never rests", () => {
    const s = { ...both(), staff: [team[0]!] };
    const day = s.day!;
    const log = (d: number): AdviceLog => ({ overstock: { day: d, count: 1, subject: "cod" } });
    expect(eveningAdvice({ ...s, adviceLog: log(day - 1) }, content)).toBeUndefined();
    expect(eveningAdvice({ ...s, adviceLog: log(day - ADVICE_RULES.cooldownDays + 1) }, content)).toBeUndefined();
    expect(eveningAdvice({ ...s, adviceLog: log(day - ADVICE_RULES.cooldownDays) }, content)?.kind).toBe("overstock");
    expect(onCooldown({ rota: { day, count: 9, subject: "c2" } }, "rota", day)).toBe(false);
    expect(eveningAdvice({ ...both(), adviceLog: { rota: { day: day - 1, count: 5, subject: "c2" } } }, content)!.kind).toBe("rota");
  });

  it("a cooled-down kind lets the next one through", () => {
    const s = state(history(14, () => ({ spoiled: { cod: { qty: 4, cost: 400 } }, walkouts: 8, revenue: 150_000, profit: 2_000 })), { reputation: { popularity: 80, prestige: 20 } });
    expect(eveningAdvice(s, content)!.kind).toBe("overstock");
    expect(eveningAdvice({ ...s, adviceLog: { overstock: { day: s.day! - 1, count: 1, subject: "cod" } } }, content)!.kind).toBe("underpriced");
  });

  it("is deterministic and pure on deep-frozen input, whatever the key order of the day's maps", () => {
    const s = deepFreeze(both());
    const a = JSON.stringify(allAdvice(s, content));
    expect(JSON.stringify(allAdvice(s, content))).toBe(a);
    const reordered = deepFreeze(state(history(14, () => ({ profit: -3_000, spoiled: { cod: { qty: 4, cost: 400 } } })).reverse().reverse(), { staff: team }));
    expect(JSON.stringify(allAdvice(reordered, content))).toBe(a);
    // every rule on a frozen state that triggers it
    const frozen = deepFreeze(state(history(14, (i) => ({
      walkouts: 8, revenue: 150_000, profit: 2_000, spoiled: { cod: { qty: 4, cost: 400 } },
      perDish: { fish_and_chips: line(12, 1245, 300), sausage_and_mash: line(12, 1200, 300), beef_burger: line(12, 1245, 300), steak_frites: line(1, 1000, 700) },
      perChef: weekdayOf(i) >= 4 ? { c1: { plates: 80, qualityMean: 70 }, c2: { plates: 40, qualityMean: 70 } } : { [weekdayOf(i) <= 1 ? "c2" : "c1"]: { plates: 150, qualityMean: 70 } },
    })), { staff: team, reputation: { popularity: 80, prestige: 20 } }));
    expect(allAdvice(frozen, content).map((a) => a.kind).sort()).toEqual(["dog", "idleChef", "overstock", "underpriced"]);
    expect(eveningAdvice(frozen, content)!.kind).toBe("idleChef");
  });

  it("fillAdvice fills placeholders and keeps a term's label", () => {
    expect(fillAdvice("Order less, so less [[spoilage|goes off]]: {cost}.", { cost: "£3" })).toBe("Order less, so less goes off: £3.");
    expect(fillAdvice("{missing} stays", {})).toBe("{missing} stays");
  });

  it("content rules override the defaults", () => {
    const pack = { ...content, adviceText: { ...content.adviceText, rules: { ...content.adviceText!.rules, overstockMinCost: 10_000 } } };
    expect(allAdvice(state(history(7, () => ({ spoiled: { cod: { qty: 4, cost: 400 } } }))), pack, ["overstock"])).toEqual([]);
  });
});

// ── END_DAY records it; saves stay byte-identical ──
describe("advice log (END_DAY) and saves", () => {
  it("END_DAY records what the Evening showed; a quiet evening leaves the log alone", () => {
    // Round 10: seed 3 (seed 1 shows one tip once staff personalities nudge mood; seed 3 shows 40+ either way).
    const run = playOne(content, 3, 60, STRATEGIES.typical, "hard").final!;
    const log = run.adviceLog!;
    expect(log).toBeDefined();
    const total = Object.values(log).reduce((a, e) => a + e!.count, 0);
    expect(total).toBeGreaterThanOrEqual(3);
    for (const e of Object.values(log)) expect(e!.day).toBeLessThan(run.day);
    const s0 = newGame(content, { type: "NEW_GAME", seed: 1, districtId: content.districts[0]!.id, restaurantName: "X", difficulty: "normal" });
    expect(recordAdvice({ ...s0, phase: "evening" }, content)).toBeUndefined();
  });

  it("records the evening's tip, not one changed by the morning post's choice", () => {
    const team = [person("c1", "chef", FIRST), person("c2", "chef", COVER_WEEKEND)];
    const base = newGame(content, { type: "NEW_GAME", seed: 2, districtId: content.districts[0]!.id, restaurantName: "X", difficulty: "normal" });
    const evening: GameState = { ...base, phase: "evening", day: 13, staff: team, history: history(14, () => ({ profit: -3_000 })) };
    const next = applyCommand(content, evening, { type: "END_DAY" }).state;
    expect(next.adviceLog).toEqual({ rota: { day: 13, count: 1, subject: "c2" } });
    const again = applyCommand(content, { ...next, phase: "evening", history: [...next.history, ...history(1, () => ({ day: 14, profit: -3_000 }))] }, { type: "END_DAY" }).state;
    expect(again.adviceLog!.rota).toEqual({ day: 14, count: 2, subject: "c2" });
  });

  it("serialize round-trips a state with an advice log and per-ingredient spoilage byte-identically", () => {
    const run = playOne(content, 3, 40, STRATEGIES.typical, "hard").final!;
    expect(run.adviceLog).toBeDefined();
    expect(run.history.some((h) => h.spoiled)).toBe(true);
    const json = serialize(run);
    expect(serialize(deserialize(json))).toBe(json);
    expect(deserialize(json)).toEqual(JSON.parse(json));
  });

  it("an older save with no advice log loads and saves byte-identically (no new keys appear)", () => {
    const s = newGame(content, { type: "NEW_GAME", seed: 4, districtId: content.districts[1]!.id, restaurantName: "Old", difficulty: "normal" });
    const json = serialize(s);
    expect(json).not.toMatch(/adviceLog|spoiled/);
    expect(serialize(deserialize(json))).toBe(json);
  });
});

// ── the learners ──
describe("learner owners", () => {
  const step = stepper(content);
  function planning(): GameState {
    let s = newGame(content, { type: "NEW_GAME", seed: 5, districtId: content.districts[0]!.id, restaurantName: "L", difficulty: "normal" });
    for (const d of [...MAINS, "sticky_toffee"]) s = step(s, { type: "ADD_MENU_ITEM", dishId: d, price: content.dishes.find((x) => x.id === d)!.suggestedPrice });
    return { ...s, day: 14 };
  }
  const dudDays = history(14, () => ({ perDish: { fish_and_chips: line(12, 1245, 300), sausage_and_mash: line(12, 1200, 300), beef_burger: line(12, 1245, 300), steak_frites: line(1, 1000, 700) } }));

  it("learner-dog takes the dud off the menu the morning after the tip's second showing, not the first", () => {
    const s = { ...planning(), history: dudDays };
    const once = followTips(content, { ...s, adviceLog: { dog: { day: 13, count: 1, subject: "steak_frites" } } }, STRATEGIES["learner-dog"], step);
    expect(once.menu.some((m) => m.dishId === "steak_frites")).toBe(true);
    const twice = followTips(content, { ...s, adviceLog: { dog: { day: 13, count: LEARNER_NOTICE_SHOWS, subject: "steak_frites" } } }, STRATEGIES["learner-dog"], step);
    expect(twice.menu.some((m) => m.dishId === "steak_frites")).toBe(false);
    // only last night's tip, and only for owners who read that tip
    expect(followTips(content, { ...s, adviceLog: { dog: { day: 10, count: 3, subject: "steak_frites" } } }, STRATEGIES["learner-dog"], step).menu).toEqual(s.menu);
    expect(followTips(content, { ...s, adviceLog: { dog: { day: 13, count: 3, subject: "steak_frites" } } }, STRATEGIES["learner-overstock"], step).menu).toEqual(s.menu);
    const t = { ...s, adviceLog: { dog: { day: 13, count: 3, subject: "steak_frites" } } };
    expect(followTips(content, t, STRATEGIES.typical, step)).toBe(t);
  });

  it("learner-underpriced raises prices; learner-overstock orders like the balanced script once it has seen the tip", () => {
    const s = { ...planning(), reputation: { popularity: 85, prestige: 20 }, history: history(14, () => ({ walkouts: 8, revenue: 150_000, profit: 2_000 })), adviceLog: { underpriced: { day: 13, count: 2, subject: "menu" } } as AdviceLog };
    const after = followTips(content, s, STRATEGIES["learner-underpriced"], step);
    expect(after.menu.find((m) => m.dishId === "fish_and_chips")!.price).toBe(1370);
    expect(stockDaysOf(s, STRATEGIES["learner-overstock"])).toBe(STRATEGIES.typical.stockDays);
    expect(stockDaysOf({ ...s, adviceLog: { overstock: { day: 3, count: 2, subject: "cod" } } }, STRATEGIES["learner-overstock"])).toBe(STRATEGIES.balanced.stockDays);
    expect(stockDaysOf({ ...s, adviceLog: { overstock: { day: 3, count: 2, subject: "cod" } } }, STRATEGIES.typical)).toBe(STRATEGIES.typical.stockDays);
  });

  it("typical and balanced ignore the log: a run with every tip switched off plays out identically", () => {
    const silent = { ...content, adviceText: { ...content.adviceText, rules: { ...content.adviceText!.rules, priority: [] } } };
    for (const name of ["typical", "balanced"] as const) {
      const a = playOne(content, 7, 120, STRATEGIES[name], "hard");
      const b = playOne(silent, 7, 120, STRATEGIES[name], "hard");
      expect(a.final!.adviceLog).toBeDefined();
      expect(b.final!.adviceLog).toBeUndefined();
      expect(b.monthEndCash).toEqual(a.monthEndCash);
      expect(b.daysPlayed).toBe(a.daysPlayed);
    }
  });
});
