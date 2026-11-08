/** Focused tests for the evening systems. */
import { describe, expect, it } from "vitest";
import { EVENT_MIN_GAP_DAYS, INSOLVENCY_DAYS, OVERHEADS_DAILY, VAT_RATE } from "../src/constants";
import { applyChoice, drawEvent, eventDeckSystem, eventEligible } from "../src/systems/eventDeck";
import {
  checkSolvency, dailyInstalment, dailyRent, financeSystem, insolvencyLine, monthlyWages, newLoan, payLoan, shiftCost, wagesToday,
} from "../src/systems/finance";
import { decayToward, nextPopularity, nextPrestige, reputationSystem, reviewText, writeReviews } from "../src/systems/reputation";
import { dayContext, moodChange, nextFatigue, staffMoodSystem, updateStaffMember } from "../src/systems/staffMood";
import { bestAndWorst, buildDayResult, rollMenu, statsSystem } from "../src/systems/stats";
import { foodCostOf, prepWasteRate, wasteSystem } from "../src/systems/waste";
import type { EventDef, GameState, MenuItem, Review } from "../src/types";
import { emptyTally } from "../src/util";
import { C, ready, rng, staffMember } from "./helpers";

const evening = (s: GameState, over: Partial<GameState> = {}): GameState => ({
  ...s, phase: "service", tick: 120, service: emptyTally(), todays: { reviews: [] }, ...over,
});

describe("FinanceSystem", () => {
  it("pays rent, wages of staff on today's rota, overheads, VAT and the loan", () => {
    const s = evening(ready(), { todays: { reviews: [], revenue: 120_000 } });
    const r = financeSystem(C, s, rng());
    const t = r.state.todays;
    expect(t.rent).toBe(Math.round(C.districts[0]!.monthlyRent / 30));
    expect(t.labourCost).toBe(wagesToday(s));
    expect(t.vat).toBe(Math.round((120_000 * VAT_RATE) / (1 + VAT_RATE)));
    expect(t.overheads).toBeGreaterThanOrEqual(OVERHEADS_DAILY);
    expect(t.loanPayment).toBe(s.loan.dailyPayment);
    expect(r.state.cash).toBe(s.cash - t.rent! - t.labourCost! - t.overheads! - t.vat! - t.loanPayment!);
  });

  it("only pays staff rostered today", () => {
    const s = ready();
    const off = { ...s, staff: s.staff.map((x) => ({ ...x, rota: [false, false, false, false, false, false, false] })) };
    expect(wagesToday(off)).toBe(0);
    expect(wagesToday({ ...s, staff: s.staff.map((x) => ({ ...x, rota: Array(7).fill(true) })) })).toBe(s.staff.reduce((a, x) => a + shiftCost(x), 0));
  });

  it("amortises the loan to zero over its term", () => {
    expect(dailyInstalment(0, 0.08, 100)).toBe(0);
    expect(dailyInstalment(36_500, 0, 365)).toBe(100);
    let loan = newLoan(1_000_000, 0.08, 365);
    let paid = 0;
    for (let d = 0; d < 400 && loan.daysRemaining > 0; d++) {
      const r = payLoan(loan, 0.08);
      loan = r.loan;
      paid += r.payment;
    }
    expect(loan.remaining).toBe(0);
    expect(paid).toBeGreaterThan(1_000_000);
    expect(paid).toBeLessThan(1_050_000);
    expect(payLoan(loan, 0.08).payment).toBe(0);
  });

  it("normal: game over after 14 consecutive evenings below the line", () => {
    const s = ready();
    const line = insolvencyLine(C, s);
    expect(line).toBe(-3 * (dailyRent(C, s) * 30 + monthlyWages(s)));
    let cur: GameState = { ...s, cash: line - 1 };
    for (let d = 1; d < INSOLVENCY_DAYS; d++) {
      cur = checkSolvency(C, cur).state;
      expect(cur.distressDays).toBe(d);
      expect(cur.phase).not.toBe("gameover");
    }
    const end = checkSolvency(C, cur);
    expect(end.state.phase).toBe("gameover");
    expect(end.events.some((e) => e.type === "GAME_OVER")).toBe(true);
    expect(checkSolvency(C, { ...cur, cash: 0 }).state.distressDays).toBe(0);
  });

  it("cosy: clamps cash at zero and warns instead", () => {
    const s = { ...ready(1, "cosy"), cash: -50_000 };
    const r = checkSolvency(C, s);
    expect(r.state.cash).toBe(0);
    expect(r.events.some((e) => e.type === "CASH_LOW")).toBe(true);
    expect(checkSolvency(C, { ...s, cash: 10 }).events).toEqual([]);
  });
});

describe("WasteSystem", () => {
  it("trims prep waste from stock, bins expired batches and books food cost", () => {
    const s0 = ready();
    const s = evening(s0, {
      day: 10,
      stock: [
        { ingredientId: "beef", qty: 10, oldestDay: 10, batches: [{ qty: 10, day: 10 }] },
        { ingredientId: "fish", qty: 5, oldestDay: 0, batches: [{ qty: 5, day: 0 }] },
      ],
      service: { ...emptyTally(), ingredientsUsed: { beef: 20 }, plateWaste: 340 },
    });
    const r = wasteSystem(C, s, rng());
    const w = r.state.todays.waste!;
    expect(w.prep).toBeGreaterThan(0);
    expect(r.state.stock.find((x) => x.ingredientId === "beef")!.qty).toBeLessThan(10);
    expect(w.spoil).toBe(5 * 280);
    expect(r.state.stock.find((x) => x.ingredientId === "fish")!.qty).toBe(0);
    expect(w.plate).toBe(340);
    expect(r.state.todays.foodCost).toBe(foodCostOf(C, { beef: 20 }));
    expect(r.events.some((e) => e.type === "LOG")).toBe(true);
  });

  it("better chefs waste less in prep", () => {
    const s = ready();
    const good = { ...s, staff: [staffMember({ skill: 95 })] };
    const poor = { ...s, staff: [staffMember({ skill: 20 })] };
    expect(prepWasteRate(C, good)).toBeLessThan(prepWasteRate(C, poor));
    expect(prepWasteRate(C, { ...s, staff: [] })).toBeGreaterThan(0);
  });
});

describe("ReputationSystem", () => {
  it("popularity moves toward rating × 20 and loses points for walk-outs", () => {
    const rep = { popularity: 40, prestige: 50 };
    expect(nextPopularity(C, rep, 5, 0)).toBeGreaterThan(45);
    expect(nextPopularity(C, rep, 1, 0)).toBeLessThan(40);
    expect(nextPopularity(C, rep, undefined, 10)).toBeLessThan(40);
    expect(decayToward(50.1, 0.5)).toBe(50);
    expect(decayToward(30, 1)).toBe(31);
  });

  it("prestige rises on good, high-quality reviews and falls on bad ones", () => {
    const rev = (rating: number, quality: number): Review => ({ day: 0, source: "online", rating, text: "", quality });
    const rep = { popularity: 50, prestige: 50 };
    expect(nextPrestige(C, rep, [rev(5, 80), rev(4, 75)])).toBeGreaterThan(50);
    expect(nextPrestige(C, rep, [rev(5, 40)])).toBe(50);
    expect(nextPrestige(C, rep, [rev(1, 80)])).toBeLessThan(50);
  });

  it("writes templated reviews in proportion to covers", () => {
    const s = ready();
    const paid = Array.from({ length: 30 }, () => ({ segment: "families", partySize: 2, rating: 4, quality: 72, dishId: "burger" }));
    const reviews = writeReviews(C, s, rng(), { ...emptyTally(), paid }, 60);
    expect(reviews.length).toBeGreaterThanOrEqual(3);
    expect(reviews.length).toBeLessThanOrEqual(4);
    expect(reviews[0]!.text.length).toBeGreaterThan(0);
    expect(writeReviews(C, s, rng(), emptyTally(), 0)).toEqual([]);
    const custom = { ...C, reviewTemplates: { "4": ["{segment} loved the {dish} at {restaurant}"] } };
    expect(reviewText(custom, s, rng(), 4, "burger", "families")).toBe("Families loved the Steak burger at Test Kitchen");
  });

  it("records rating and reputation deltas on todays", () => {
    const s = evening(ready(), {
      todays: { reviews: [], covers: 20 },
      service: { ...emptyTally(), ratingSum: 80, ratedCovers: 20, paid: [{ segment: "foodies", partySize: 2, rating: 4, quality: 80 }] },
    });
    const r = reputationSystem(C, s, rng());
    expect(r.state.todays.averageRating).toBe(4);
    expect(r.state.todays.popularityDelta).toBeCloseTo(r.state.reputation.popularity - s.reputation.popularity);
  });
});

describe("StaffMoodSystem", () => {
  const ctx = { covers: 40, meanRating: 3, tipsPerFoh: 1500, workingCount: 2, managerOn: false };

  it("fatigue rises on worked days and recovers on rest days", () => {
    expect(nextFatigue(true, 20, 20)).toBeGreaterThan(20);
    expect(nextFatigue(false, 50, 0)).toBeLessThan(50);
    expect(nextFatigue(false, 5, 0)).toBe(0);
  });

  it("mood falls with fatigue, overwork and low tips; rises with good days", () => {
    const s = staffMember({ mood: 60, role: "server" });
    const base = moodChange(C, s, true, ctx, 30);
    expect(moodChange(C, s, true, ctx, 95)).toBeLessThan(base);
    expect(moodChange(C, s, true, { ...ctx, tipsPerFoh: 0 }, 30)).toBeLessThan(base);
    expect(moodChange(C, s, true, { ...ctx, meanRating: 5 }, 30)).toBeGreaterThan(base);
    expect(moodChange(C, s, true, { ...ctx, managerOn: true }, 30)).toBeGreaterThan(base);
    const fiveDays = { ...s, rota: [false, false, true, true, true, true, true] };
    expect(moodChange(C, s, true, ctx, 30)).toBeLessThan(moodChange(C, fiveDays, true, ctx, 30));
    expect(moodChange(C, s, false, ctx, 0)).toBeGreaterThan(0);
  });

  it("cheerful staff shrug off bad days", () => {
    const plain = staffMember({ mood: 60 });
    const cheerful = staffMember({ mood: 60, traits: ["cheerful"] });
    const bad = { ...ctx, meanRating: 1 };
    expect(moodChange(C, cheerful, true, bad, 90)).toBeGreaterThan(moodChange(C, plain, true, bad, 90));
  });

  it("skill grows toward potential on worked days", () => {
    const s = staffMember({ skill: 50, potential: 50.1 });
    expect(updateStaffMember(C, s, 0, ctx).skill).toBe(50.1);
    expect(updateStaffMember(C, { ...s, rota: Array(7).fill(false) }, 0, ctx).skill).toBe(50);
  });

  it("records mood deltas and miserable staff may quit", () => {
    const s = evening(ready(), { todays: { reviews: [], covers: 30 } });
    const r = staffMoodSystem(C, s, rng());
    expect(Object.keys(r.state.todays.staffMoodDelta!)).toEqual(s.staff.map((x) => x.id));
    expect(dayContext(s).workingCount).toBeGreaterThanOrEqual(0);
    const miserable = { ...s, staff: s.staff.map((x) => ({ ...x, mood: 0, fatigue: 100 })) };
    let quits = 0;
    for (let i = 0; i < 20; i++) quits += staffMoodSystem(C, miserable, rng(i)).state.staff.length < miserable.staff.length ? 1 : 0;
    expect(quits).toBeGreaterThan(0);
  });
});

describe("EventDeck", () => {
  const ev = C.events.find((e) => e.id === "food-blogger")!;

  it("checks when-conditions and cooldowns", () => {
    const s = ready();
    expect(eventEligible(ev, s, 1)).toBe(false); // minDay 3
    expect(eventEligible(ev, s, 5)).toBe(true);
    expect(eventEligible(ev, { ...s, eventHistory: [{ eventId: ev.id, day: 4 }] }, 5)).toBe(false);
    const strict: EventDef = { ...ev, when: { minCash: 1e12, month: [1] } };
    expect(eventEligible(strict, s, 5)).toBe(false);
    expect(eventEligible({ ...ev, when: { maxDay: 2 } }, s, 5)).toBe(false);
    expect(eventEligible({ ...ev, when: { maxCash: -1 } }, s, 5)).toBe(false);
    expect(eventEligible({ ...ev, when: { minPopularity: 99 } }, s, 5)).toBe(false);
    expect(eventEligible({ ...ev, when: { minPrestige: 99 } }, s, 5)).toBe(false);
    expect(eventEligible({ ...ev, weight: 0 }, s, 5)).toBe(false);
  });

  it("queues an event for the morning with the right frequency and gap", () => {
    const s = { ...ready(), day: 10 };
    let drawn = 0;
    for (let i = 0; i < 400; i++) if (drawEvent(C, s, rng(i))) drawn++;
    expect(drawn / 400).toBeGreaterThan(0.08);
    expect(drawn / 400).toBeLessThan(0.25);
    const recent = { ...s, eventHistory: [{ eventId: "boiler", day: s.day + 1 - (EVENT_MIN_GAP_DAYS - 1) }] };
    for (let i = 0; i < 50; i++) expect(drawEvent(C, recent, rng(i))).toBeUndefined();
    let seed = 0;
    while (!eventDeckSystem(C, s, rng(seed)).state.activeEvent) seed++;
    const r = eventDeckSystem(C, s, rng(seed));
    expect(r.events[0]).toMatchObject({ type: "EVENT_TRIGGERED" });
    expect(r.state.eventHistory!.at(-1)!.day).toBe(11);
    expect(eventDeckSystem(C, { ...s, phase: "gameover" }, rng()).events).toEqual([]);
  });

  it("applies choice effects", () => {
    const s = ready();
    const host = applyChoice(s, ev.choices[0]!).state;
    expect(host.cash).toBe(s.cash - 6_000);
    expect(host.reputation.popularity).toBe(s.reputation.popularity + 4);
    expect(host.footfallMods).toEqual([{ mult: 1.15, daysRemaining: 5 }]);
    const kettle = applyChoice(s, C.events[1]!.choices[1]!).state;
    expect(kettle.staff[0]!.mood).toBe(s.staff[0]!.mood - 8);
  });
});

describe("StatsSystem", () => {
  it("builds a DayResult whose profit matches its lines", () => {
    const s = evening(ready(), {
      todays: { reviews: [], covers: 10, revenue: 30_000, foodCost: 9_000, labourCost: 8_000, rent: 10_000, loanPayment: 3_000, overheads: 8_000, vat: 5_000, waste: { prep: 500, plate: 300, spoil: 200 } },
    });
    const d = buildDayResult(s);
    expect(d.profit).toBe(30_000 - 5_000 - 9_000 - 500 - 200 - 8_000 - 10_000 - 8_000 - 3_000);
    expect(d.averageSpend).toBe(3_000);
    const r = statsSystem(C, s, rng());
    expect(r.state.history.at(-1)).toEqual(d);
    expect(r.state.stats).toEqual({ totalCovers: 10, totalRevenue: 30_000, daysOpen: 1 });
  });

  it("best by margin, worst by quality, and a rolling 7-day menu window", () => {
    const dishes = {
      a: { sold: 5, plated: 5, qualitySum: 400, margin: 5000 },
      b: { sold: 3, plated: 3, qualitySum: 120, margin: 900 },
      c: { sold: 0, plated: 0, qualitySum: 0, margin: 0 },
    };
    expect(bestAndWorst(dishes)).toEqual({ best: "a", worst: "b" });
    expect(bestAndWorst({ a: dishes.a })).toEqual({ best: "a" });
    let menu: MenuItem[] = [{ dishId: "a", price: 1000, active: true, sold7d: 0, margin7d: 0 }];
    for (let d = 0; d < 9; d++) menu = rollMenu(menu, dishes);
    expect(menu[0]!.recent).toHaveLength(7);
    expect(menu[0]!.sold7d).toBe(35);
    expect(rollMenu(menu, {})[0]!.sold7d).toBe(30);
  });
});
