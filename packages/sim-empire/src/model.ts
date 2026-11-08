/**
 * The aggregate (closed-form) site model and its calibration against the focused sim-core restaurant.
 *
 *   covers  = baseCovers × location × season × weekend × demandFactors × noise
 *   revenue = covers × spendPerCover × priceIndex × costIndex × priceLevel × app
 *   food    = covers × foodPerCover × costIndex^0.6 × priceLevel × fresh × (1 − supplier discount)
 *   labour  = labourPerDay × costIndex × priceLevel × (covers / coversMean)^0.92 × (1 − speedee saving)
 *   overheads = overheadsFixed × costIndex × priceLevel × (covers / coversMean)^0.85 + cardFee × revenue
 *   VAT = vatPct × revenue
 *
 * Every demand factor is normalised to 1 at the reference state (constants REF_*), which is exactly where
 * newEmpire puts the flagship. So a site at the reference state in the calibration district reproduces the
 * focused restaurant's mean covers, spend and costs (test/calibration.test.ts checks this against runDay).
 */
import { isWeekend, monthOf, weekdayOf } from "@full-plate/sim-core";
import type { ContentPack, DayResult, DistrictDef } from "@full-plate/sim-core";
import * as K from "./constants";
import type { Brand, CalibrationParams, City, DistrictId, SiteDayResult, SiteSummary } from "./types";
import type { Rng } from "./rng";

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ── content lookups (cached per pack) ──
const districtCache = new WeakMap<ContentPack, Map<string, DistrictDef>>();
export function districtDef(content: ContentPack, id: DistrictId): DistrictDef {
  let m = districtCache.get(content);
  if (!m) {
    m = new Map(content.districts.map((d) => [d.id, d]));
    districtCache.set(content, m);
  }
  const d = m.get(id);
  if (!d) throw new Error(`Unknown district ${id}`);
  return d;
}

/** Reference district for footfall ratios when calibration has none: the first content district. */
function refDistrict(content: ContentPack, cal: CalibrationParams): DistrictDef {
  return districtDef(content, cal.districtId ?? content.districts[0]!.id);
}

export function seasonOf(d: DistrictDef, day: number): number {
  return d.seasonCurve[monthOf(day) - 1] ?? 1;
}

// ── calibration ──
export interface CalibrateOptions {
  /** District of the focused restaurant (deseasonalises the history). Without it, season is assumed flat. */
  districtId?: DistrictId;
  /** Use only the last N days (default: all). */
  lastDays?: number;
}

const sumOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Fits the closed-form model to a focused sim's DayResult history so a site promoted to (or demoted from)
 * focused keeps its numbers. Ratio estimators keep means exact: Σ fitted covers = Σ actual covers.
 */
export function calibrate(content: ContentPack, focusedHistory: readonly DayResult[], opts: CalibrateOptions = {}): CalibrationParams {
  const all = opts.lastDays ? focusedHistory.slice(-opts.lastDays) : focusedHistory.slice();
  // Days closed by an event (no covers) carry no information about demand.
  const h = all.filter((d) => d.covers > 0);
  if (h.length < K.MIN_CALIBRATION_DAYS) throw new Error(`calibrate needs at least ${K.MIN_CALIBRATION_DAYS} trading days (got ${h.length})`);
  const district = opts.districtId ? districtDef(content, opts.districtId) : undefined;
  const season = (day: number) => (district ? seasonOf(district, day) : 1);

  // Weekday profile: deseasonalised mean covers per weekday ÷ the overall mean (shrunk toward 1 below 4 samples).
  const byWd: number[][] = [[], [], [], [], [], [], []];
  for (const d of h) byWd[weekdayOf(d.day)]!.push(d.covers / season(d.day));
  const overall = sumOf(h.map((d) => d.covers / season(d.day))) / h.length;
  const raw = byWd.map((xs) => {
    if (!xs.length || overall <= 0) return 1;
    const m = sumOf(xs) / xs.length;
    const w = xs.length >= 4 ? 1 : xs.length / 4;
    return w * (m / overall) + (1 - w);
  });
  const rawMean = sumOf(raw) / 7;
  const weekdayProfile = raw.map((v) => clamp(v / rawMean, 0.2, 3));
  const we = [0, 1, 2, 3, 4, 5, 6].filter((i) => isWeekend(i - weekdayOf(0)));
  const wd = [0, 1, 2, 3, 4, 5, 6].filter((i) => !we.includes(i));
  const weekendMult = sumOf(we.map((i) => weekdayProfile[i]!)) / we.length / (sumOf(wd.map((i) => weekdayProfile[i]!)) / wd.length);
  const shape = (day: number) => season(day) * weekdayProfile[weekdayOf(day)]!;

  const covers = sumOf(h.map((d) => d.covers));
  const baseCovers = covers / sumOf(h.map((d) => shape(d.day)));
  const revenue = sumOf(h.map((d) => d.revenue));
  const food = sumOf(h.map((d) => d.foodCost + d.waste.prep + d.waste.spoil));
  const labour = sumOf(h.map((d) => d.labourCost));
  const vat = sumOf(h.map((d) => d.vat ?? 0));
  // Overheads = fixed + cardFee × revenue (OLS); incident costs fold into the fixed part.
  const oh = h.map((d) => (d.overheads ?? 0) + (d.incidentCosts ?? 0));
  const rv = h.map((d) => d.revenue);
  const n = h.length;
  const mr = revenue / n;
  const mo = sumOf(oh) / n;
  let varR = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    varR += (rv[i]! - mr) ** 2;
    cov += (rv[i]! - mr) * (oh[i]! - mo);
  }
  const cardFeePct = varR > 0 ? clamp(cov / varR, 0, 0.05) : K.DEFAULT_CALIBRATION.cardFeePct;
  const overheadsFixed = Math.max(0, mo - cardFeePct * mr);

  let lsq = 0;
  for (const d of h) lsq += Math.log(d.covers / (baseCovers * shape(d.day))) ** 2;
  const noiseSd = clamp(Math.sqrt(lsq / n), 0.02, 0.5);

  return {
    baseCovers,
    coversMean: covers / n,
    spendPerCover: Math.round(revenue / covers),
    foodPerCover: Math.round(food / covers),
    labourPerDay: Math.round(labour / n),
    overheadsFixed: Math.round(overheadsFixed),
    cardFeePct,
    vatPct: revenue > 0 ? vat / revenue : K.DEFAULT_CALIBRATION.vatPct,
    weekdayProfile,
    weekendMult,
    ...(opts.districtId ? { districtId: opts.districtId } : {}),
    noiseSd,
    days: n,
    source: {
      covers: covers / n,
      revenue: Math.round(revenue / n),
      profit: Math.round(sumOf(h.map((d) => d.profit + d.loanPayment)) / n),
    },
  };
}

/** Calibration used before any focused history exists (roughly a sim-core High Street restaurant). */
export function defaultCalibration(content: ContentPack): CalibrationParams {
  const c = K.DEFAULT_CALIBRATION;
  return {
    baseCovers: c.baseCovers,
    coversMean: c.coversMean,
    spendPerCover: c.spendPerCover,
    foodPerCover: c.foodPerCover,
    labourPerDay: c.labourPerDay,
    overheadsFixed: c.overheadsFixed,
    cardFeePct: c.cardFeePct,
    vatPct: c.vatPct,
    // Mon-Thu 0.9, Fri-Sun 1.13 (sim-core's weekendFootfallMult ≈ 1.25 over weekdays), mean 1.
    weekdayProfile: [0.9, 0.9, 0.9, 0.9, 1.133, 1.133, 1.133],
    weekendMult: 1.25,
    districtId: content.districts.find((d) => d.id === "high_street")?.id ?? content.districts[0]!.id,
    noiseSd: c.noiseSd,
    days: 0,
    source: { covers: c.coversMean, revenue: c.coversMean * c.spendPerCover, profit: 0 },
  };
}

// ── standardisation ──
export function standardisation(formula: Pick<Brand["formula"], "locked" | "academy" | "driveThru" | "appOrdering" | "menuDishIds">): number {
  let s = K.STD_BASE;
  if (formula.locked) s += K.STD_FORMULA_LOCKED;
  if (formula.academy) s += K.STD_ACADEMY;
  if (formula.driveThru) s += K.STD_DRIVE_THRU;
  if (formula.appOrdering) s += K.STD_APP;
  s -= Math.max(0, formula.menuDishIds.length - K.STD_MENU_FREE) * K.STD_PER_EXTRA_DISH;
  return clamp(Math.round(s), 0, 100);
}

// ── dietary rules ──
/** Ingredient ids that break each dietary rule (from content's ingredient list). */
export const DIET_BREAKERS: Record<string, readonly string[]> = {
  "no-beef": ["beef_steak", "beef_mince"],
  "no-pork": ["pork_belly", "sausages", "bacon"],
  halal: ["pork_belly", "sausages", "bacon", "house_wine", "fine_wine", "prosecco", "lager", "craft_ale", "spirit"],
  kosher: ["pork_belly", "sausages", "bacon", "prawns", "mussels", "scallops"],
};
const MEAT = ["beef_steak", "beef_mince", "chicken_breast", "lamb", "duck_breast"];
const DAIRY = ["cheddar", "butter", "cream", "milk", "parmesan", "mozzarella", "halloumi", "ice_cream"];

/** True when the brand's menu breaks one of the city's dietary rules (kosher also forbids meat with dairy in one dish). */
export function menuBreaksRules(content: ContentPack, menuDishIds: readonly string[], rules: readonly string[]): boolean {
  if (rules.length === 0) return false;
  for (const id of menuDishIds) {
    const dish = content.dishes.find((d) => d.id === id);
    if (!dish) continue;
    const ings = dish.ingredients.map((i) => i.id);
    for (const r of rules) {
      if (ings.some((i) => DIET_BREAKERS[r]?.includes(i))) return true;
      if (r === "kosher" && ings.some((i) => MEAT.includes(i)) && ings.some((i) => DAIRY.includes(i))) return true;
    }
  }
  return false;
}

// ── demand factors ──
export const recognitionFactor = (rec: number) => (K.REC_BASE + rec / 100) / (K.REC_BASE + K.REF_RECOGNITION / 100);
export const consistencyFactor = (c: number) =>
  (K.CONSISTENCY_BASE + (K.CONSISTENCY_SLOPE * c) / 100) / (K.CONSISTENCY_BASE + (K.CONSISTENCY_SLOPE * K.REF_CONSISTENCY) / 100);
export const staffFactor = (q: number) => (K.STAFF_BASE + (K.STAFF_SLOPE * q) / 100) / (K.STAFF_BASE + (K.STAFF_SLOPE * K.REF_STAFF_QUALITY) / 100);
export const throughputFactor = (std: number) => 1 + K.STD_THROUGHPUT * Math.max(0, std - K.REF_STANDARDISATION);
export const priceFactor = (priceIndex: number) => clamp(priceIndex, ...K.PRICE_INDEX_RANGE) ** -K.PRICE_ELASTICITY;
export const championFactor = (city: City, rec: number) => 1 - city.championStrength * K.CHAMPION_HIT * (1 - rec / 200);

/** Demand lost to a site looking tired (years since the last remodel past STALE_AFTER_YEARS). */
export function staleFactor(site: Pick<SiteSummary, "lastRemodel">, day: number): number {
  const years = (day - site.lastRemodel) / K.DAYS_PER_YEAR - K.STALE_AFTER_YEARS;
  return years > 0 ? Math.max(K.STALE_FLOOR, 1 - K.STALE_RATE_PER_YEAR * years) : 1;
}

/** Footfall of a (city, district) relative to the calibration district in a home-sized city. */
export function locationFactor(content: ContentPack, cal: CalibrationParams, city: City, districtId: DistrictId): number {
  const d = districtDef(content, districtId);
  return (d.footfall / refDistrict(content, cal).footfall) * (city.population / K.FOOTFALL_POP_REF) ** K.FOOTFALL_POP_EXP;
}

/**
 * Share of demand each site keeps given n brand sites in the city: total city demand grows as
 * capacity × (1 − e^(−n/capacity)), split evenly, normalised so one site keeps 100%.
 */
export function saturationPenalty(nEffective: number, population: number): number {
  if (nEffective <= 1) return 0;
  const cap = Math.max(1, population / K.PEOPLE_PER_SITE);
  const share = (n: number) => (cap * (1 - Math.exp(-n / cap))) / n;
  return clamp(1 - share(nEffective) / share(1), 0, K.SATURATION_MAX);
}

/** Context shared by every site on one day (built once per stepEmpireDay). */
export interface SiteDayContext {
  day: number;
  calibration: CalibrationParams;
  priceLevel?: number;
  /** Brand-wide demand multiplier from effects, per region (scandals, campaigns, launches). */
  demandMult?: number;
  spendMult?: number;
  /** Food cost multiplier from supplier deals. */
  foodMult?: number;
  /** Menu breaks this city's rules (precomputed per city). */
  breaksRules?: boolean;
  /** When false, no noise is drawn (forecasts). Default true. */
  noise?: boolean;
}

/** Expected-value multiplier on covers (everything except season, weekend and noise). */
export function demandFactor(content: ContentPack, site: SiteSummary, brand: Brand, city: City, ctx: SiteDayContext): number {
  const f = brand.formula;
  const rec = brand.recognition[city.regionId] ?? 0;
  let m =
    locationFactor(content, ctx.calibration, city, site.districtId) *
    recognitionFactor(rec) *
    consistencyFactor(site.brandConsistency) *
    staffFactor(site.staffQuality) *
    throughputFactor(f.standardisation) *
    priceFactor(f.priceIndex) *
    championFactor(city, rec) *
    staleFactor(site, ctx.day) *
    (1 - site.saturationPenalty) *
    brand.permanentDemand *
    (ctx.demandMult ?? 1);
  if (site.driveThru) m *= K.DRIVE_THRU_COVERS;
  if (f.appOrdering) m *= K.APP_COVERS;
  if (f.fresh) m *= K.FRESH_APPEAL;
  if (ctx.breaksRules) m *= K.DIETARY_PENALTY;
  if (city.tradition) m *= K.TRADITION_DEMAND;
  for (const mod of site.footfallMods) m *= mod.mult;
  return m;
}

/**
 * One aggregate site-day: closed-form covers and costs with log-normal noise. Pure given the rng.
 * Occupancy, royalties and fees are applied by stepEmpireDay (they depend on ownership and land).
 */
export function aggregateSiteDay(content: ContentPack, site: SiteSummary, brand: Brand, city: City, rng: Rng, ctx: SiteDayContext): SiteDayResult {
  const cal = ctx.calibration;
  const pl = ctx.priceLevel ?? 1;
  const d = districtDef(content, site.districtId);
  const shape = seasonOf(d, ctx.day) * (cal.weekdayProfile[weekdayOf(ctx.day)] ?? 1);
  const expected = cal.baseCovers * shape * demandFactor(content, site, brand, city, ctx);
  const noise = ctx.noise === false ? 1 : Math.exp(rng.gaussian(-(cal.noiseSd ** 2) / 2, cal.noiseSd));
  const covers = Math.max(0, Math.round(expected * noise));
  const f = brand.formula;
  const spend = cal.spendPerCover * clamp(f.priceIndex, ...K.PRICE_INDEX_RANGE) * city.costIndex * pl * (f.appOrdering ? K.APP_SPEND : 1) * (ctx.spendMult ?? 1);
  const revenue = Math.round(covers * spend);
  const foodCost = Math.round(covers * cal.foodPerCover * city.costIndex ** 0.6 * pl * (f.fresh ? K.FRESH_FOOD_COST : 1) * (ctx.foodMult ?? 1));
  const speedee = 1 - K.LABOUR_EFFICIENCY_PER_10_STD * Math.max(0, (f.standardisation - K.REF_STANDARDISATION) / 10);
  const labourCost = covers > 0 ? Math.round(cal.labourPerDay * city.costIndex * pl * (covers / cal.coversMean) ** K.LABOUR_SCALE_EXP * speedee) : Math.round(cal.labourPerDay * 0.3 * city.costIndex * pl);
  const scale = Math.max(0.3, covers / cal.coversMean);
  const overheads = Math.round(cal.overheadsFixed * city.costIndex * pl * scale ** K.OVERHEAD_SCALE_EXP + cal.cardFeePct * revenue);
  const vat = Math.round(cal.vatPct * revenue);
  return { siteId: site.id, covers, revenue, vat, foodCost, labourCost, overheads, contribution: revenue - vat - foodCost - labourCost - overheads };
}

/** Maps the focused restaurant's DayResult into the aggregate shape (food includes prep waste and spoilage). */
export function siteDayFromResult(siteId: string, r: DayResult): SiteDayResult {
  const foodCost = r.foodCost + r.waste.prep + r.waste.spoil;
  const overheads = (r.overheads ?? 0) + (r.incidentCosts ?? 0);
  const vat = r.vat ?? 0;
  return { siteId, covers: r.covers, revenue: r.revenue, vat, foodCost, labourCost: r.labourCost, overheads, contribution: r.revenue - vat - foodCost - r.labourCost - overheads };
}
