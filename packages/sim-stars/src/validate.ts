/**
 * Round 11: the StarsState schema for loaded saves (red-team S3). Applied by the game to `deserializeStars`'s result;
 * see sim-core/validate.ts for the rules. Throws a SchemaError.
 */
import { arr, bool, day, id, int, money, name, num, obj, oneOf, opt, pct100, rngState, text, BIG } from "@full-plate/sim-core/schema";
import { MAX_SATELLITES } from "./constants";
import type { StarsState } from "./types";

const n = num();
const starCount = oneOf(0, 1, 2, 3);
const criteria = obj({ ingredients: n, harmony: n, technique: n, personality: n, consistency: n });
const visit = obj({ day, inspector: name(80), scores: criteria, total: n, revealed: bool });
const review = obj({ day, critic: name(80), rating: oneOf(1, 2, 3, 4, 5), text });
const guideResult = obj({ day, before: starCount, after: starCount, assessed: bool, score: opt(n), visits: n, reason: text });

/** Exported for the game's envelope (meta.pendingGuide carries a GuideResult and its visits). */
export const starsGuideResult = guideResult;
export const starsVisit = visit;

const starsState = obj<StarsState>({
  version: oneOf(1),
  rngState,
  startDay: day,
  lastDay: day,
  guides: obj({
    michelin: obj({
      stars: starCount, inspectorVisits: arr(visit, 500), scheduled: arr(day, 500), nextGuideDay: day, threeStarStreak: n,
      history: arr(guideResult, 1000), excludedUntil: opt(day),
    }),
    fiftyBest: obj({ rank: opt(n), hallOfFame: bool, nextListDay: day, bestRank: opt(n) }),
    gaultMillau: obj({ points: n, nextDay: day }),
    goodFood: obj({ tier: n, nextDay: day }),
    localCritic: obj({ lastReview: opt(review), nextVisit: day, reviews: arr(review, 2000) }),
  }),
  headChef: obj({
    staffId: opt(id), stress: pct100, reputation: pct100, tenureStart: day, wantsOwnPlace: bool,
    decisionDeadline: opt(day), disruptedUntil: opt(day), burnouts: n, former: arr(id, 1000), staysUntil: opt(day),
  }),
  testKitchen: obj({ unlocked: bool, researched: arr(id, 1000), inProgress: opt(obj({ dishId: id, daysLeft: n })) }),
  sourcing: arr(obj({ supplierId: id, name: name(80), ingredientIds: arr(id, 1000), relationship: n, seasonalBonus: n, signedDay: day }), 200),
  satellites: arr(obj({
    id, kind: oneOf("bar", "bistro", "ticketed", "backed"), name: name(40), openedDay: day, headChefTrained: bool,
    trainingDaysLeft: opt(n), staffAbsorbed: n, earned: money,
  }), MAX_SATELLITES * 4),
  ticketing: obj({ unlocked: bool, prepaid: bool, dynamicPricing: bool }),
  stagiaires: obj({ paid: bool, count: num(0, 1000), scandals: n, sinceDay: day }),
  consistencyWindow: arr(n, 5000),
  consistencyDays: opt(arr(n, 5000)),
  assessment: obj({ windowStart: day, openDays: n, criteriaSum: criteria, qN: n, qSum: n, qSumSq: n, qOff: n }),
  hints: arr(obj({ day, text }), 5000),
  dailyScoreEma: n,
  lastCriteria: opt(criteria),
  refitUntil: opt(day),
  relaunchUntil: opt(day),
  loyaltyUntil: opt(day),
  rival: opt(obj({ name: name(80), formerStaffId: opt(id), openedDay: day, strength: n, stars: starCount })),
  afterglow: opt(obj({ mult: num(0, 1000), day })),
  peakStars: starCount,
  ending: opt(obj({ kind: oneOf("dynasty", "el_bulli", "handed_back"), day, win: bool, text })),
  ledger: obj({
    pendingCash: money, pendingPrestige: n, pendingPopularity: n,
    pendingFootfall: arr(obj({ mult: num(0, 1000), days: n }), 1000),
    persistentMult: num(0, 1000), pushedMult: opt(num(0, 1000)),
  }),
  nextId: int(0, BIG),
}, false);

/** A loaded StarsState, checked and cleaned (throws SchemaError). */
export function validateStarsState(raw: unknown): StarsState {
  return starsState(raw, "stars");
}
