/**
 * The aggregate (closed-form) site model and its calibration against the focused sim-core restaurant.
 *
 * Round 3: a modelled site is the same dining room the focused sim runs, in closed form (EMPIRE-NOTES §3):
 *
 *   demand   = demandScale × marketDemand(district, brand menu at priceIndex, popularity, day) × pull
 *   capacity = capacityCovers(tables = box(standardisation), crew on shift (standard rota), crew skill = staffQuality)
 *   covers   = softCap(demand, capacity) × offPremise (drive-thru 1.3, app 1.1) × noise
 *   revenue  = covers × spendPerCover × priceIndex × costIndex × priceLevel × app
 *   food     = covers × foodPerCover × costIndex^0.6 × priceLevel × fresh × (1 − supplier discount)
 *   labour   = standard crew shifts × wage(staffQuality) × costIndex × priceLevel × offPremiseLabour × speedee
 *   overheads = overheadsFixed × costIndex × priceLevel × (covers / coversMean)^0.85 + cardFee × revenue
 *
 * marketDemand, capacityCovers and softCap are sim-core's own closed forms (sim-core/src/capacity.ts), so a site
 * modelled here and the GameState newGameFromSite builds for it agree on district, menu, prices, tables and crew.
 * `pull` carries everything the sim has no physics for (recognition, consistency, saturation, champions, effects),
 * and newGameFromSite hands the same number to the sim as a "brand" footfall mod.
 */
import { capacityCovers, isWeekend, marketDemand, monthOf, softCap, uncapped, weekdayOf, SHIFT_HOURS, EMPLOYER_ONCOST } from "@full-plate/sim-core";
import type { ContentPack, DayResult, DistrictDef, GameState, MenuItem } from "@full-plate/sim-core";
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

export function seasonOf(d: DistrictDef, day: number): number {
  return d.seasonCurve[monthOf(day) - 1] ?? 1;
}

// ── the dining room: menu, box, crew ──
/** The brand menu as sim-core MenuItems: formula dishes at round(suggestedPrice × priceIndex). */
let menuMemo: { content: ContentPack; ids: readonly string[]; idsKey: string; pi: number; menu: MenuItem[]; key: string } | undefined;

/** brandMenu plus its cache key, memoised on the last formula seen (stepEmpireDay asks once per site per day). */
export function brandMenuKeyed(content: ContentPack, formula: Pick<Brand["formula"], "menuDishIds" | "priceIndex">): { menu: MenuItem[]; key: string } {
  const m = menuMemo;
  if (m && m.content === content && m.pi === formula.priceIndex && (m.ids === formula.menuDishIds || m.idsKey === formula.menuDishIds.join(","))) {
    m.ids = formula.menuDishIds;
    return m;
  }
  const menu = brandMenu(content, formula);
  menuMemo = { content, ids: formula.menuDishIds, idsKey: formula.menuDishIds.join(","), pi: formula.priceIndex, menu, key: menuKey(menu) };
  return menuMemo;
}

export function brandMenu(content: ContentPack, formula: Pick<Brand["formula"], "menuDishIds" | "priceIndex">): MenuItem[] {
  const pi = clamp(formula.priceIndex, ...K.PRICE_INDEX_RANGE);
  const out: MenuItem[] = [];
  for (const id of formula.menuDishIds) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) out.push({ dishId: id, price: Math.round(d.suggestedPrice * pi), active: true, sold7d: 0, margin7d: 0 });
  }
  return out;
}

/** Tables in the brand's standard box: startingTables × Speedee throughput, capped at maxTables. */
export function boxTables(content: ContentPack, std: number): number {
  const b = content.balance;
  return clamp(Math.round(b.startingTables * throughputFactor(std)), b.startingTables, b.maxTables);
}

export const siteTables = (content: ContentPack, site: Pick<SiteSummary, "tables">, brand: Brand): number =>
  site.tables ?? boxTables(content, brand.formula.standardisation);

/** Chef+server pairs on shift on a weekday under the standard crew rotas (1 Mon–Thu, 2 Fri–Sun). */
export function crewUnits(weekday: number): number {
  return (K.CREW_ROTA_A[weekday] ? 1 : 0) + (K.CREW_ROTA_B[weekday] ? 1 : 0);
}

/**
 * Hourly wage (pence) of a crew member at skill q, from the content's staff archetypes: chefs run from the National
 * Living Wage at 30 to ~£17.70 at 85 (commis → line → experienced); servers stay near NLW (+2p a point above 20).
 */
export const crewWage = (q: number, role: "chef" | "server" = "chef"): number =>
  Math.round(K.CREW_WAGE_BASE + (role === "chef" ? K.CREW_WAGE_PER_SKILL * Math.max(0, q - 30) : K.SERVER_WAGE_PER_SKILL * Math.max(0, q - 20)));

/** Daily labour (pence, before costIndex/priceLevel) of the standard crew at staff quality q: 2 chefs + 2 servers × 5 shifts. */
export function crewLabourPerDay(q: number): number {
  const shifts = K.CREW_ROTA_A.filter(Boolean).length + K.CREW_ROTA_B.filter(Boolean).length;
  return ((shifts * (crewWage(q, "chef") + crewWage(q, "server"))) / 7) * SHIFT_HOURS * (1 + EMPLOYER_ONCOST);
}

/**
 * Popularity a modelled site trades at: its own when it has been run hands-on, else what sim-core's ratings give a
 * standard crew of its staff quality (fitted on newGameFromSite runs: ~71 at 40, ~79 at 50, ~88 at 65).
 */
export function sitePopularity(site: Pick<SiteSummary, "popularity" | "staffQuality">): number {
  return clamp(site.popularity ?? K.POPULARITY_REF + K.POPULARITY_PER_SKILL * (site.staffQuality - K.REF_STAFF_QUALITY), 20, 100);
}

/**
 * Prestige a modelled site trades at: its own when run hands-on, else what a standard crew earns in sim-core (good
 * cooking compounds: ~15 at staff quality 40, ~45 at 50, 90+ from 65; fitted on newGameFromSite runs).
 */
export function sitePrestige(site: Pick<SiteSummary, "prestige" | "staffQuality">): number {
  return clamp(site.prestige ?? K.PRESTIGE_REF + K.PRESTIGE_PER_SKILL * (site.staffQuality - K.REF_STAFF_QUALITY), 0, 100);
}

// market demand cache: brand menu × district × month × weekend × popularity (content is immutable)
type Market = { covers: number; meanParty: number; peakShare: number; spendPerCover: number; foodPerCover: number };
const marketCache = new WeakMap<ContentPack, Map<string, Market>>();
const menuKey = (menu: readonly MenuItem[]) => menu.map((m) => `${m.dishId}:${m.price}`).join(",");

/** sim-core's closed-form demand for a dining room with this menu, cached (no footfall mods). */
export function market(content: ContentPack, districtId: DistrictId, menu: readonly MenuItem[], popularity: number, day: number, prestige: number = K.PRESTIGE_REF, keyOfMenu?: string): Market {
  let m = marketCache.get(content);
  if (!m) {
    m = new Map();
    marketCache.set(content, m);
  }
  const key = `${districtId}|${monthOf(day)}|${isWeekend(day) ? 1 : 0}|${Math.round(popularity * 10)}|${Math.round(prestige * 10)}|${keyOfMenu ?? menuKey(menu)}`;
  let hit = m.get(key);
  if (!hit) {
    const d = marketDemand(content, { districtId, menu, day, popularity, prestige });
    hit = { covers: d.covers, meanParty: d.meanParty, peakShare: d.peakShare, spendPerCover: d.spendPerCover, foodPerCover: d.foodPerCover };
    if (m.size > 20_000) m.clear();
    m.set(key, hit);
  }
  return hit;
}

// ── calibration ──
export interface CalibrateOptions {
  /** District of the focused restaurant. Default: the GameState's, else the first content district. */
  districtId?: DistrictId;
  /** Use only the last N days (default: all). */
  lastDays?: number;
  /**
   * [round 3] The focused GameState the history came from: its menu, tables, rota and popularity let the fit
   * separate demand from capacity. Without it the standard box, standard crew and `menu` are assumed.
   */
  state?: GameState;
  /** Menu to assume without a state (default: the dishes sold in the history at suggested prices). */
  menu?: readonly MenuItem[];
  /** Footfall multiplier that was in force on the history (e.g. a promoted site's brand pull). Default 1. */
  pull?: number;
}

const sumOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Fits the closed-form model to a focused sim's DayResult history so a modelled site produces what the focused
 * sim produces for the same inputs. Each day's demand is sim-core's marketDemand for that day; the day's capacity
 * comes from the restaurant's tables and the crew rostered that weekday. demandScale is solved so that
 * Σ softCap(demandScale × demand, capacity) = Σ actual covers (means stay exact). Days the owner covered a role
 * are left out (P2, round 3): the model's sites have their own full crew, so the owner's rota must not leak in.
 */
export function calibrate(content: ContentPack, focusedHistory: readonly DayResult[], opts: CalibrateOptions = {}): CalibrationParams {
  const all = opts.lastDays ? focusedHistory.slice(-opts.lastDays) : focusedHistory.slice();
  // Days closed by an event (no covers) carry no information about demand.
  const trading = all.filter((d) => d.covers > 0 && !d.closed);
  if (trading.length < K.MIN_CALIBRATION_DAYS) throw new Error(`calibrate needs at least ${K.MIN_CALIBRATION_DAYS} trading days (got ${trading.length})`);
  const staffed = trading.filter((d) => !d.ownerCovered?.length);
  const h = staffed.length >= K.MIN_CALIBRATION_DAYS ? staffed : trading;
  const state = opts.state;
  const districtId = opts.districtId ?? state?.districtId ?? content.districts[0]!.id;
  const menu = state ? state.menu.filter((m) => m.active) : opts.menu ?? historyMenu(content, h);
  // DayResults don't carry the absolute popularity (and events move it outside popularityDelta), so the fit uses the
  // restaurant's popularity now: the window is recent and popularity is slow.
  const pop = state?.reputation.popularity ?? K.DEFAULT_POPULARITY;
  const pull = opts.pull ?? 1;

  // Per day: closed-form demand (scale 1) and capacity.
  const rows = h.map((d) => {
    const mk = marketDemand(content, { districtId, menu, day: d.day, popularity: pop, ...(state ? { prestige: state.reputation.prestige, difficulty: state.difficulty } : {}) });
    const wd = weekdayOf(d.day);
    const crew = state ? stateCrew(state, wd) : { crewUnits: crewUnits(wd), crewSkill: K.REF_STAFF_QUALITY };
    const tables = state ? state.tables.length : content.balance.startingTables;
    const cap = capacityCovers({ tables, seatsPerTable: content.balance.seatsPerTable, meanParty: mk.meanParty, peakShare: mk.peakShare, ...crew });
    return { d, demand: mk.covers * pull, cap, spend: mk.spendPerCover, food: mk.foodPerCover };
  });
  const served = (scale: number) => sumOf(rows.map((r) => softCap(scale * r.demand, r.cap)));
  const covers = sumOf(h.map((d) => d.covers));
  // Bisection on log(scale): served() is increasing in scale.
  let lo = Math.log(0.02);
  let hi = Math.log(50);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (served(Math.exp(mid)) < covers) lo = mid;
    else hi = mid;
  }
  let demandScale = Math.exp((lo + hi) / 2);
  // Above the reachable ceiling the bisection pins at the top; fall back to the inverted-demand ratio.
  if (served(demandScale) < covers * 0.98) demandScale = sumOf(rows.map((r) => uncapped(r.d.covers, r.cap))) / Math.max(1e-9, sumOf(rows.map((r) => r.demand)));
  // One restaurant's 90 days can't separate a model-wide demand error from its own quirks (its crew mix, a prestige
  // of 100, a lucky quarter), and sim-core's closed form is already fitted to the sim: keep part of the deviation.
  const fittedScale = demandScale;
  demandScale = 1 + K.DEMAND_SCALE_KEEP * (fittedScale - 1);

  const revenue = sumOf(h.map((d) => d.revenue));
  const food = sumOf(h.map((d) => d.foodCost + d.waste.prep + d.waste.spoil));
  // Spend and food per cover relative to the order model's expectation, so a site in another district (another
  // segment mix, other dish choices) or at another price index gets its own basket.
  const spendModel = sumOf(rows.map((r) => r.d.covers * r.spend));
  const foodModel = sumOf(rows.map((r) => r.d.covers * r.food));
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
  const byWd: number[][] = [[], [], [], [], [], [], []];
  for (const r of rows) {
    const fit = softCap(demandScale * r.demand, r.cap);
    lsq += Math.log(r.d.covers / Math.max(1e-9, fit)) ** 2;
    byWd[weekdayOf(r.d.day)]!.push(fit);
  }
  const noiseSd = clamp(Math.sqrt(lsq / n), 0.02, 0.5);
  const popularity = pop;

  // Informational weekday shape of the reference site (standard crew, the brand's box at standardisation 30).
  const fitted = rows.map((r) => softCap(demandScale * r.demand, r.cap));
  const wdMean = byWd.map((xs) => (xs.length ? sumOf(xs) / xs.length : 0));
  const overall = sumOf(wdMean.filter((x) => x > 0)) / Math.max(1, wdMean.filter((x) => x > 0).length);
  const weekdayProfile = wdMean.map((v) => (v > 0 && overall > 0 ? clamp(v / overall, 0.2, 3) : 1));
  const we = [0, 1, 2, 3, 4, 5, 6].filter((i) => isWeekend(i - weekdayOf(0)));
  const wkd = [0, 1, 2, 3, 4, 5, 6].filter((i) => !we.includes(i));
  const weekendMult = sumOf(we.map((i) => weekdayProfile[i]!)) / we.length / (sumOf(wkd.map((i) => weekdayProfile[i]!)) / wkd.length);

  return {
    baseCovers: sumOf(fitted) / n,
    coversMean: covers / n,
    spendPerCover: Math.round(revenue / covers),
    foodPerCover: Math.round(food / covers),
    labourPerDay: Math.round(labour / n),
    overheadsFixed: Math.round(overheadsFixed),
    cardFeePct,
    vatPct: revenue > 0 ? vat / revenue : K.DEFAULT_CALIBRATION.vatPct,
    weekdayProfile,
    weekendMult,
    districtId,
    noiseSd,
    days: n,
    demandScale,
    popularity,
    ...(spendModel > 0 ? { spendScale: revenue / spendModel } : {}),
    ...(foodModel > 0 ? { foodScale: food / foodModel } : {}),
    source: {
      covers: covers / n,
      revenue: Math.round(revenue / n),
      profit: Math.round(sumOf(h.map((d) => d.profit + d.loanPayment)) / n),
    },
  };
}

/** Crew on shift on a weekday from a GameState's rota (owner covers a missing role at half a unit). */
function stateCrew(state: GameState, weekday: number): { crewUnits: number; crewSkill: number } {
  const on = state.staff.filter((s) => s.rota[weekday] === true);
  const chefs = on.filter((s) => s.role === "chef");
  const servers = on.filter((s) => s.role === "server");
  const people = [...chefs, ...servers];
  return {
    crewUnits: (Math.max(chefs.length, 0.5) + Math.max(servers.length, 0.5)) / 2,
    crewSkill: people.length ? people.reduce((a, s) => a + s.skill, 0) / people.length : 40,
  };
}

/** The dishes sold in a history, at suggested prices (when calibrate gets neither a state nor a menu). */
function historyMenu(content: ContentPack, h: readonly DayResult[]): MenuItem[] {
  const ids = new Set<string>();
  for (const d of h) for (const id of Object.keys(d.perDish ?? {})) ids.add(id);
  const list = ids.size ? [...ids] : content.dishes.slice(0, 6).map((d) => d.id);
  return brandMenu(content, { menuDishIds: list, priceIndex: 1 });
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
    demandScale: 1,
    popularity: K.DEFAULT_POPULARITY,
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

/** City footfall relative to a home-sized city: (population / 2.5m)^0.25 (sim-core already has the district's own footfall). */
export function cityFootfallFactor(city: City): number {
  return (city.population / K.FOOTFALL_POP_REF) ** K.FOOTFALL_POP_EXP;
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

/**
 * [round 5] A new site's first year: underlying demand ramps from RAMP_START to 1 over RAMP_DAYS while the opening
 * novelty (+HONEYMOON, fading over HONEYMOON_DAYS) carries the first weeks — a shallow J rather than a flat year.
 * 1 for sites without `openedTrading` (the flagship) and after the ramp.
 */
export function openingFactor(site: Pick<SiteSummary, "openedTrading">, day: number): number {
  if (site.openedTrading === undefined) return 1;
  const age = Math.max(0, day - site.openedTrading);
  const ramp = 1 - (1 - K.RAMP_START) * Math.max(0, 1 - age / K.RAMP_DAYS);
  const honeymoon = 1 + K.HONEYMOON * Math.max(0, 1 - age / K.HONEYMOON_DAYS);
  return ramp * honeymoon;
}

/**
 * [round 5 review] 0 for a site's first MATURE_FROM_DAYS of trading, rising linearly to 1 at MATURE_FULL_DAYS.
 * Round 6: a refurbishment (REFURBISH) takes `refurbDays` off the age the drag reads.
 */
export function maturity(site: Pick<SiteSummary, "openedTrading" | "refurbDays">, day: number): number {
  if (site.openedTrading === undefined) return 0;
  const age = day - site.openedTrading - (site.refurbDays ?? 0);
  return clamp((age - K.MATURE_FROM_DAYS) / (K.MATURE_FULL_DAYS - K.MATURE_FROM_DAYS), 0, 1);
}

/**
 * Brand pull: the demand multiplier for everything sim-core has no physics for (city size, recognition,
 * consistency, champions, a tired room, saturation, product hits, effects, fresh, dietary rules, traditions and the
 * site's own footfall mods). 1 at the reference state. newGameFromSite gives the same number to the promoted
 * site's GameState as a "brand" footfall mod, so model and sim agree.
 */
export function brandPull(content: ContentPack, site: SiteSummary, brand: Brand, city: City, ctx: Pick<SiteDayContext, "day" | "demandMult" | "breaksRules">): number {
  const f = brand.formula;
  const rec = brand.recognition[city.regionId] ?? 0;
  let m =
    cityFootfallFactor(city) *
    recognitionFactor(rec) *
    consistencyFactor(site.brandConsistency) *
    championFactor(city, rec) *
    staleFactor(site, ctx.day) *
    (1 - site.saturationPenalty) *
    brand.permanentDemand *
    openingFactor(site, ctx.day) *
    (ctx.demandMult ?? 1);
  if (f.fresh) m *= K.FRESH_APPEAL;
  if (ctx.breaksRules) m *= K.DIETARY_PENALTY;
  if (city.tradition) m *= K.TRADITION_DEMAND;
  for (const mod of site.footfallMods) m *= mod.mult;
  return m;
}

/**
 * Off-premise multiplier: the takeaway counter a standardised formula runs (Speedee: +2% of the dining room's covers
 * per point of standardisation above 30), the drive-thru lane and app orders. These covers sit on top of the dining
 * room's seats, on modelled sites and on top of the focused site's DayResult alike (sim-core seats the dining room).
 */
export function offPremise(site: Pick<SiteSummary, "driveThru">, brand: Brand): number {
  const takeaway = 1 + K.TAKEAWAY_PER_STD * Math.max(0, brand.formula.standardisation - K.REF_STANDARDISATION);
  return takeaway * (site.driveThru ? K.DRIVE_THRU_COVERS : 1) * (brand.formula.appOrdering ? K.APP_COVERS : 1);
}

/**
 * [round 5] Labour multiplier for the off-premise covers on top of the dining room's crew: the takeaway counter's covers
 * at COUNTER_LABOUR_SHARE of the room's labour per cover, drive-thru and app covers at the full rate.
 */
export function offPremiseLabour(site: Pick<SiteSummary, "driveThru">, brand: Brand): number {
  const takeaway = 1 + K.TAKEAWAY_PER_STD * Math.max(0, brand.formula.standardisation - K.REF_STANDARDISATION);
  const all = offPremise(site, brand);
  return 1 + K.COUNTER_LABOUR_SHARE * (takeaway - 1) + (all - takeaway);
}

/** @deprecated round 3: demand is now marketDemand × brandPull through a capacity cap. Kept as brandPull. */
export function demandFactor(content: ContentPack, site: SiteSummary, brand: Brand, city: City, ctx: SiteDayContext): number {
  return brandPull(content, site, brand, city, ctx);
}

/** Expected demand and capacity of a modelled site today (no noise): the two halves of the cap. */
export function siteDemandAndCapacity(content: ContentPack, site: SiteSummary, brand: Brand, city: City, ctx: SiteDayContext): { demand: number; capacity: number; seated: number; market: Market } {
  const cal = ctx.calibration;
  const bm = brandMenuKeyed(content, brand.formula);
  const mk = market(content, site.districtId, bm.menu, sitePopularity(site), ctx.day, sitePrestige(site), bm.key);
  const demand = (cal.demandScale ?? 1) * mk.covers * brandPull(content, site, brand, city, ctx);
  const capacity = capacityCovers({
    tables: siteTables(content, site, brand),
    seatsPerTable: content.balance.seatsPerTable,
    meanParty: mk.meanParty,
    peakShare: mk.peakShare,
    crewUnits: crewUnits(weekdayOf(ctx.day)),
    crewSkill: site.staffQuality,
  });
  return { demand, capacity, seated: softCap(demand, capacity), market: mk };
}

/**
 * One aggregate site-day: closed-form covers and costs with log-normal noise. Pure given the rng.
 * Occupancy, royalties and fees are applied by stepEmpireDay (they depend on ownership and land).
 */
export function aggregateSiteDay(content: ContentPack, site: SiteSummary, brand: Brand, city: City, rng: Rng, ctx: SiteDayContext): SiteDayResult {
  const cal = ctx.calibration;
  const pl = ctx.priceLevel ?? 1;
  const { seated, market: mk } = siteDemandAndCapacity(content, site, brand, city, ctx);
  const off = offPremise(site, brand);
  const noise = ctx.noise === false ? 1 : Math.exp(rng.gaussian(-(cal.noiseSd ** 2) / 2, cal.noiseSd));
  const m = maturity(site, ctx.day);
  const covers = Math.max(0, Math.round(seated * off * noise));
  const f = brand.formula;
  // Basket per cover: the order model's expectation for this district and the brand menu (already at priceIndex),
  // scaled by the fit; pre-round-3 calibrations fall back to the flat spendPerCover × priceIndex.
  const basket = cal.spendScale !== undefined ? cal.spendScale * mk.spendPerCover : cal.spendPerCover * clamp(f.priceIndex, ...K.PRICE_INDEX_RANGE);
  const plate = cal.foodScale !== undefined ? cal.foodScale * mk.foodPerCover : cal.foodPerCover;
  const spend = basket * city.costIndex * pl * (f.appOrdering ? K.APP_SPEND : 1) * (ctx.spendMult ?? 1);
  const revenue = Math.round(covers * spend);
  const foodCost = Math.round(covers * plate * city.costIndex ** 0.6 * pl * (f.fresh ? K.FRESH_FOOD_COST : 1) * (ctx.foodMult ?? 1));
  const speedee = 1 - K.LABOUR_EFFICIENCY_PER_10_STD * Math.max(0, (f.standardisation - K.REF_STANDARDISATION) / 10);
  // The site's own crew (P2, round 3): the standard rota at its staff quality, plus hands for the off-premise lane.
  const vat = Math.round(cal.vatPct * revenue);
  const netSales = revenue - vat;
  const crew = crewLabourPerDay(site.staffQuality) * city.costIndex * pl * offPremiseLabour(site, brand) * speedee;
  const scale = Math.max(0.3, covers / cal.coversMean);
  const fixed = cal.overheadsFixed * city.costIndex * pl * scale ** K.OVERHEAD_SCALE_EXP + cal.cardFeePct * revenue;
  // Round 5 review: maturity drag on the margin above a healthy level (constants MATURE_*).
  const excess = m > 0 && netSales > 0 ? Math.max(0, netSales - foodCost - crew - fixed - K.MATURE_FLOOR * netSales) : 0;
  const drag = m * K.MATURE_TAKE * excess;
  // In-N-Out (fresh) runs flat: managers promoted from the crew, no area-manager layer, so no company extra.
  const companyExtra = site.ownership === "company" && !f.fresh ? m * K.MATURE_COMPANY_EXTRA * netSales : 0;
  const labourCost = Math.round(crew + drag / 2 + companyExtra);
  const overheads = Math.round(fixed + drag / 2);
  return { siteId: site.id, covers, revenue, vat, foodCost, labourCost, overheads, contribution: revenue - vat - foodCost - labourCost - overheads };
}

/** Maps the focused restaurant's DayResult into the aggregate shape (food includes prep waste and spoilage). */
export function siteDayFromResult(siteId: string, r: DayResult): SiteDayResult {
  const foodCost = r.foodCost + r.waste.prep + r.waste.spoil;
  const overheads = (r.overheads ?? 0) + (r.incidentCosts ?? 0);
  const vat = r.vat ?? 0;
  return { siteId, covers: r.covers, revenue: r.revenue, vat, foodCost, labourCost: r.labourCost, overheads, contribution: r.revenue - vat - foodCost - r.labourCost - overheads };
}
