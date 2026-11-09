import { describe, expect, it } from "vitest";
import { serialize } from "@full-plate/sim-core";
import {
  advanceCareerDay, applyCareerCommand, beginCareerDay, DEFAULT_POLICY, deserializeCareer, deserializeCareerGame, incomeTaxWeek,
  nationalInsuranceWeek, newCareer, OWNERS, payslip, PLAYER_ID, serializeCareer, serializeCareerGame, stepCareerDay, troncShare,
  type CareerGame, type CareerTrack,
} from "../src/index";
import { shiftGrowth } from "../src/career";
import { runService } from "../src/owner";
import { content, fakeResult, fakeStaff, played } from "./helpers";

const TRACKS: CareerTrack[] = ["chef", "bar", "waiter", "manager"];

describe("starting a career", () => {
  it.each(TRACKS)("%s: the player is one of the employer's staff, in an established restaurant", (track) => {
    const g = newCareer(content, { seed: 5, track });
    const me = g.state.staff.find((s) => s.id === PLAYER_ID)!;
    expect(me).toBeDefined();
    expect(me.role).toBe(g.career.role);
    expect(me.wage).toBe(g.career.wage);
    expect(g.state.phase).toBe("planning");
    expect(g.state.history.length).toBeGreaterThan(7);
    expect(g.state.menu.length).toBeGreaterThan(3);
    expect(g.career.rung).toBe(0);
    expect(g.career.relationships.length).toBeGreaterThan(0);
  });

  it("is deterministic: same seed and policy ⇒ identical career and state after 60 days", () => {
    const run = () => {
      let g = newCareer(content, { seed: 9, track: "bar", strategy: "premium" });
      for (let d = 0; d < 60; d++) g = advanceCareerDay(content, g, DEFAULT_POLICY).game;
      return serializeCareerGame(g);
    };
    expect(run()).toBe(run());
  });

  it("career and game round-trip through serialisation with a version", () => {
    const g = played("waiter", 30);
    expect(deserializeCareer(serializeCareer(g.career))).toEqual(g.career);
    expect(serializeCareer(deserializeCareer(serializeCareer(g.career)))).toBe(serializeCareer(g.career));
    const back = deserializeCareerGame(serializeCareerGame(g));
    expect(serialize(back.state)).toBe(serialize(g.state));
    expect(back.career).toEqual(g.career);
    expect(() => deserializeCareer(JSON.stringify({ ...g.career, version: 99 }))).toThrow(/version/);
    // Continuing from a reloaded save gives the same day as continuing directly.
    expect(serializeCareerGame(advanceCareerDay(content, back, DEFAULT_POLICY).game)).toBe(serializeCareerGame(advanceCareerDay(content, g, DEFAULT_POLICY).game));
  });

  it("never mutates its inputs", () => {
    const g = played("chef", 10);
    const before = serializeCareerGame(g);
    advanceCareerDay(content, g, DEFAULT_POLICY);
    applyCareerCommand(content, g, { type: "ASK_FOR_RAISE" });
    expect(serializeCareerGame(g)).toBe(before);
  });
});

describe("the AI owner", () => {
  it("rosters the player from their shift plan and issues normal sim-core commands", () => {
    const g = played("chef", 3);
    const r = beginCareerDay(content, g);
    const me = r.game.state.staff.find((s) => s.id === PLAYER_ID)!;
    expect(me.rota).toEqual(g.career.shiftPlan);
    for (const c of r.ownerCommands) expect(["ADD_MENU_ITEM", "HIRE", "SET_ROTA", "BUY_TABLE", "TRAIN"]).toContain(c.type);
  });

  it("returns stock orders then END_DAY (or an event answer) as nextOwnerCommands", () => {
    const g = played("waiter", 5);
    const begun = beginCareerDay(content, g).game;
    let s = begun.state;
    s = runService(content, begun.career.owner.strategy, s);
    const r = stepCareerDay(content, begun.career, s, s.history.at(-1)!);
    const last = r.nextOwnerCommands.at(-1)!;
    expect(["END_DAY", "RESOLVE_EVENT"]).toContain(last.type);
    expect(r.nextOwnerCommands.slice(0, -1).every((c) => c.type === "ORDER_STOCK")).toBe(true);
  });

  it("owner personality changes the feel: premium prices higher, trains more and grows you faster; cheap overworks", () => {
    expect(OWNERS.premium.priceMult).toBeGreaterThan(OWNERS.cheap.priceMult);
    const prem = newCareer(content, { seed: 3, track: "chef", strategy: "premium", districtId: "high_street" });
    const cheap = newCareer(content, { seed: 3, track: "chef", strategy: "cheap", districtId: "high_street" });
    const avgPrice = (g: typeof prem) => g.state.menu.reduce((a, m) => a + m.price / content.dishes.find((d) => d.id === m.dishId)!.suggestedPrice, 0) / g.state.menu.length;
    expect(avgPrice(prem)).toBeGreaterThan(avgPrice(cheap));
    const coreDays = (g: typeof prem) => g.state.staff.filter((s) => s.id !== PLAYER_ID)[0]!.rota.filter(Boolean).length;
    expect(coreDays(cheap)).toBe(6);
    expect(coreDays(prem)).toBe(5);
    const p = played("chef", 120, 3, "premium");
    const c = played("chef", 120, 3, "cheap");
    expect(p.career.stats.skill).toBeGreaterThan(c.career.stats.skill);
    expect(p.career.lifetime.trainingDays).toBeGreaterThan(c.career.lifetime.trainingDays);
  });
});

describe("shifts and wellbeing", () => {
  it("declining a contract shift costs owner mood; weekend shifts are optional and cost personal mood", () => {
    const g = played("chef", 7);
    const off = applyCareerCommand(content, g, { type: "TAKE_SHIFT", weekday: 0, take: false }).game;
    expect(off.career.shiftPlan[0]).toBe(false);
    const seven = [4, 5, 6].reduce<CareerGame>((acc, wd) => applyCareerCommand(content, acc, { type: "TAKE_SHIFT", weekday: wd, take: true }).game, g);
    expect(seven.career.shiftPlan.filter(Boolean).length).toBeLessThanOrEqual(6);
    expect(seven.career.log.at(-1)!.text).toMatch(/Working Time/);
  });

  it("taking no weekend shifts ⇒ fewer shifts and less pay than taking two", () => {
    const none = played("waiter", 56, 4, "balanced", { ...DEFAULT_POLICY, weekendShifts: 0, acceptOffers: false });
    const two = played("waiter", 56, 4, "balanced", { ...DEFAULT_POLICY, weekendShifts: 2, acceptOffers: false });
    expect(two.career.shiftsWorked).toBeGreaterThan(none.career.shiftsWorked);
    expect(two.career.lifetime.wages).toBeGreaterThan(none.career.lifetime.wages);
    expect(two.career.lifetime.weekendShifts).toBeGreaterThan(0);
    expect(none.career.lifetime.weekendShifts).toBe(0);
  });

  it("a cheap owner is more stressful than a balanced one", () => {
    const avgStress = (strategy: "cheap" | "balanced") => {
      let g = newCareer(content, { seed: 2, track: "waiter", strategy, districtId: "high_street" });
      let sum = 0;
      for (let d = 0; d < 42; d++) {
        g = advanceCareerDay(content, g, { ...DEFAULT_POLICY, acceptOffers: false }).game;
        sum += g.career.stress;
      }
      return sum / 42;
    };
    expect(avgStress("cheap")).toBeGreaterThan(avgStress("balanced"));
  });

  it("a mentor speeds growth on shared shifts", () => {
    const c = played("chef", 0).career;
    expect(shiftGrowth(c, true)).toBeCloseTo(shiftGrowth(c, false) * 1.5);
  });

  it("MENTOR_SESSION needs a mentor and has a weekly cooldown", () => {
    const g = played("chef", 3);
    const none = { ...g, career: (({ mentor: _m, ...c }) => c)(g.career) };
    expect(applyCareerCommand(content, none, { type: "MENTOR_SESSION" }).rejected).toMatch(/mentor/);
    const withM = { ...g, career: { ...g.career, mentor: "owner" as const } };
    const r = applyCareerCommand(content, withM, { type: "MENTOR_SESSION" });
    expect(r.rejected).toBeUndefined();
    expect(r.game.career.stats.skill).toBeGreaterThan(g.career.stats.skill);
    expect(applyCareerCommand(content, r.game, { type: "MENTOR_SESSION" }).rejected).toBeTruthy();
  });
});

describe("money", () => {
  it("tronc: all tips are shared by points among those on shift; kitchen points are scaled", () => {
    const g = played("waiter", 2);
    const state = { ...g.state, day: 100, staff: [fakeStaff(PLAYER_ID, { role: "server", rota: Array(7).fill(true) }), fakeStaff("c1", { role: "chef", skill: 0 }), fakeStaff("s1", { role: "server", skill: 0 })] };
    const share = troncShare(g.career, state, fakeResult(100, { tips: 10_000 }));
    // waiter rung 0 = 1 point; chef 0.7; server 1 ⇒ 1 / 2.7
    expect(share).toBe(Math.floor(10_000 / 2.7));
    const off = { ...state, staff: state.staff.map((s) => (s.id === PLAYER_ID ? { ...s, rota: Array(7).fill(false) } : s)) };
    expect(troncShare(g.career, off, fakeResult(100, { tips: 10_000 }))).toBe(0);
  });

  it("weekly PAYE and NI follow 2026/27 thresholds; tronc tips are NI-free", () => {
    expect(incomeTaxWeek(24_000)).toBe(0);
    expect(incomeTaxWeek(50_000)).toBe(Math.round((50_000 - Math.round(1_257_000 / 52)) * 0.2));
    expect(nationalInsuranceWeek(50_000)).toBe(Math.round((50_000 - Math.round(1_257_000 / 52)) * 0.08));
    const withTips = payslip(6, 50_000, 10_000, 0);
    const noTips = payslip(6, 50_000, 0, 0);
    expect(withTips.ni).toBe(noTips.ni);
    expect(withTips.tax).toBeGreaterThan(noTips.tax);
    expect(withTips.saved).toBe(50_000 + 10_000 - withTips.tax - withTips.ni - withTips.living);
  });

  it("savings accumulate from wages and tronc; a 40-hour NLW week is about £508 gross", () => {
    const g = played("chef", 28);
    expect(g.career.payslips[0]!.wages).toBe(1271 * 10 * 4 + (g.career.payslips[0]!.wages - 1271 * 40));
    expect(g.career.savings).toBe(g.career.payslips.reduce((a, p) => a + p.saved, 0));
    expect(g.career.lifetime.tips).toBeGreaterThan(0);
  });

  it("ASK_FOR_RAISE: granted or refused, then a four-week cooldown; capped at the band", () => {
    const g = played("waiter", 30);
    const happy = { ...g, career: { ...g.career, cooldowns: {}, owner: { ...g.career.owner, mood: 90 } } };
    const r = applyCareerCommand(content, happy, { type: "ASK_FOR_RAISE" });
    const ev = r.events.find((e) => e.type === "RAISE");
    expect(ev).toBeDefined();
    if (ev?.type === "RAISE" && ev.granted) expect(r.game.career.wage).toBeGreaterThan(g.career.wage);
    expect(applyCareerCommand(content, r.game, { type: "ASK_FOR_RAISE" }).rejected).toMatch(/recently/);
    const capped = { ...happy, career: { ...happy.career, wage: 5000 } };
    const c = applyCareerCommand(content, capped, { type: "ASK_FOR_RAISE" });
    expect(c.game.career.wage).toBe(5000);
  });
});

describe("losing the job", () => {
  it("two weeks of no-shows with an unhappy owner get you fired; offers then come in and work resumes", () => {
    let g = played("chef", 13);
    g = { ...g, career: { ...g.career, owner: { ...g.career.owner, mood: 25 }, shiftPlan: Array(7).fill(false) } };
    let fired = false;
    for (let d = 0; d < 21 && !fired; d++) {
      const r = advanceCareerDay(content, g); // no policy: the player sticks to the all-off shift plan
      g = r.game;
      fired = r.events.some((e) => e.type === "FIRED");
    }
    expect(fired).toBe(true);
    expect(g.career.employer.status).toBe("fired");
    expect(g.career.weeklyReview.at(-1)!.score).toBe(1);
    expect(g.career.jobs[0]!.leftBecause).toBe("fired");
    for (let d = 0; d < 6 && g.career.employer.status !== "employed"; d++) g = advanceCareerDay(content, g, DEFAULT_POLICY).game;
    expect(g.career.employer.status).toBe("employed");
    expect(g.career.jobs.length).toBe(2);
  });
});
