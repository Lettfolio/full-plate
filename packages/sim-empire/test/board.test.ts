/** Round 6: the monthly board meeting, its decision commands, and the flagship's maturity (R5 P3). */
import { describe, expect, it } from "vitest";
import * as K from "../src/constants";
import {
  applyEmpireCommand,
  bookNet,
  buildBoardMeeting,
  deserialize,
  emptyBook,
  expectedSiteDay,
  maturity,
  refurbCost,
  serialize,
  stepEmpireDay,
  type BoardMeeting,
  type EmpireCommand,
  type EmpireState,
} from "../src/index";
import { runStyle } from "../src/strategies";
import { content, days, empire, must, rejected, withApplicant } from "./helpers";

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

/** Steps until the evening a meeting is held (hq.day a multiple of 30), returning the per-day nets on the way. */
function toMeeting(e: EmpireState): { e: EmpireState; nets: number[] } {
  let cur = e;
  const nets: number[] = [];
  do {
    cur = stepEmpireDay(content, cur, undefined, { noEvents: true }).empire;
    nets.push(cur.hq.lastDayNet);
  } while (cur.hq.day % K.BOARD_MONTH_DAYS !== 0);
  return { e: cur, nets };
}

/** A locked brand with five franchisees on HQ-leased land and the flagship, all trading. */
function franchiseWorld(): EmpireState {
  let e = must(empire(), { type: "SET_FORMULA", locked: true });
  const spots = ["student_quarter", "business_park", "seaside", "high_street", "student_quarter"];
  spots.forEach((d, i) => {
    e = withApplicant(e, `a${i}`, { cash: 60_000_000 });
    e = must(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: d, ownership: "franchise", land: "hqLease", applicantId: `a${i}` });
  });
  return days(e, 95);
}

const site = (e: EmpireState, id: string) => e.sites.find((s) => s.id === id)!;
const send = (e: EmpireState, cmd: EmpireCommand) => applyEmpireCommand(content, e, cmd);

describe("the monthly board meeting", () => {
  it("is held on each month's last evening, deterministically, with exactly one decision of 2–3 options", () => {
    const a = toMeeting(franchiseWorld()).e;
    const b = toMeeting(franchiseWorld()).e;
    expect(serialize(a)).toBe(serialize(b));
    const m = a.boardMeeting!;
    expect(m.day).toBe(a.hq.day - 1);
    expect(m.month).toBe(Math.floor(m.day / 30));
    expect(m.decision.options.length).toBeGreaterThanOrEqual(2);
    expect(m.decision.options.length).toBeLessThanOrEqual(3);
    expect(m.decision.options.map((o) => o.id)).toContain(m.decision.advice);
    expect(a.events.filter((ev) => ev.kind === "boardMeeting").at(-1)!.day).toBe(m.day);
    // Mid-month there is nothing new to answer, and the meeting waits.
    const mid = days(a, 10);
    expect(mid.boardMeeting).toBe(a.boardMeeting);
  });

  it("income by source adds up to HQ's net for the month (fees included), in integer pence", () => {
    let e = toMeeting(franchiseWorld()).e; // the month starts clean
    e = withApplicant(e, "late", { cash: 60_000_000 });
    e = must(e, { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "franchise", land: "thirdParty", applicantId: "late" });
    const r = toMeeting(e);
    const inc = r.e.boardMeeting!.income;
    for (const v of Object.values(inc)) expect(Number.isInteger(v)).toBe(true);
    expect(inc.fees).toBe(K.DEFAULT_FRANCHISE_FEE);
    expect(inc.royalties).toBeGreaterThan(0);
    expect(inc.rent).toBeGreaterThan(0);
    expect(inc.shops).toBeGreaterThan(0); // the flagship isn't focused here, so its profit reaches HQ
    expect(inc.costs).toBeLessThan(0);
    expect(bookNet(inc)).toBe(r.nets.reduce((a, b) => a + b, 0) + K.DEFAULT_FRANCHISE_FEE);
    expect(r.e.monthBook).toEqual(emptyBook());
  });

  it("names a top mover and one risk; the picker reads no dice", () => {
    const e = toMeeting(franchiseWorld()).e;
    const m = e.boardMeeting!;
    expect(m.topMover?.cityId).toBe("harbourton");
    expect(m.risk.text.length).toBeGreaterThan(0);
    // Answering a do-nothing option leaves the dice exactly where skipping them would.
    const noop = m.decision.options.find((o) => !o.cmd)!;
    const answered = days(must(e, { type: "BOARD_DECIDE", optionId: noop.id }), 20, false);
    const unanswered = days(e, 20, false);
    expect(answered.rngState).toEqual(unanswered.rngState);
    // Pure: the same state builds the same meeting, and a deep-frozen state survives it.
    const frozen = deepFreeze(e);
    expect(buildBoardMeeting(content, frozen, emptyBook(), 59)).toEqual(buildBoardMeeting(content, frozen, emptyBook(), 59));
  });

  it("BOARD_DECIDE applies the option's command and writes one line of minutes; skipping is allowed", () => {
    const e = toMeeting(franchiseWorld()).e;
    expect(rejected(e, { type: "BOARD_DECIDE", optionId: "nonsense" })).toMatch(/isn't one of/);
    const withCmd = e.boardMeeting!.decision.options.find((o) => o.cmd)!;
    const a = must(e, { type: "BOARD_DECIDE", optionId: withCmd.id });
    expect(a.boardMeeting).toBeUndefined();
    expect(a.boardMinutes!.at(-1)).toMatchObject({ id: e.boardMeeting!.id, choice: withCmd.id, text: withCmd.label, kind: e.boardMeeting!.decision.kind });
    // The option's own command, applied directly, gives the same brand state (the board adds only the minutes).
    const direct = must(e, withCmd.cmd!);
    expect(serialize({ ...a, boardMinutes: undefined, events: [] }) === serialize({ ...direct, boardMeeting: undefined, boardMinutes: undefined, events: [] })).toBe(true);
    const s = must(e, { type: "BOARD_DECIDE", optionId: "skip" });
    expect(s.boardMinutes!.at(-1)!.choice).toBe("skip");
    expect(rejected(s, { type: "BOARD_DECIDE", optionId: "skip" })).toMatch(/No board meeting/);
  });

  it("an unanswered meeting is skipped at the next one", () => {
    const e = toMeeting(franchiseWorld()).e;
    const next = toMeeting(e).e;
    expect(next.boardMeeting!.id).not.toBe(e.boardMeeting!.id);
    expect(next.boardMinutes!.at(-1)).toMatchObject({ id: e.boardMeeting!.id, choice: "skip" });
    expect(next.boardMinutes!.at(-1)!.text).toMatch(/^No answer/);
  });

  it("skipping a franchisee's plea for a fee holiday costs their mood; saying yes buys it", () => {
    const e = toMeeting(franchiseWorld()).e;
    const fr = e.franchisees[0]!;
    const plea: BoardMeeting = {
      ...e.boardMeeting!,
      decision: {
        kind: "feeHoliday",
        question: "Help them?",
        options: [
          { id: "short", label: "One month off", detail: "", cmd: { type: "FEE_HOLIDAY", franchiseeId: fr.id, days: 30 } },
          { id: "no", label: "Say no", detail: "" },
        ],
        advice: "short",
        skipText: "",
      },
    };
    const asked = { ...e, boardMeeting: plea };
    const skipped = must(asked, { type: "BOARD_DECIDE", optionId: "skip" });
    expect(skipped.franchisees[0]!.mood).toBeCloseTo(fr.mood - K.MOOD_FEE_HOLIDAY_REFUSED, 6);
    const no = must(asked, { type: "BOARD_DECIDE", optionId: "no" });
    expect(no.franchisees[0]!.mood).toBeCloseTo(fr.mood - K.MOOD_FEE_HOLIDAY_REFUSED, 6);
    const yes = must(asked, { type: "BOARD_DECIDE", optionId: "short" });
    expect(yes.franchisees[0]!.mood).toBeGreaterThan(fr.mood);
    expect(yes.franchisees[0]!.feeHolidayUntil).toBe(e.hq.day + 30);
  });

  it("every kind of question comes up in a few years of play, and the board-follower's answers are accepted", () => {
    const f = runStyle(content, "franchise", 2, 5, undefined, "follow");
    const c = runStyle(content, "company", 2, 5, undefined, "follow");
    const kinds = new Set([...Object.keys(f.decisions), ...Object.keys(c.decisions)].map((k) => k.split(":")[0]));
    for (const k of ["royalty", "buyPlot", "refurbish", "feeHoliday", "driveThru", "supplyMarkup"]) expect(kinds).toContain(k);
    const answered = Object.values(f.decisions).reduce((a, b) => a + b, 0);
    expect(answered).toBeGreaterThan(40); // ~60 meetings in 5 years; a few go unanswered when the advice became unaffordable
  }, 60_000);
});

describe("the board's commands", () => {
  it("REFURBISH buys back maturity drag on a tired company site for its capex", () => {
    let e = franchiseWorld();
    e = { ...e, sites: e.sites.map((s) => (s.id === "s1" ? { ...s, openedTrading: e.hq.day - 2000 } : s)) };
    expect(maturity(site(e, "s1"), e.hq.day)).toBe(1);
    const before = expectedSiteDay(content, e, "s1").contribution;
    const r = must(e, { type: "REFURBISH", siteId: "s1" });
    const city = e.cities.find((c) => c.id === "harbourton")!;
    expect(e.hq.cash - r.hq.cash).toBe(refurbCost(site(e, "s1"), city, e.hq.priceLevel));
    expect(maturity(site(r, "s1"), r.hq.day)).toBeCloseTo((K.MATURE_FULL_DAYS - K.REFURB_DAYS - K.MATURE_FROM_DAYS) / (K.MATURE_FULL_DAYS - K.MATURE_FROM_DAYS), 6);
    expect(expectedSiteDay(content, r, "s1").contribution).toBeGreaterThan(before);
    // It wears off: two more years and the drag is back in full.
    expect(maturity(site(r, "s1"), r.hq.day + K.REFURB_DAYS)).toBe(1);
    // A young site has nothing to buy back.
    const young = e.sites.find((s) => s.ownership === "franchise")!;
    expect(rejected(e, { type: "REFURBISH", siteId: young.id })).toMatch(/isn't tired/);
  });

  it("FEE_HOLIDAY waives that franchisee's royalty for the holiday, then it comes back", () => {
    const e = franchiseWorld();
    const fr = e.franchisees[0]!;
    const sid = fr.sites[0]!;
    const h = must(e, { type: "FEE_HOLIDAY", franchiseeId: fr.id, days: 30 });
    expect(h.franchisees[0]!.mood).toBeCloseTo(Math.min(100, fr.mood + K.MOOD_FEE_HOLIDAY_BASE + K.MOOD_FEE_HOLIDAY_PER_MONTH), 6);
    const during = stepEmpireDay(content, h, undefined, { noEvents: true, trace: [sid] }).trace![0]!;
    expect(during.royalty).toBe(0);
    const normal = stepEmpireDay(content, e, undefined, { noEvents: true, trace: [sid] }).trace![0]!;
    expect(normal.royalty).toBeGreaterThan(0);
    expect(normal.hq - during.hq).toBeCloseTo(normal.royalty, 6);
    const after = stepEmpireDay(content, days(h, 30), undefined, { noEvents: true, trace: [sid] }).trace![0]!;
    expect(after.royalty).toBeGreaterThan(0);
    expect(rejected(h, { type: "FEE_HOLIDAY", franchiseeId: fr.id, days: 30 })).toMatch(/already/);
  });

  it("SET_SUPPLY_MARKUP moves money from franchisees to HQ on their food and costs mood", () => {
    const e = franchiseWorld();
    const sid = e.franchisees[0]!.sites[0]!;
    const m = must(e, { type: "SET_SUPPLY_MARKUP", pct: 0.02 });
    expect(m.supplyMarkupPct).toBe(0.02);
    expect(m.franchisees[0]!.mood).toBeCloseTo(e.franchisees[0]!.mood - 2 * K.MOOD_SUPPLY_MARKUP_SHOCK, 6);
    const base = stepEmpireDay(content, e, undefined, { noEvents: true, trace: [sid] }).trace![0]!;
    const up = stepEmpireDay(content, m, undefined, { noEvents: true, trace: [sid] }).trace![0]!;
    expect(up.hq - base.hq).toBeCloseTo(up.result.foodCost * 0.02, 6);
    expect(base.operator - up.operator).toBeCloseTo(up.result.foodCost * 0.02, 6);
    expect(must(m, { type: "SET_SUPPLY_MARKUP", pct: 0 }).supplyMarkupPct).toBeUndefined();
    const revolt = { ...e, association: { active: true, formedDay: e.hq.day } };
    expect(rejected(revolt, { type: "SET_SUPPLY_MARKUP", pct: 0.02 })).toMatch(/association/);
  });

  it("REMODEL with hqPays: HQ funds a franchisee's drive-thru lane, which the association doesn't block", () => {
    let e = franchiseWorld();
    e = { ...e, brand: { ...e.brand, formula: { ...e.brand.formula, driveThru: true } } };
    const s = e.sites.find((x) => x.ownership === "franchise")!;
    const fr = e.franchisees.find((f) => f.id === s.franchisee)!;
    const revolt = { ...e, association: { active: true, formedDay: e.hq.day } };
    expect(rejected(revolt, { type: "REMODEL", siteId: s.id })).toMatch(/association/);
    const r = must(revolt, { type: "REMODEL", siteId: s.id, hqPays: true });
    expect(site(r, s.id).driveThru).toBe(true);
    expect(r.franchisees.find((f) => f.id === fr.id)!.cash).toBe(fr.cash);
    expect(r.hq.cash).toBeLessThan(e.hq.cash);
    expect(r.franchisees.find((f) => f.id === fr.id)!.mood).toBeCloseTo(Math.min(100, fr.mood + K.MOOD_HQ_INVESTS), 6);
  });

  it("all of it leaves deep-frozen inputs untouched", () => {
    let e = franchiseWorld();
    e = { ...e, sites: e.sites.map((s) => (s.id === "s1" ? { ...s, openedTrading: e.hq.day - 2000 } : s)) };
    const step = (x: EmpireState) => stepEmpireDay(content, deepFreeze(x), undefined, { noEvents: true }).empire;
    while (!e.boardMeeting) e = step(e);
    const minutes = e.boardMinutes?.length ?? 0;
    const before = serialize(e);
    const frozen = deepFreeze(e);
    for (const cmd of [
      { type: "BOARD_DECIDE", optionId: frozen.boardMeeting!.decision.advice },
      { type: "BOARD_DECIDE", optionId: "skip" },
      { type: "REFURBISH", siteId: "s1" },
      { type: "FEE_HOLIDAY", franchiseeId: frozen.franchisees[0]!.id, days: 90 },
      { type: "SET_SUPPLY_MARKUP", pct: 0.03 },
      { type: "REMODEL", siteId: frozen.franchisees[0]!.sites[0]!, hqPays: true },
    ] as EmpireCommand[]) send(frozen, cmd);
    for (let i = 0; i < 31; i++) e = step(e);
    expect(serialize(frozen)).toBe(before);
    expect(e.boardMinutes!.length).toBe(minutes + 1);
  });
});

describe("saves", () => {
  it("a pending meeting and the minutes round-trip byte-identically", () => {
    let e = toMeeting(franchiseWorld()).e;
    const minutes = e.boardMinutes!.length;
    e = must(e, { type: "BOARD_DECIDE", optionId: "skip" });
    e = toMeeting(must(e, { type: "SET_SUPPLY_MARKUP", pct: 0.02 })).e;
    expect(e.boardMeeting).toBeDefined();
    expect(e.boardMinutes!.length).toBe(minutes + 1);
    const s = serialize(e);
    expect(serialize(deserialize(s))).toBe(s);
    expect(serialize(toMeeting(deserialize(s)).e)).toBe(serialize(toMeeting(e).e));
  });

  it("R5 P3: an old save's flagship gets openedTrading = the game's start, and matures", () => {
    const e = empire();
    const raw = JSON.parse(serialize(e)) as { sites: Record<string, unknown>[] };
    delete raw.sites[0]!.openedTrading;
    const old = JSON.stringify(raw);
    const loaded = deserialize(old);
    expect(loaded.sites[0]!.openedTrading).toBe(0);
    expect(maturity(loaded.sites[0]!, 1500)).toBeGreaterThan(0.5);
    // Already-current saves are untouched.
    expect(serialize(deserialize(serialize(e)))).toBe(serialize(e));
    expect(e.sites[0]!.openedTrading).toBe(-K.FLAGSHIP_AGE_DAYS);
  });
});
