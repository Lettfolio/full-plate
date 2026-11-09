/**
 * Proxies — how one sim-core day becomes the five Michelin criteria.
 *
 * sim-core does not (yet) expose per-plate freshness, per-plate chef or plate-level dish identity in DayResult,
 * so each criterion is a documented proxy built from what *is* available. Prefer the evening `GameState.service`
 * tally (present between closeService and END_DAY); fall back to DayResult + menu stats when it is absent.
 *
 *  harmony      = ½ · plate-weighted mean food quality + ½ · mean of per-dish mean quality (the inspector
 *                 "tastes the menu": one weak dish drags it even if few people order it).
 *  technique    = ½ · harmony + ½ · min(100, 1.35 · plate-weighted skillRequired of food sold)
 *                 (ambition × execution: a perfect jacket potato is not three-star technique).
 *  personality  = 0.45 · harmony + 40 · signatureShare + 0.25 · headChef.reputation (+10 while relaunched,
 *                 +5 while an alumnus you backed is flying your flag), where signatureShare = share of food
 *                 plates that are test-kitchen signatures.
 *  ingredients  = 0.55 · harmony + 5 + 25 · seasonShare + 20 · partnerShare + 100 · Σ(partner seasonalBonus
 *                 [0.02-0.10, grows with relationship] × in-season share) + 5 if prepaid ticketing (cash up front buys the best produce).
 *                 Shares are over portions of *fresh produce* (ingredients any partner supplier could sell),
 *                 weighted by plates sold; partnerShare is weighted by relationship/100.
 *  consistency  = windowConsistency(last 60 open days' mean quality) − 6 per satellite without a trained head
 *                 chef − 15 while disrupted (burnout / head chef just left) − 0.4 per stress point above 70
 *                 + 1 per stagiaire (max 6).  windowConsistency = 100 − 3·sd − 60·offNightShare
 *                 − 0.6·max(0, 80 − mean), shrunk toward 60 while the window has < 10 days.
 *
 * "Food" means every course except drinks. All outputs are clamped 0-100 and rounded to 2 dp.
 */
import type { ContentPack, DayResult, DishDef, GameState, ServiceTally } from "@full-plate/sim-core";
import { monthOf, weekdayOf } from "@full-plate/sim-core";
import {
  CONSISTENCY_LEVEL_FLOOR,
  CONSISTENCY_LEVEL_WEIGHT,
  CONSISTENCY_MIN_DAYS,
  CONSISTENCY_OFF_WEIGHT,
  CONSISTENCY_PRIOR,
  CONSISTENCY_SD_WEIGHT,
  DISRUPTION_PENALTY,
  GROUP_CAP_PENALTY,
  INGREDIENTS_BASE,
  INGREDIENTS_HARMONY_WEIGHT,
  INGREDIENTS_PARTNER_WEIGHT,
  INGREDIENTS_PREPAID_BONUS,
  INGREDIENTS_SEASON_WEIGHT,
  LOYALTY_PERSONALITY_BONUS,
  OFF_NIGHT_DROP,
  PERSONALITY_HARMONY_WEIGHT,
  PERSONALITY_REPUTATION_WEIGHT,
  PERSONALITY_SIGNATURE_WEIGHT,
  RELAUNCH_PERSONALITY_BONUS,
  SHORT_MENU_EARLY_SHARE,
  STAGIAIRE_CONSISTENCY,
  STAGIAIRE_MAX,
  STRESS_CONSISTENCY_FROM,
  STRESS_CONSISTENCY_WEIGHT,
  SUPPLIERS,
  TECHNIQUE_AMBITION_SCALE,
} from "./constants";
import type { Criteria, StarsState } from "./types";

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => r2(clamp(x, 0, 100));

export interface DishLine {
  dishId: string;
  sold: number;
  plated: number;
  /** Mean plate quality; undefined when quality isn't known for this dish. */
  quality?: number;
}

/** What one day looks like to the Stars layer, before any scoring. */
export interface DayInputs {
  day: number;
  open: boolean;
  covers: number;
  /** Plate-weighted mean food quality (0 when closed). */
  quality: number;
  dishes: DishLine[];
}

const isFood = (d: DishDef | undefined) => !!d && d.course !== "drink";

/**
 * Reads the day's dish lines: the evening service tally when present (exact per-dish plate quality),
 * else the menu's newest `recent` entry for sold counts with the reviews' mean quality as every dish's quality.
 */
export function dayInputs(content: ContentPack, result: DayResult, state?: GameState): DayInputs {
  const open = result.covers > 0;
  if (!open) return { day: result.day, open, covers: 0, quality: 0, dishes: [] };
  const byId = new Map(content.dishes.map((d) => [d.id, d]));
  const tally: ServiceTally | undefined = state?.day === result.day ? state.service : undefined;
  let dishes: DishLine[] = [];
  if (tally) {
    for (const [dishId, t] of Object.entries(tally.dishes)) {
      if (!isFood(byId.get(dishId))) continue;
      dishes.push({ dishId, sold: t.sold, plated: t.plated, ...(t.plated > 0 ? { quality: t.qualitySum / t.plated } : {}) });
    }
  } else {
    const rated = result.reviews.filter((r) => r.quality !== undefined);
    const q = rated.length ? rated.reduce((a, r) => a + (r.quality ?? 0), 0) / rated.length : result.averageRating * 20;
    for (const m of state?.menu ?? []) {
      if (!isFood(byId.get(m.dishId))) continue;
      const sold = m.recent?.at(-1)?.sold ?? 0;
      if (sold > 0) dishes.push({ dishId: m.dishId, sold, plated: sold, quality: q });
    }
  }
  dishes = dishes.sort((a, b) => (a.dishId < b.dishId ? -1 : a.dishId > b.dishId ? 1 : 0));
  const plated = dishes.reduce((a, d) => a + (d.quality !== undefined ? d.plated : 0), 0);
  const quality = plated > 0 ? dishes.reduce((a, d) => a + (d.quality ?? 0) * d.plated, 0) / plated : 0;
  return { day: result.day, open, covers: result.covers, quality: r2(quality), dishes };
}

/**
 * Food dishes that were off tonight's menu for most of the service: on the active menu, on today's 86 list (out of
 * stock at the door, run out, or pulled by hand; from the evening GameState's `eightySixed`, which sim-core clears at
 * END_DAY), and plated fewer than SHORT_MENU_EARLY_SHARE of their usual night (`sold7d` over the `recent` days; any
 * plate at all counts as usual when there is no history). A dish that sells out late on a busy night is not "off".
 * Empty without an evening state for `day`. Content order, so the result is stable.
 */
export function pulledFoodDishes(content: ContentPack, state: GameState | undefined, day: number): string[] {
  if (!state || state.day !== day) return [];
  const pulled = new Set(state.eightySixed ?? []);
  if (!pulled.size) return [];
  const menu = new Map(state.menu.filter((m) => m.active).map((m) => [m.dishId, m]));
  return content.dishes
    .filter((d) => {
      const m = menu.get(d.id);
      if (!isFood(d) || !m || !pulled.has(d.id)) return false;
      const nights = m.recent?.length ?? 0;
      const usual = nights > 0 ? m.sold7d / nights : 0;
      const plated = state.service?.dishes[d.id]?.plated ?? 0;
      return usual > 0 ? plated < SHORT_MENU_EARLY_SHARE * usual : plated === 0;
    })
    .map((d) => d.id);
}

// ── consistency ──
export interface WindowStats { n: number; mean: number; sd: number; offShare: number }

export function windowStats(window: readonly number[]): WindowStats {
  const n = window.length;
  if (n === 0) return { n, mean: 0, sd: 0, offShare: 0 };
  const mean = window.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(window.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  const off = window.filter((q) => q < mean - OFF_NIGHT_DROP).length / n;
  return { n, mean, sd, offShare: off };
}

/** Consistency 0-100 of a series of daily mean qualities (the rolling window, or a whole assessment year). */
export function seriesConsistency(s: WindowStats): number {
  if (s.n === 0) return CONSISTENCY_PRIOR;
  const raw = 100 - CONSISTENCY_SD_WEIGHT * s.sd - CONSISTENCY_OFF_WEIGHT * s.offShare - CONSISTENCY_LEVEL_WEIGHT * Math.max(0, CONSISTENCY_LEVEL_FLOOR - s.mean);
  const w = Math.min(1, s.n / CONSISTENCY_MIN_DAYS);
  return pct(w * raw + (1 - w) * CONSISTENCY_PRIOR);
}

export function windowConsistency(window: readonly number[]): number {
  return seriesConsistency(windowStats(window));
}

export interface WeakNight {
  /** sim-core weekday, 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** Mean quality on that weekday's nights in the window. */
  mean: number;
  /** Mean quality on every other night in the window. */
  others: number;
  nights: number;
}

/**
 * Which weekdays drag the steadiness down: a weekday with ≥ 2 nights in the window whose mean is more than
 * OFF_NIGHT_DROP below the other nights' mean. Sorted Monday first. Needs the window's day numbers.
 */
export function weakNights(window: readonly number[], days: readonly number[] | undefined): WeakNight[] {
  if (!days || days.length !== window.length || window.length < 10) return [];
  const out: WeakNight[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const mine = window.filter((_, i) => weekdayOf(days[i]!) === wd);
    const rest = window.filter((_, i) => weekdayOf(days[i]!) !== wd);
    if (mine.length < 2 || rest.length < 2) continue;
    const mean = mine.reduce((a, b) => a + b, 0) / mine.length;
    const others = rest.reduce((a, b) => a + b, 0) / rest.length;
    if (mean < others - OFF_NIGHT_DROP) out.push({ weekday: wd, mean: r2(mean), others: r2(others), nights: mine.length });
  }
  return out;
}

/** Penalties and bonuses that sit on top of window consistency (group cap, disruption, stress, stagiaires). */
export function consistencyModifier(stars: StarsState, day: number): number {
  const untrained = stars.satellites.filter((s) => !s.headChefTrained).length;
  const disrupted = (stars.headChef.disruptedUntil ?? -1) > day ? DISRUPTION_PENALTY : 0;
  const stress = Math.max(0, stars.headChef.stress - STRESS_CONSISTENCY_FROM) * STRESS_CONSISTENCY_WEIGHT;
  const stag = Math.min(STAGIAIRE_MAX, stars.stagiaires.count) * STAGIAIRE_CONSISTENCY;
  return -GROUP_CAP_PENALTY * untrained - disrupted - stress + stag;
}

// ── produce, seasons and partners ──
const PRODUCE = new Set(SUPPLIERS.flatMap((s) => s.ingredientIds));

export interface ProduceShares { season: number; partner: number; partnerSeasonBonus: number }

export function produceShares(content: ContentPack, stars: StarsState, inputs: DayInputs): ProduceShares {
  const month = monthOf(inputs.day);
  const dishes = new Map(content.dishes.map((d) => [d.id, d]));
  const ings = new Map(content.ingredients.map((i) => [i.id, i]));
  let total = 0;
  let season = 0;
  let partner = 0;
  let bonus = 0;
  for (const line of inputs.dishes) {
    const dish = dishes.get(line.dishId);
    if (!dish || line.sold <= 0) continue;
    for (const ing of dish.ingredients) {
      if (!PRODUCE.has(ing.id)) continue;
      const w = ing.qty * line.sold;
      const inSeason = !!ings.get(ing.id)?.seasonality?.includes(month);
      total += w;
      if (inSeason) season += w;
      const rel = stars.sourcing.find((s) => s.ingredientIds.includes(ing.id));
      if (rel) {
        partner += w * (rel.relationship / 100);
        if (inSeason) bonus += w * rel.seasonalBonus;
      }
    }
  }
  if (total <= 0) return { season: 0, partner: 0, partnerSeasonBonus: 0 };
  return { season: season / total, partner: partner / total, partnerSeasonBonus: bonus / total };
}

/** The five criteria for an open day. `window` must already include today's mean quality. */
export function dayCriteria(content: ContentPack, stars: StarsState, inputs: DayInputs, window: readonly number[]): Criteria {
  const dishes = new Map(content.dishes.map((d) => [d.id, d]));
  const tasted = inputs.dishes.filter((d) => d.quality !== undefined && d.plated > 0);
  const dishMean = tasted.length ? tasted.reduce((a, d) => a + (d.quality ?? 0), 0) / tasted.length : inputs.quality;
  const harmony = 0.5 * inputs.quality + 0.5 * dishMean;

  const sold = inputs.dishes.reduce((a, d) => a + d.sold, 0);
  const ambition = sold > 0 ? inputs.dishes.reduce((a, d) => a + (dishes.get(d.dishId)?.skillRequired ?? 0) * d.sold, 0) / sold : 0;
  const technique = 0.5 * harmony + 0.5 * Math.min(100, TECHNIQUE_AMBITION_SCALE * ambition);

  const sigSold = inputs.dishes.filter((d) => stars.testKitchen.researched.includes(d.dishId)).reduce((a, d) => a + d.sold, 0);
  const sigShare = sold > 0 ? sigSold / sold : 0;
  const personality =
    PERSONALITY_HARMONY_WEIGHT * harmony +
    PERSONALITY_SIGNATURE_WEIGHT * sigShare +
    PERSONALITY_REPUTATION_WEIGHT * stars.headChef.reputation +
    ((stars.relaunchUntil ?? -1) > inputs.day ? RELAUNCH_PERSONALITY_BONUS : 0) +
    ((stars.loyaltyUntil ?? -1) > inputs.day ? LOYALTY_PERSONALITY_BONUS : 0);

  const p = produceShares(content, stars, inputs);
  const ingredients =
    INGREDIENTS_HARMONY_WEIGHT * harmony +
    INGREDIENTS_BASE +
    INGREDIENTS_SEASON_WEIGHT * p.season +
    INGREDIENTS_PARTNER_WEIGHT * p.partner +
    100 * p.partnerSeasonBonus +
    (stars.ticketing.unlocked && stars.ticketing.prepaid ? INGREDIENTS_PREPAID_BONUS : 0);

  const consistency = windowConsistency(window) + consistencyModifier(stars, inputs.day);
  return { ingredients: pct(ingredients), harmony: pct(harmony), technique: pct(technique), personality: pct(personality), consistency: pct(consistency) };
}

export const CRITERIA_KEYS = ["ingredients", "harmony", "technique", "personality", "consistency"] as const;

export function criteriaTotal(c: Criteria): number {
  return r2(CRITERIA_KEYS.reduce((a, k) => a + c[k], 0) / CRITERIA_KEYS.length);
}

export function zeroCriteria(): Criteria {
  return { ingredients: 0, harmony: 0, technique: 0, personality: 0, consistency: 0 };
}
