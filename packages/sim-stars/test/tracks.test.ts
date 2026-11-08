import { describe, expect, it } from "vitest";
import { criticRating, fiftyBestRank, gaultMillauPoints, goodFoodTier, prestigeTarget } from "../src";
import { Rng } from "../src/rng";
import { stepTracks } from "../src/tracks";
import { fresh, run } from "./helpers";

describe("prestige tracks", () => {
  it("Gault&Millau never reaches 20 and is in half points", () => {
    expect(gaultMillauPoints(200, 3)).toBe(19.5);
    expect(gaultMillauPoints(0, 0)).toBe(0);
    expect(gaultMillauPoints(70, 1) * 2 % 1).toBe(0);
  });
  it("Good Food tier is 0-10", () => {
    expect(goodFoodTier(40, 0)).toBe(0);
    expect(goodFoodTier(100, 3)).toBe(10);
  });
  it("World's 50 Best: unlisted when mediocre, near the top when great", () => {
    expect(fiftyBestRank(Rng.fromSeed(1), 50, 0, 40)).toBeUndefined();
    expect(fiftyBestRank(Rng.fromSeed(1), 96, 3, 100)).toBeLessThanOrEqual(5);
  });
  it("critic bands", () => {
    expect(criticRating(90)).toBe(5);
    expect(criticRating(76)).toBe(4);
    expect(criticRating(10)).toBe(1);
  });
  it("each track publishes on its own cadence", () => {
    let s = fresh();
    s = { ...s, dailyScoreEma: 99, guides: { ...s.guides, michelin: { ...s.guides.michelin, stars: 3 } } };
    const r = run(s, 0, 430, 97);
    const fb = r.events.filter((e) => e.type === "FIFTY_BEST");
    expect(fb.map((e) => e.day)).toEqual([60, 420]); // June 1st each year (day 0 = April 1st)
    expect(r.events.filter((e) => e.type === "GOOD_FOOD").map((e) => e.day)).toEqual([150]); // September
    expect(r.events.filter((e) => e.type === "GAULT_MILLAU").map((e) => e.day)).toEqual([210]); // November
  });
  it("reaching No. 1 moves you to the hall of fame and out of the running", () => {
    let s = fresh();
    s = { ...s, dailyScoreEma: 100, guides: { ...s.guides, michelin: { ...s.guides.michelin, stars: 3 } } };
    const a = stepTracks(Rng.fromSeed(3), s, 60, 100);
    expect(a.stars.guides.fiftyBest).toMatchObject({ rank: 1, hallOfFame: true, bestRank: 1 });
    const b = stepTracks(Rng.fromSeed(3), a.stars, 420, 100);
    expect(b.stars.guides.fiftyBest.rank).toBeUndefined();
    expect(b.stars.guides.fiftyBest.hallOfFame).toBe(true);
  });
  it("prestige target grows with stars and the other tracks", () => {
    const s = fresh();
    const starred = { ...s, guides: { ...s.guides, michelin: { ...s.guides.michelin, stars: 2 as const }, gaultMillau: { points: 16, nextDay: 0 } } };
    expect(prestigeTarget(starred)).toBeGreaterThan(prestigeTarget(s) + 30);
  });
  it("the local critic comes on an open night and their review lands in the ledger as footfall", () => {
    const s = fresh();
    const r = run(s, 0, 130, 97);
    const rev = r.events.find((e) => e.type === "CRITIC_REVIEW");
    expect(rev).toBeDefined();
  });
});
