/** Round 11 (B): stop silent losing — the bank's countdown, spend check, Cosy hiring, starter loan and starter chef. */
import { describe, expect, it } from "vitest";
import {
  applyCommand, bankStatus, candidates, deserialize, hireNeed, newGame, runDay, runningCostPerDay, serialize, spendCheck,
  starterLoanOffer, STARTER_LOAN, STARTER_LOAN_MAX, SPEND_SAFETY_DAYS, INSOLVENCY_DAYS, STOCK_OVERDRAFT_LIMIT,
} from "../src/index";
import { insolvencyLine } from "../src/systems/finance";
import { roughNight } from "../src/systems/reputation";
import { playOne, STRATEGIES } from "../src/strategies";
import type { GameState } from "../src/types";
import { C, fresh, ready, step } from "./helpers";
import { moodNote } from "../src/systems/staffMood";

const bad = (s: GameState, r: ReturnType<typeof applyCommand>) => r.events.some((e) => e.type === "LOG" && e.entry.kind === "bad") && r.state.cash === s.cash;

/** Plays the day after setting cash, returning the evening state and its events. */
function evening(s: GameState) {
  const r = runDay(C, s);
  return r;
}

describe("bankStatus: the countdown fields", () => {
  it("is quiet above the line and on Cosy", () => {
    const s = ready();
    expect(bankStatus(C, s)).toMatchObject({ canGoBust: true, below: false, daysBelow: 0, daysLeft: null });
    expect(bankStatus(C, s).line).toBe(insolvencyLine(C, s));
    const cosy = { ...ready(1, "cosy"), cash: -10_000_000 };
    expect(bankStatus(C, cosy)).toMatchObject({ canGoBust: false, below: false, daysLeft: null });
  });

  it("counts down from INSOLVENCY_DAYS − 1 after the first evening below, and CASH_LOW carries it", () => {
    let s = ready();
    s = { ...s, cash: insolvencyLine(C, s) - 500_000 };
    const r = evening(s);
    const st = bankStatus(C, r.state);
    expect(st.below).toBe(true);
    expect(st.daysBelow).toBe(1);
    expect(st.daysLeft).toBe(INSOLVENCY_DAYS - 1);
    const low = r.events.find((e) => e.type === "CASH_LOW");
    expect(low).toMatchObject({ type: "CASH_LOW", daysLeft: INSOLVENCY_DAYS - 1 });
    expect((low as { line: number }).line).toBe(insolvencyLine(C, r.state));
  });

  it("CASH_LOW below zero but above the line has no countdown", () => {
    const s = { ...ready(), cash: -1 };
    const low = evening(s).events.find((e) => e.type === "CASH_LOW") as { daysLeft?: number } | undefined;
    expect(low).toBeDefined();
    expect(low!.daysLeft).toBeUndefined();
  });
});

describe("spendCheck: three days of running costs", () => {
  it("running costs are rent + wages + bills + loan + a typical day's stock", () => {
    const s = ready();
    const day = runningCostPerDay(C, s);
    expect(day).toBeGreaterThan(s.loan.dailyPayment);
    expect(Number.isInteger(day)).toBe(true);
    const c = spendCheck(C, s, s.cash - SPEND_SAFETY_DAYS * day + 1);
    expect(c.risky).toBe(true);
    expect(c.floor).toBe(SPEND_SAFETY_DAYS * day);
    expect(spendCheck(C, s, s.cash - SPEND_SAFETY_DAYS * day).risky).toBe(false);
    expect(spendCheck(C, s, 0).risky).toBe(false);
  });

  it("with no chef, the floor is at least what the cheapest chef needs", () => {
    const s = { ...fresh(), cash: 1_000_000 };
    const cheapest = Math.min(...candidates(C, s).filter((c) => c.role === "chef").map((c) => hireNeed(s, c.wage).needed));
    expect(spendCheck(C, s, 0).floor).toBeGreaterThanOrEqual(cheapest);
    expect(spendCheck(C, s, s.cash - cheapest + 1).risky).toBe(true);
  });
});

describe("hireNeed: Cosy can hire into the stock overdraft (G2)", () => {
  it("Normal keeps fee + 5 shifts; HIRE agrees", () => {
    const s = { ...fresh(), cash: 0 };
    const c = candidates(C, s)[0]!;
    const n = hireNeed(s, c.wage);
    expect(n.overdraft).toBe(false);
    expect(n.canAfford).toBe(false);
    expect(bad(s, applyCommand(C, s, { type: "HIRE", candidateIndex: 0 }))).toBe(true);
    const rich = { ...s, cash: n.needed };
    expect(applyCommand(C, rich, { type: "HIRE", candidateIndex: 0 }).state.staff).toHaveLength(1);
  });

  it("a staffless Cosy owner at £0 can hire; the fee goes into the overdraft", () => {
    const s = { ...fresh(1, "cosy"), cash: 0 };
    const c = candidates(C, s)[0]!;
    expect(hireNeed(s, c.wage)).toMatchObject({ overdraft: true, canAfford: true });
    const r = applyCommand(C, s, { type: "HIRE", candidateIndex: 0 });
    expect(r.state.staff).toHaveLength(1);
    expect(r.state.cash).toBe(-hireNeed(s, c.wage).fee);
    // …but not beyond the supplier's limit.
    const deep = { ...s, cash: -STOCK_OVERDRAFT_LIMIT };
    expect(bad(deep, applyCommand(C, deep, { type: "HIRE", candidateIndex: 0 }))).toBe(true);
  });
});

describe("STARTER_LOAN: the bank lends a first wage, once", () => {
  it("lends what the cheapest chef needs (≥ £1,000), adds it to the loan, re-spreads the instalment, once", () => {
    const s = { ...fresh(), cash: 5_000 };
    const amount = starterLoanOffer(C, s)!;
    const cheapest = Math.min(...candidates(C, s).filter((c) => c.role === "chef").map((c) => hireNeed(s, c.wage).needed));
    expect(amount).toBeGreaterThanOrEqual(STARTER_LOAN);
    expect(amount % 10_000).toBe(0);
    expect(s.cash + amount).toBeGreaterThanOrEqual(cheapest);
    expect(amount).toBe(Math.max(STARTER_LOAN, Math.ceil((cheapest - s.cash) / 10_000) * 10_000));
    const r = applyCommand(C, s, { type: "STARTER_LOAN" });
    expect(r.state.cash).toBe(s.cash + amount);
    expect(r.state.loan.remaining).toBe(s.loan.remaining + amount);
    expect(r.state.loan.principal).toBe(s.loan.principal + amount);
    expect(r.state.loan.dailyPayment).toBeGreaterThan(s.loan.dailyPayment);
    expect(r.state.starterLoan).toBe(true);
    expect(starterLoanOffer(C, r.state)).toBeNull();
    expect(bad(r.state, applyCommand(C, r.state, { type: "STARTER_LOAN" }))).toBe(true);
    expect(deserialize(serialize(r.state)).starterLoan).toBe(true);
  });

  it("is refused with staff, on Cosy, in service, and when the hole is deeper than STARTER_LOAN_MAX", () => {
    expect(bad(ready(), applyCommand(C, ready(), { type: "STARTER_LOAN" }))).toBe(true);
    const cosy = fresh(1, "cosy");
    expect(bad(cosy, applyCommand(C, cosy, { type: "STARTER_LOAN" }))).toBe(true);
    const svc = { ...fresh(), phase: "service" as const };
    expect(bad(svc, applyCommand(C, svc, { type: "STARTER_LOAN" }))).toBe(true);
    const deep = { ...fresh(), cash: -STARTER_LOAN_MAX };
    expect(starterLoanOffer(C, deep)).toBeNull();
    expect(bad(deep, applyCommand(C, deep, { type: "STARTER_LOAN" }))).toBe(true);
  });

  it("then hiring a chef is affordable from a broke start (the red-team's £25 after the decor spree)", () => {
    let s = { ...fresh(), cash: 2_500 };
    const i = candidates(C, s).findIndex((c) => c.role === "chef");
    expect(hireNeed(s, candidates(C, s)[i]!.wage).canAfford).toBe(false);
    s = step(s, { type: "STARTER_LOAN" });
    const j = candidates(C, s).map((c, k) => ({ c, k })).filter((x) => x.c.role === "chef").sort((a, b) => a.c.wage - b.c.wage)[0]!.k;
    expect(hireNeed(s, candidates(C, s)[j]!.wage).canAfford).toBe(true);
    expect(step(s, { type: "HIRE", candidateIndex: j }).staff).toHaveLength(1);
  });

  it("an old save (no starterLoan field) serializes byte-identically", () => {
    const s = ready();
    expect("starterLoan" in s).toBe(false);
    expect(serialize(deserialize(serialize(s)))).toBe(serialize(s));
  });
});

describe("NEW_GAME.starterChef", () => {
  const cmd = { type: "NEW_GAME" as const, seed: 7, districtId: "highstreet", restaurantName: "Chef", difficulty: "normal" as const };
  it("opens with the best-value chef candidate, no fee, the chef goal quietly done", () => {
    const plain = newGame(C, cmd);
    const s = newGame(C, { ...cmd, starterChef: true });
    expect(s.staff).toHaveLength(1);
    expect(s.staff[0]!.role).toBe("chef");
    expect(s.cash).toBe(plain.cash);
    expect(s.rngState).toEqual(plain.rngState);
    expect(s.goals?.find((g) => g.kind === "hire_role" && g.role === "chef")?.done).toBe(true);
    const pool = candidates(C, s);
    expect(pool[s.hiredCandidates![0]!]!.hired).toBe(true);
    // deterministic
    expect(serialize(newGame(C, { ...cmd, starterChef: true }))).toBe(serialize(s));
    // the goal doesn't "complete" (and toast) on her first command
    const r = applyCommand(C, s, { type: "ADD_MENU_ITEM", dishId: C.dishes[0]!.id, price: C.dishes[0]!.suggestedPrice });
    expect(r.events.some((e) => e.type === "GOAL_COMPLETED" && e.goalId === "t0-chef")).toBe(false);
  });

  it("without the flag a new game is exactly as before (no staff)", () => {
    expect(newGame(C, cmd).staff).toHaveLength(0);
  });
});

describe("headless: nohire is no longer a silent 0%", () => {
  it("records the first day below the bank's line and the last-days warnings", () => {
    const r = playOne(C, 3, 200, STRATEGIES.nohire, "normal");
    if (!r.survived) {
      expect(r.firstBelowDay).toBeDefined();
      expect(r.lastDaysWarnings).toBeGreaterThan(0);
    }
    const chef = playOne(C, 3, 40, STRATEGIES.nohire, "normal", { starterChef: true });
    expect(chef.final!.staff.some((s) => s.role === "chef")).toBe(true);
  });
});

describe("U12: mixed signals", () => {
  it("the mood reason points the same way as the day's change", () => {
    const clash = { delta: -1, text: "stuck on a shift with Nikhil" };
    const guests = { delta: 2, text: "the guests loved it" };
    // +3 day overall: the clash (a personality reason, which normally wins) must not be the reason shown.
    expect(moodNote([guests, clash], 3, [clash])).toEqual({ text: "the guests loved it", delta: 3 });
    // a down day keeps the clash
    expect(moodNote([guests, clash], -1, [clash])!.text).toBe("stuck on a shift with Nikhil");
    // nothing pointing the right way: a plain word, never the opposite reason
    expect(moodNote([clash], 2, [clash])).toEqual({ text: "a good day", delta: 2 });
    // a flat day keeps the old rule (biggest reason of all)
    expect(moodNote([guests, clash], 0.2, [clash])!.text).toBe("stuck on a shift with Nikhil");
  });

  it("a rough night is one with more walk-outs than guests, or under 2.5★", () => {
    expect(roughNight(31, 15, 2.7)).toBe(true);
    expect(roughNight(2, 40, 4.2)).toBe(false);
    expect(roughNight(0, 10, 2.4)).toBe(true);
    expect(roughNight(0, 0, undefined)).toBe(false);
  });
});
