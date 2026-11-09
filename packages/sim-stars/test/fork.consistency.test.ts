/**
 * Round 3 review, blocker 1: "Stars consistency ≈ 0" in a year-2 save.
 *
 * Cause: a typical year-1 owner has one strong chef on Wed–Sun and a weak cover chef (or the owner) on Mon/Tue. Those
 * two nights cook ~40 against ~85 the rest of the week. The window was fine (it is only open days, it starts empty at
 * the fork and closed days are skipped) but the formula scored that weekly pattern — sd ≈ 25, 28% off nights — at
 * exactly 0, the same as a random kitchen, so no amount of quality on the other five nights could earn a star.
 * Fixes: softer weights (a two-speed week is ≈ 30, still bad), the window remembers its days so the UI can say
 * "your Monday and Tuesday nights cook 45 points worse", and closing those nights (CLOSE_TODAY) keeps the window clean.
 */
import { describe, expect, it } from "vitest";
import { weekdayOf } from "@full-plate/sim-core";
import { closedDay, starsView, stepStarsDay, STARS_CONSTANTS as C, windowConsistency } from "../src";
import { weakNights } from "../src/proxies";
import { content, dayResult, eveningState, fresh, run } from "./helpers";

/** The exact window from the integration agent's year-2 test save (days 601–660). */
const YEAR2_WINDOW = "27 85 85 86 86 84 34 24 86 85 87 85 85 37 21 85 86 84 85 85 37 24 85 86 85 86 85 37 23 85 85 86 85 84 36 19 85 86 86 86 85 38 25 86 86 85 86 87 38 24 85 87 85 86 85 34 24 85 84 85"
  .split(" ").map(Number);

/** Strong kitchen Wed–Sun, weak cover nights Mon/Tue. */
const twoSpeed = (d: number) => (weekdayOf(d) <= 1 ? 38 : 86);

describe("consistency after the fork (regression)", () => {
  it("a two-speed week is poor but not zero; a steady kitchen still scores in the 90s", () => {
    const c = windowConsistency(YEAR2_WINDOW);
    expect(c).toBeGreaterThan(20);
    expect(c).toBeLessThan(45);
    expect(windowConsistency(Array.from({ length: 60 }, (_, i) => 86 + (i % 3) - 1))).toBeGreaterThan(95);
    expect(windowConsistency(YEAR2_WINDOW.map((q) => (q < 60 ? 74 : q)))).toBeGreaterThan(65); // a decent cover chef
  });

  it("the window starts empty at the fork and only takes open nights", () => {
    const s0 = fresh(365);
    expect(s0.consistencyWindow).toEqual([]);
    const r = run(s0, 365, 70, (d) => (weekdayOf(d) <= 1 ? undefined : 86));
    expect(r.stars.consistencyWindow.length).toBe(50);
    expect(r.stars.consistencyWindow.every((q) => q === 86)).toBe(true);
    expect(r.stars.consistencyDays?.every((d) => weekdayOf(d) > 1)).toBe(true);
    expect(starsView(r.stars, 435).steadiness).toBeGreaterThan(95);
  });

  it("a closed DayResult (CLOSE_TODAY) never enters the window", () => {
    const s0 = fresh(365);
    const shut = { ...closedDay(370), closed: true, rent: 5000 };
    const r = stepStarsDay(content, s0, shut, eveningState(370, 0, {}));
    expect(r.stars.consistencyWindow).toEqual([]);
    expect(r.stars.assessment.openDays).toBe(0);
    // …and a real open night after it does.
    const r2 = stepStarsDay(content, r.stars, dayResult(371), eveningState(371, 88));
    expect(r2.stars.consistencyWindow).toEqual([88]);
  });

  it("names the weekdays that drag steadiness down", () => {
    const r = run(fresh(365), 365, 60, twoSpeed);
    const weak = starsView(r.stars, 425).weakNights;
    expect(weak.map((w) => w.weekday)).toEqual([0, 1]);
    expect(weak[0]!.others - weak[0]!.mean).toBeGreaterThan(40);
    expect(weakNights([80, 81], [0, 1])).toEqual([]);
  });

  it("a quality kitchen that closes (or covers) its weak nights reaches the first star on the first guide day", () => {
    let s = fresh(365);
    const g1 = s.guides.michelin.nextGuideDay;
    // Closes Mon/Tue, cooks 90 the rest of the week (the headless --fork-day run does this through sim-core).
    const r = run(s, 365, g1 - 365 + 1, (d) => (weekdayOf(d) <= 1 ? undefined : 90), { duck_breast: 20, lamb_shoulder: 15, scallops_pea: 10 });
    s = r.stars;
    const guide = r.events.find((e) => e.type === "GUIDE_DAY");
    expect(guide && guide.type === "GUIDE_DAY" && guide.result.assessed).toBe(true);
    expect(s.guides.michelin.stars).toBeGreaterThanOrEqual(1);
    // The same kitchen with two weak nights a week stays out of the guide.
    const weak = run(fresh(365), 365, g1 - 365 + 1, twoSpeed, { duck_breast: 20, lamb_shoulder: 15, scallops_pea: 10 });
    expect(weak.stars.guides.michelin.stars).toBe(0);
    expect(C.CONSISTENCY_SD_WEIGHT).toBe(2);
  });
});
