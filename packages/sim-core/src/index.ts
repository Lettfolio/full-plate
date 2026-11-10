/** @full-plate/sim-core public API. Pure functions over (content, state). */
import { dispatch } from "./commands";
import { tickService } from "./engine";
import { candidates as candidatePool } from "./staff";
import { classifyMenu as classify } from "./menu";
import { newGame as createGame } from "./newGame";
import { deserialize as load, serialize as save } from "./save";
import { expectedCovers as forecastCovers, ingredientNeeds, suggestedOrder as forecastOrder } from "./forecast";
import type { Candidate, Command, ContentPack, DishId, GameState, IngredientId, MenuQuadrant, SimEvent, StepResult } from "./types";
import { SERVICE_TICKS } from "./types";

export function newGame(content: ContentPack, cmd: Extract<Command, { type: "NEW_GAME" }>): GameState {
  return createGame(content, cmd);
}

/** Applies a player command. Invalid commands leave state unchanged and emit a LOG "bad" event. */
export function applyCommand(content: ContentPack, state: GameState, cmd: Command): StepResult {
  return dispatch(content, state, cmd);
}

/** Advances one service tick (no-op outside service). The final tick closes service and runs the evening. */
export function tick(content: ContentPack, state: GameState): StepResult {
  return tickService(content, state);
}

/** Convenience: START_SERVICE (if in planning) → all ticks → evening/event/gameover. */
export function runDay(content: ContentPack, state: GameState): StepResult {
  const events: SimEvent[] = [];
  let cur = state;
  if (cur.phase === "planning") {
    const r = dispatch(content, cur, { type: "START_SERVICE" });
    cur = r.state;
    events.push(...r.events);
  }
  for (let i = 0; i <= SERVICE_TICKS && cur.phase === "service"; i++) {
    const r = tickService(content, cur);
    cur = r.state;
    for (const e of r.events) events.push(e);
  }
  return { state: cur, events };
}

export function candidates(content: ContentPack, state: GameState): Candidate[] {
  return candidatePool(content, state);
}

export function classifyMenu(content: ContentPack, state: GameState): Record<DishId, MenuQuadrant> {
  return classify(content, state);
}

/**
 * Suggested ORDER_STOCK lines (portions, rounded up to 5s) so on hand + already ordered covers the next
 * service's forecast. Call it in the evening (deliveries arrive next morning) or in planning.
 */
export function suggestedOrder(content: ContentPack, state: GameState): { ingredientId: IngredientId; qty: number }[] {
  return forecastOrder(content, state);
}

/**
 * Portions of each ingredient the next service's forecast needs (rounded up), in content order: the per-ingredient
 * figure behind suggestedOrder (order = need − on hand − already ordered, rounded up to 5s). Ingredients the active
 * menu doesn't use are absent.
 */
export function forecastNeeds(content: ContentPack, state: GameState): { ingredientId: IngredientId; need: number }[] {
  return [...ingredientNeeds(content, state, forecastCovers(content, state))].map(([ingredientId, need]) => ({ ingredientId, need: Math.ceil(need) }));
}

/** Guests the forecast plans for at the next service (what suggestedOrder is built on). */
export function expectedCovers(content: ContentPack, state: GameState): number {
  return forecastCovers(content, state);
}

export function serialize(state: GameState): string {
  return save(state);
}

export function deserialize(json: string): GameState {
  return load(json);
}

export * from "./types";

// ── round 3 ──
/** Seeded RNG (xoshiro128**) and seed mixing — the same generator the sim uses. */
export { Rng, hashSeed, seedState, type RngState } from "./rng";
/**
 * Scripted owner strategies (browser-safe; the headless CLI lives in headless.ts):
 * `strategies.runStrategyDay(content, state, strategies.STRATEGIES.typical)` plays one day.
 */
export * as strategies from "./strategies";
export { runStrategyDay, STRATEGIES, type Strategy, type StrategyName } from "./strategies";
/** [round 5 review] The evening's "trim the rota" tip: a doubled-up rota kept through a losing fortnight. */
export { rotaAdvice, meanProfit, ROTA_ADVICE_DAYS, type RotaAdvice } from "./advice";
/** [round 6] The evening's one tip (rota, over-stock, dud dish, idle chef, under-pricing) and its words. */
export {
  ADVICE_KINDS, ADVICE_RULES, ADVICE_TEXT, actionWords, adviceRulesOf, adviceSentences, adviceTextOf, allAdvice, eveningAdvice, fillAdvice, onCooldown,
  overOrdered, penceText, poundsText, recordAdvice, weekdayList, type Advice,
} from "./advice";
/** Replace (or remove, with null) the footfall mod tagged `source`, leaving other mods alone. */
export { setFootfallMod } from "./engine";
/** Recruitment fee in effect for this game (GameState.recruitmentFee or RECRUITMENT_FEE). */
export { recruitmentFeeOf } from "./commands";
/** Incident/goal text in effect for a content pack (ContentPack.incidentText/goalText merged over the built-in text). */
export { goalLadderOf, goalLinesOf, incidentLinesOf, incidentTextOf } from "./contentText";

/**
 * Calendar and price constants the UI needs to show before the player acts.
 * (Re-exported from constants.ts; values stay owned by sim-core.)
 */
export {
  CLOSED_DAY_WAGE_SHARE,
  HANDS_ON,
  PLAYER_COOK_ID,
  SET_MENU_BUDGET_MULT,
  SET_MENU_MAX_DISHES,
  SET_MENU_SEGMENTS,
  COURSE_ORDER_CHANCE,
  DAYS_PER_MONTH,
  EMPLOYER_ONCOST,
  HIRE_CASH_BUFFER_SHIFTS,
  MAX_MENU_ITEMS,
  MONTHS_PER_YEAR,
  BREAK_TICKS,
  OPENING_STOCK_BUDGET,
  OWNER,
  OWNER_FATIGUE_WARNING,
  RECRUITMENT_FEE,
  TRAINING_FEE,
  TRAINING_SKILL_GAIN,
  SHIFT_HOURS,
  START_MONTH,
  START_WEEKDAY,
  TABLE_COST,
  WEEKEND_DAYS,
} from "./constants";
/** Calendar helpers: month 1-12, weekday 0 = Monday (rota index), weekend footfall days. */
export { isWeekend, monthOf, weekdayOf } from "./util";
/**
 * [round 5] The hands-on station in sim time (systems/station.ts): `stationRailTickets` is the human's rail as the sim
 * reserves it (the view draws the same rule); `ticketsToCover` what the sim's sous chef plates this tick.
 */
export { humanTickets as stationRailTickets, ticketsToCover, aiTicks, isCoursed } from "./systems/station";
/** [round 6 review] The cook id of a hands-on commis's AI hands is `<staffId>${SHADOW_COOK_SUFFIX}` (kitchen.ts cooksOnShift). */
export { SHADOW_COOK_SUFFIX } from "./systems/kitchen";
/** [round 10] Staff with personality: portraits, likes/dislikes, relationships, training tracks (personality.ts). */
export {
  avatarFor, playerAvatar, PLAYER_LOOKS, AVATAR_COLOURS, AVATAR_SKINS, AVATAR_HAIRS, HAIR_STYLES,
  personalityOf, likeLabel, dislikeLabel, quoteFor, LIKE_LABELS, DISLIKE_LABELS, LIKE_IDS, DISLIKE_IDS,
  relationBetween, relationsOf, personalityFactors, personalityMood, mainReason, PERSONALITY_MOOD,
  TRAINING_TRACKS, TRACK_MAX_LEVEL, trackById, tracksFor, trackLevel, nextTrackFee, PASS_COVER_HIT_PER_LEVEL,
  type AvatarSpec, type HairStyle, type FaceShape, type AvatarHat, type LikeId, type DislikeId, type Personality,
  type Relation, type MoodFactor, type PersonalityDay, type TrackDef, type PersonKey,
} from "./personality";
export { STATION_COURSES } from "./constants";
/** Cost of one rostered shift for a staff member (wage × SHIFT_HOURS × (1 + EMPLOYER_ONCOST)). */
export { shiftCost } from "./systems/finance";
/** Opening stock allowance in effect for a content pack (BalanceDef.openingStockBudget or the default). */
export { openingStockBudget } from "./forecast";
/**
 * [round 3, Empire] Closed-form demand and capacity from the sim's physics (sim-empire's aggregate model fits to these).
 * `marketDemand`/`expectedDemand`: unconstrained covers; `capacityCovers`/`serviceCapacity`: seats × turns vs crew;
 * `softCap`/`uncapped`: covers served from demand and back.
 */
export {
  CAPACITY, capacityCovers, crewOnShift, expectedDemand, marketDemand, menuPriceIndex, serviceCapacity, softCap, uncapped,
  type CapacitySpec, type DemandEstimate, type DemandSpec,
} from "./capacity";
/**
 * [round 10] Decorating (decor.ts): what each slot holds and how worn it is, the room's capped effects and style, the
 * catalogue per slot, and the tables the fitters close tonight.
 */
export {
  closedTableIds, decorCatalogue, decorEffects, decorStyle, decorStyleName, findDecorItem, fittingTablesClosed, installed as installedDecor,
  NO_DECOR_EFFECTS, starterItem as starterDecor, wearOf as decorWear, wearShare as decorWearShare, type DecorEffects, type DecorWear,
} from "./decor";
export { DECOR_CAPS, DECOR_SLOTS, DECOR_WORN_SHARE } from "./constants";
/**
 * [round 11] Stop silent losing (bank.ts): the bank's countdown, a day's running costs and the "are you sure?" check
 * for big purchases, the one HIRE cash rule (Cosy may dip into the stock overdraft), and the once-only starter loan.
 */
export {
  bankStatus, runningCostPerDay, spendCheck, hireNeed, starterLoanOffer,
  SPEND_SAFETY_DAYS, STOCK_DAY_GUESS, STARTER_LOAN, STARTER_LOAN_MAX, BANK_LAST_DAYS, BANK_RED_DAYS,
  type BankStatus, type SpendCheck, type HireNeed,
} from "./bank";
export { INSOLVENCY_DAYS, MAX_PRICE, STOCK_OVERDRAFT_LIMIT } from "./constants";
/** [round 11] Review words that match the night: `roughNight` (walk-outs > guests, or < 2.5★) picks the "rough" pool. */
export { reviewText, roughNight, ROUGH_NIGHT_RATING } from "./systems/reputation";
