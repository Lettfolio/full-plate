/** Creating, saving, loading and (safely) viewing a StarsState. */
import type { ContentPack, GameState, Staff, StaffId } from "@full-plate/sim-core";
import {
  CRITIC_INTERVAL,
  DAILY_SCORE_START,
  FIFTY_BEST_MONTH,
  GAULT_MILLAU_MONTH,
  GOOD_FOOD_MONTH,
  NEW_HEAD_CHEF_REPUTATION,
  SETTLE_IN_DAYS,
  STARS_SALT,
  STRESS_BASE,
} from "./constants";
import { cosyHint, emptyAssessment, firstGuideDay, inSeason, nextMonthStart, scheduleVisits } from "./inspector";
import { weakNights, windowConsistency, type WeakNight } from "./proxies";
import { Rng, hashSeed } from "./rng";
import { STARS_VERSION, type InspectorVisit, type StarsState } from "./types";

/** The head chef is the most skilled chef not in `exclude`. */
export function pickHeadChef(staff: readonly Staff[], exclude: readonly StaffId[] = []): Staff | undefined {
  return staff
    .filter((s) => s.role === "chef" && !exclude.includes(s.id))
    .sort((a, b) => b.skill - a.skill || (a.id < b.id ? -1 : 1))[0];
}

/** Starting reputation for a new head chef: their skill counts for something, the guide doesn't know them yet. */
export function startingReputation(chef: Staff | undefined): number {
  return chef ? Math.round(Math.max(NEW_HEAD_CHEF_REPUTATION, chef.skill * 0.6)) : 0;
}

/**
 * Starts the Stars path on the GameState's current day (the game calls this at the fork, ~year 2-3).
 * The Stars RNG is seeded from the game seed and start day, so the same save always meets the same inspectors.
 */
export function newStarsState(_content: ContentPack, state: GameState, opts: { seed?: number } = {}): StarsState {
  const startDay = state.day;
  const rng = Rng.fromSeed(opts.seed ?? hashSeed(state.seed, STARS_SALT, startDay));
  const guideDay = firstGuideDay(startDay);
  const scheduled = scheduleVisits(rng, startDay + SETTLE_IN_DAYS, guideDay);
  const chef = pickHeadChef(state.staff);
  const criticDay = startDay + rng.int(CRITIC_INTERVAL[0], CRITIC_INTERVAL[1]);
  return {
    version: STARS_VERSION,
    rngState: rng.getState(),
    startDay,
    lastDay: startDay - 1,
    guides: {
      michelin: { stars: 0, inspectorVisits: [], scheduled, nextGuideDay: guideDay, threeStarStreak: 0, history: [] },
      fiftyBest: { hallOfFame: false, nextListDay: nextMonthStart(startDay + 1, FIFTY_BEST_MONTH) },
      gaultMillau: { points: 0, nextDay: nextMonthStart(startDay + 1, GAULT_MILLAU_MONTH) },
      goodFood: { tier: 0, nextDay: nextMonthStart(startDay + 1, GOOD_FOOD_MONTH) },
      localCritic: { nextVisit: criticDay, reviews: [] },
    },
    headChef: {
      ...(chef ? { staffId: chef.id } : {}),
      stress: STRESS_BASE,
      reputation: startingReputation(chef),
      tenureStart: startDay,
      wantsOwnPlace: false,
      burnouts: 0,
      former: [],
    },
    testKitchen: { unlocked: false, researched: [] },
    sourcing: [],
    satellites: [],
    ticketing: { unlocked: false, prepaid: false, dynamicPricing: false },
    stagiaires: { paid: true, count: 0, scandals: 0, sinceDay: startDay },
    consistencyWindow: [],
    consistencyDays: [],
    assessment: emptyAssessment(startDay),
    hints: [],
    dailyScoreEma: DAILY_SCORE_START,
    ledger: { pendingCash: 0, pendingPrestige: 0, pendingPopularity: 0, pendingFootfall: [], persistentMult: 1 },
    peakStars: 0,
    nextId: 1,
  };
}

export function serializeStars(stars: StarsState): string {
  return JSON.stringify(stars);
}

export function deserializeStars(json: string): StarsState {
  const raw = JSON.parse(json) as Partial<StarsState> & { version?: number };
  if (raw.version !== STARS_VERSION) throw new Error(`Unsupported StarsState version ${String(raw.version)} (expected ${STARS_VERSION}).`);
  if (!Array.isArray(raw.rngState) || raw.rngState.length !== 4) throw new Error("StarsState is missing its RNG state.");
  return raw as StarsState;
}

/**
 * What the UI may show. Strips everything the inspectors keep secret: this year's visits (count, days, scores),
 * the schedule, the assessment accumulators and the daily criteria. `steadiness` is the player's own kitchen data
 * (the rolling 60-day quality window turned into 0-100) and is fine to show. `hint` is only for Cosy difficulty.
 */
export interface StarsView {
  stars: StarsState["guides"]["michelin"]["stars"];
  peakStars: StarsState["peakStars"];
  threeStarStreak: number;
  nextGuideDay: number;
  daysToGuide: number;
  inspectionSeason: boolean;
  /** Past years' visits only (revealed on guide day). */
  pastVisits: InspectorVisit[];
  guideHistory: StarsState["guides"]["michelin"]["history"];
  excludedUntil?: number;
  fiftyBest: StarsState["guides"]["fiftyBest"];
  gaultMillau: number;
  goodFood: number;
  critic: StarsState["guides"]["localCritic"];
  headChef: Omit<StarsState["headChef"], "former">;
  steadiness: number;
  /**
   * Weekdays whose nights cook clearly worse than the rest of the window (the player's own data, so fine to show):
   * usually the chef's days off. Empty when the kitchen is steady or the window is short.
   */
  weakNights: WeakNight[];
  testKitchen: StarsState["testKitchen"];
  sourcing: StarsState["sourcing"];
  satellites: StarsState["satellites"];
  ticketing: StarsState["ticketing"];
  stagiaires: StarsState["stagiaires"];
  refitUntil?: number;
  rival?: StarsState["rival"];
  ending?: StarsState["ending"];
  /** "Someone was taking notes" moments — real visits and decoys alike. */
  rumours: StarsState["hints"];
  /** Cosy-mode only: a fuzzy one-liner from inspectorModel. */
  cosyHint: string;
}

export function starsView(stars: StarsState, day: number): StarsView {
  const m = stars.guides.michelin;
  const { former: _f, ...headChef } = stars.headChef;
  return {
    stars: m.stars,
    peakStars: stars.peakStars,
    threeStarStreak: m.threeStarStreak,
    nextGuideDay: m.nextGuideDay,
    daysToGuide: Math.max(0, m.nextGuideDay - day),
    inspectionSeason: inSeason(stars, day),
    pastVisits: m.inspectorVisits.filter((v) => v.revealed),
    guideHistory: m.history,
    ...(m.excludedUntil !== undefined ? { excludedUntil: m.excludedUntil } : {}),
    fiftyBest: stars.guides.fiftyBest,
    gaultMillau: stars.guides.gaultMillau.points,
    goodFood: stars.guides.goodFood.tier,
    critic: stars.guides.localCritic,
    headChef,
    steadiness: windowConsistency(stars.consistencyWindow),
    weakNights: weakNights(stars.consistencyWindow, stars.consistencyDays),
    testKitchen: stars.testKitchen,
    sourcing: stars.sourcing,
    satellites: stars.satellites,
    ticketing: stars.ticketing,
    stagiaires: stars.stagiaires,
    ...(stars.refitUntil !== undefined && stars.refitUntil > day ? { refitUntil: stars.refitUntil } : {}),
    ...(stars.rival ? { rival: stars.rival } : {}),
    ...(stars.ending ? { ending: stars.ending } : {}),
    rumours: stars.hints,
    cosyHint: cosyHint(stars),
  };
}
