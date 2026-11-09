import { content } from "@full-plate/content";
import type { DayResult, Staff } from "@full-plate/sim-core";
import { advanceCareerDay, DEFAULT_POLICY, newCareer, type AutoPolicy, type CareerGame, type CareerTrack, type OwnerStrategy, type WeeklyReview } from "../src/index";

export { content };

const cache = new Map<string, CareerGame>();

/** A career fast-forwarded `days` with a policy (memoised per test file; games are immutable). */
export function played(track: CareerTrack, days: number, seed = 1, strategy: OwnerStrategy = "balanced", policy: AutoPolicy = DEFAULT_POLICY): CareerGame {
  const key = `${track}:${days}:${seed}:${strategy}:${JSON.stringify(policy)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let g = newCareer(content, { seed, track, strategy, playerName: "Alex Taylor" });
  for (let d = 0; d < days; d++) g = advanceCareerDay(content, g, policy).game;
  cache.set(key, g);
  return g;
}

export function fakeReview(score: number, day = 0): WeeklyReview {
  return {
    day, week: 1, score, reviewer: "Owner", reviewerRole: "owner", notes: [],
    breakdown: { rating: score, reliability: score, growth: score, business: score, incidents: 0 },
    shifts: 5, contractShifts: 4, statGain: 0, tips: 0, mood: 60, fatigue: 20, incidentsHandled: 0,
  };
}

export function fakeResult(day: number, over: Partial<DayResult> = {}): DayResult {
  return {
    day, covers: 60, walkouts: 0, revenue: 120_000, tips: 6_000, foodCost: 30_000, labourCost: 30_000, rent: 9_000, loanPayment: 0,
    waste: { prep: 0, plate: 0, spoil: 0 }, profit: 20_000, averageSpend: 2_000, averageRating: 4.4, popularityDelta: 0, prestigeDelta: 0,
    reviews: [], staffMoodDelta: {}, ...over,
  };
}

export function fakeStaff(id: string, over: Partial<Staff> = {}): Staff {
  return { id, name: id, role: "chef", skill: 50, speed: 50, charm: 50, wage: 1400, mood: 60, fatigue: 0, traits: [], hiredDay: 0, potential: 80, rota: [true, true, true, true, true, true, true], ...over };
}
