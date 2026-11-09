import { describe, expect, it } from "vitest";
import { generateReview, reviewScore, type CareerState, type WeekTally } from "../src/index";
import { emptyWeek } from "../src/career";
import { fakeResult, played } from "./helpers";

function week(over: Partial<WeekTally>, days = 5, rating = 4.4, walkouts = 0): WeekTally {
  const results = Array.from({ length: 7 }, (_, i) => fakeResult(100 + i, { averageRating: rating, walkouts }));
  return { ...emptyWeek(0, 30), results, workedSimDays: results.slice(0, days).map((r) => r.day), workedDays: [0, 1, 2, 3, 4].slice(0, days), contractShifts: Math.min(4, days), ...over };
}
const ctx = { reviewer: "Pat", reviewerRole: "owner" as const, statNow: 31, management: false };

describe("weekly review", () => {
  const career: CareerState = played("chef", 0).career;

  it("is deterministic for the same career day and week", () => {
    const w = week({});
    expect(generateReview(career, w, ctx)).toEqual(generateReview(career, w, ctx));
  });

  it("better ratings on your shifts score higher", () => {
    const good = generateReview(career, week({}, 5, 4.8), ctx);
    const bad = generateReview(career, week({}, 5, 3.6), ctx);
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.breakdown.rating).toBe(5);
  });

  it("declining contract shifts lowers reliability and the score, and says so", () => {
    const steady = generateReview(career, week({ contractShifts: 4, contractDeclined: 0 }), ctx);
    const flaky = generateReview(career, week({ contractShifts: 1, contractDeclined: 3 }, 2), ctx);
    expect(flaky.breakdown.reliability).toBeLessThan(steady.breakdown.reliability);
    expect(flaky.score).toBeLessThan(steady.score);
    expect(flaky.notes.join(" ")).toMatch(/rota|shift/i);
  });

  it("skill growth shows in the growth component and the notes", () => {
    const grew = generateReview(career, week({ statStart: 30 }), { ...ctx, statNow: 31.2 });
    const flat = generateReview(career, week({ statStart: 30 }), { ...ctx, statNow: 30 });
    expect(grew.breakdown.growth).toBeGreaterThan(flat.breakdown.growth);
    expect(grew.notes.some((n) => n.includes("up 1.2"))).toBe(true);
  });

  it("incidents handled help; ignored ones hurt", () => {
    const handled = generateReview(career, week({ incidentsHandled: 3 }), ctx);
    const ignored = generateReview(career, week({ incidentsIgnored: 3 }), ctx);
    expect(handled.breakdown.incidents).toBeGreaterThan(0);
    expect(ignored.breakdown.incidents).toBeLessThan(0);
    expect(handled.score).toBeGreaterThan(ignored.score);
  });

  it("notices fatigue from the staff record", () => {
    const tired = generateReview({ ...career, fatigue: 80 }, week({}), ctx);
    expect(tired.notes.join(" ")).toMatch(/shattered/);
  });

  it("walk-outs lower the business score for staff; profit drives it for managers", () => {
    const smooth = generateReview(career, week({}, 5, 4.4, 0), ctx).breakdown.business;
    const rough = generateReview(career, week({}, 5, 4.4, 15), ctx).breakdown.business;
    expect(rough).toBeLessThan(smooth);
    const m = { ...ctx, management: true };
    expect(generateReview(career, week({ profit: 400_000 }), m).breakdown.business).toBeGreaterThan(generateReview(career, week({ profit: -300_000 }), m).breakdown.business);
  });

  it("owner personality weights the components differently", () => {
    const b = { rating: 5, reliability: 2, growth: 3, business: 3, incidents: 0 };
    const premium = reviewScore({ ...career, owner: { ...career.owner, strategy: "premium" } }, b);
    const cheap = reviewScore({ ...career, owner: { ...career.owner, strategy: "cheap" } }, b);
    expect(premium).toBeGreaterThan(cheap);
  });

  it("a played month produces weekly reviews from real DayResults with reviewer and tronc lines", () => {
    const g = played("waiter", 28);
    expect(g.career.weeklyReview).toHaveLength(4);
    for (const r of g.career.weeklyReview) {
      expect(r.score).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeLessThanOrEqual(5);
      expect(r.shifts).toBeGreaterThan(0);
      expect(r.notes.length).toBeGreaterThan(0);
    }
    expect(g.career.weeklyReview.some((r) => r.tips > 0)).toBe(true);
    expect(g.career.payslips).toHaveLength(4);
  });
});

describe("hands-on shifts in the weekly review (round 3 review)", () => {
  it("tallies a played shift's stars and quality and turns them into a small bonus and a note", async () => {
    const { newCareer, stepCareerDay, beginCareerDay, finishCareerDay } = await import("../src");
    const { runService } = await import("../src/owner");
    const { handsOnBonus } = await import("../src/review");
    const { content } = await import("./helpers");
    const play = (score?: { stars: 0 | 1 | 2 | 3; points: number; meanQuality: number }) => {
      let g = newCareer(content, { seed: 3, track: "chef" });
      let review: { score: number; notes: string[] } | undefined;
      for (let d = 0; d < 7; d++) {
        const b = beginCareerDay(content, g);
        const served = runService(content, b.game.career.owner.strategy, b.game.state);
        const worked = b.playerWorks;
        const r = stepCareerDay(content, b.game.career, served, served.history.at(-1)!, worked ? score : undefined);
        for (const e of r.events) if (e.type === "REVIEW") review = e.review;
        g = finishCareerDay(content, { career: r.career, state: served }, r.nextOwnerCommands);
      }
      return review!;
    };
    const plain = play();
    const great = play({ stars: 3, points: 1400, meanQuality: 88 });
    const poor = play({ stars: 0, points: 90, meanQuality: 41 });
    expect(great.score).toBeGreaterThan(plain.score);
    expect(poor.score).toBeLessThanOrEqual(plain.score);
    expect(great.notes.join(" ")).toMatch(/averaged 88/);
    expect(plain.notes.join(" ")).not.toMatch(/averaged/);
    expect(handsOnBonus({ handsOn: { shifts: 2, stars: 6, quality: 170 } } as never)).toBe(0.3);
    expect(handsOnBonus({} as never)).toBe(0);
  });
});
