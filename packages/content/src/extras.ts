/**
 * Round 3 extras: path content that is not part of sim-core's ContentPack contract.
 * Types live here (not in sim-core/types.ts) so nothing in sim-core changes. Everything is plain JSON.
 */
import type { ContentPack, DishId, IngredientId, Pence, StaffRole } from "@full-plate/sim-core";

// ───────── dish tags and library visibility ─────────
export type DishTag =
  | "fast_food" | "counter_service" | "breakfast" | "kids_meal" | "shake" | "fries" | "wrap" | "burger" | "vegetarian"
  | "fine_dining" | "signature_candidate" | "seasonal" | "wine"
  | "amuse" | "starter_course" | "fish_course" | "meat_course" | "pre_dessert" | "dessert_course" | "cheese_course";
export const DISH_TAGS: readonly DishTag[] = [
  "fast_food", "counter_service", "breakfast", "kids_meal", "shake", "fries", "wrap", "burger", "vegetarian",
  "fine_dining", "signature_candidate", "seasonal", "wine",
  "amuse", "starter_course", "fish_course", "meat_course", "pre_dessert", "dessert_course", "cheese_course",
];
export type DishTags = Record<DishId, DishTag[]>;

// ───────── Path A: formulas ─────────
export type DietaryRule = "no-beef" | "no-pork" | "halal" | "kosher";
export const DIETARY_RULES: readonly DietaryRule[] = ["no-beef", "no-pork", "halal", "kosher"];

/** A preset standard menu the Empire's "lock formula" step can offer (maps onto SET_FORMULA). */
export interface FormulaDef {
  id: string;
  name: string;
  blurb: string;
  pitch: string;
  menuDishIds: DishId[];
  /** Multiple of suggestedPrice (SET_FORMULA.priceIndex). */
  priceIndex: number;
  /** SET_FORMULA.fresh (In-N-Out style). */
  fresh: boolean;
  driveThruFriendly: boolean;
  /** Rules this menu already satisfies without LOCALISE_MENU (validated against countries.dietaryBreakers). */
  dietarySafe?: DietaryRule[];
}

// ───────── Path B: tasting menus and wine ─────────
export type TastingCourse = "amuse" | "starter" | "fish" | "meat" | "pre_dessert" | "dessert" | "cheese";
export interface TastingMenuDef {
  id: string;
  name: string;
  blurb: string;
  /** Months 1-12 the menu is meant for (its seasonal ingredients are in season). */
  months: number[];
  courses: { course: TastingCourse; dishId: DishId }[];
  /** Glass dish ids, poured in order. */
  winePairing: DishId[];
  pricePerHead: Pence;
  pairingPrice: Pence;
}
export interface WineDef {
  id: string;
  name: string;
  region: string;
  /** The by-the-glass dish this bottle pours (a DishDef in fullContent). */
  glassDishId: DishId;
  bottleCost: Pence;
  bottlePrice: Pence;
  note: string;
}

// ───────── world (mirrors sim-empire src/world.ts) ─────────
export interface RegionDef { id: string; name: string; commissary: boolean; x: number; y: number; blurb: string }
/** sim-empire City minus runtime flags (entered, localised, tradition, exited). */
export interface CityDef {
  id: string;
  name: string;
  country: string;
  regionId: string;
  population: number;
  /** sim-core district ids; filter against the pack's districts as sim-empire defaultCities() does. */
  districts: string[];
  costIndex: number;
  dietaryRules: DietaryRule[];
  localChampion?: string;
  championStrength: number;
  x: number;
  y: number;
  blurb: string;
}
/** sim-empire Supplier minus runtime flags (signed, exclusive, signedDay). */
export interface SupplierDef {
  id: string;
  name: string;
  category: string;
  discountPct: number;
  failureRisk: number;
  ingredientIds: IngredientId[];
  blurb: string;
}
export interface WorldData { regions: RegionDef[]; cities: CityDef[]; suppliers: SupplierDef[] }

export interface CountryDef {
  id: string;
  /** Matches CityDef.country. */
  name: string;
  regionId: string;
  dietaryRules: DietaryRule[];
  home?: boolean;
  currencyNote?: string;
  /** Player-facing rule lines for the country-entry puzzle. */
  rules: string[];
  entryText: string;
}
export interface CountriesData {
  countries: CountryDef[];
  dietaryRules: Record<DietaryRule, { name: string; short: string; explain: string }>;
  dietaryBreakers: Record<DietaryRule, IngredientId[]>;
  kosherMeat: IngredientId[];
  kosherDairy: IngredientId[];
  puzzleLines: Record<string, string>;
}

// ───────── Stars text ─────────
export interface CriticText {
  guideNames: { michelin: string; fiftyBest: string; gaultMillau: string; goodFood: string; starWord: string; starsWord: string };
  criticNames: string[];
  /** Keyed "1".."5". */
  localCritic: Record<string, string[]>;
  inspectorRumours: string[];
  inspectionSeason: string;
  guideDay: {
    envelope: string;
    gained: string[]; gainedFirst: string[]; gainedThird: string[];
    kept: string[]; lost: string[]; lostAll: string[]; notAssessed: string[]; stillNone: string[];
    excluded: string;
  };
  fiftyBest: Record<"entered" | "climbed" | "fell" | "held" | "dropped" | "numberOne" | "hallOfFame", string>;
  gaultMillau: Record<"announce" | "up" | "down" | "top" | "toqueNote", string>;
  goodFood: Record<"listed" | "up" | "down" | "notListed", string>;
  headChef: {
    stressWarning: string[]; burnout: string[]; wantsOwnPlace: string[];
    backChoice: string; letGoChoice: string; backed: string; leftForRival: string; newHeadChef: string; rivalStar: string;
  };
  endings: Record<"elBulli" | "dynasty" | "handedBack", { title: string; body: string[] }>;
}

// ───────── Career text ─────────
export type OwnerPersonality = "balanced" | "cheap" | "premium";
export type ReviewBand = "great" | "good" | "ok" | "poor";
export type CareerTrackId = "chef" | "bar" | "waiter" | "manager";
export interface CareerText {
  ownerReview: Record<OwnerPersonality, Record<ReviewBand, string[]>> & { bands: Record<ReviewBand, number> };
  /** promotion[track][rungId] for every rung above 0, plus shared lines. */
  promotion: Record<CareerTrackId, Record<string, { title: string; copy: string }>> & {
    granted: string[]; notYet: string[]; givenToSomeoneElse: string; topRung: string;
  };
  mentor: Record<CareerTrackId, string[]> & { offer: string; session: string; busy: string };
  offers: { pitch: Record<OwnerPersonality, string[]>; letter: string; accepted: string; declined: string; expired: string };
  raise: { granted: string[]; small: string[]; refused: string[]; annoyed: string[]; matchedOffer: string };
  openOwnPlace: { ready: string; notReady: string; farewell: string[]; handover: string[]; perks: Record<string, string> };
}

// ───────── relocated sim-core text (same keys as sim-core incidents/text.ts and goals/text.ts) ─────────
export interface IncidentOptionText { label: string; description: string; outcome: string }
export interface IncidentTextData {
  INCIDENT_TEXT: Record<string, { title: string; body: string; options: Record<string, IncidentOptionText>; ignored: string }>;
  INCIDENT_LINES: Record<string, string>;
}
export interface GoalDefData {
  id: string; kind: string; tier: number; title: string; hint: string;
  target: number | "tablesPlus2"; role?: StaffRole; reward?: { cash?: number; popularity?: number };
}
export interface GoalTextData { GOAL_LADDER: GoalDefData[]; GOAL_LINES: Record<string, string> }

export interface Extras {
  dishTags: DishTags;
  libraryHidden: DishId[];
  formulas: FormulaDef[];
  tastingMenus: TastingMenuDef[];
  wineList: WineDef[];
  world: WorldData;
  countries: CountriesData;
  criticText: CriticText;
  careerText: CareerText;
  incidentText: IncidentTextData;
  goalText: GoalTextData;
}

// ───────── placeholders allowed per collection ─────────
export const PLACEHOLDERS = {
  critic: ["restaurant", "dish", "critic", "chef", "stars", "starWord", "rank", "points", "tier", "city", "guide"],
  career: ["name", "owner", "restaurant", "rung", "nextRung", "wage", "raise", "mentor", "rival", "savings", "shifts", "pitch"],
  countries: ["city", "rules", "cost", "champion", "brand", "country"],
  incident: ["name", "dish", "ingredient", "size", "cost", "missing", "table", "stars"],
  goal: ["target", "title", "reward"],
} as const;

/** Fills {placeholders}; unknown ones are left as-is (same behaviour as sim-core's incidents `fill`). */
export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

// ───────── validation ─────────
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Walks every string in a JSON value, calling `f(path, s)`. Keys starting with "_" are notes and skipped. */
function eachString(v: unknown, path: string, f: (path: string, s: string) => void): void {
  if (typeof v === "string") f(path, v);
  else if (Array.isArray(v)) v.forEach((x, i) => eachString(x, `${path}[${i}]`, f));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) eachString(x, `${path}.${k}`, f);
}
function checkPlaceholders(p: string[], name: string, v: unknown, allowed: readonly string[]): void {
  eachString(v, name, (path, s) => {
    for (const m of s.match(/\{[^}]*\}/g) ?? []) if (!allowed.includes(m.slice(1, -1))) p.push(`${path}: unknown placeholder ${m}`);
    if (/[{}]/.test(s.replace(/\{\w+\}/g, ""))) p.push(`${path}: unbalanced brace`);
  });
}
function nonEmptyStrings(p: string[], at: string, v: unknown): void {
  if (!Array.isArray(v) || v.length === 0 || !v.every(isStr)) p.push(`${at}: expected a non-empty array of strings`);
}
function uniqueIds(p: string[], name: string, xs: { id: string }[]): Set<string> {
  const s = new Set<string>();
  for (const x of xs) {
    if (!isStr(x.id)) p.push(`${name}: item without an id`);
    else if (s.has(x.id)) p.push(`${name}: duplicate id "${x.id}"`);
    s.add(x.id);
  }
  return s;
}
const costOf = (pack: ContentPack, dishId: string): number => {
  const cost = new Map(pack.ingredients.map((i) => [i.id, i.unitCost]));
  const d = pack.dishes.find((x) => x.id === dishId);
  return d ? d.ingredients.reduce((a, x) => a + (cost.get(x.id) ?? 0) * x.qty, 0) : NaN;
};

/** True when a dish breaks a dietary rule, using countries.dietaryBreakers (kosher also forbids meat with dairy). */
export function dishBreaksRule(pack: ContentPack, countries: CountriesData, dishId: DishId, rule: DietaryRule): boolean {
  const d = pack.dishes.find((x) => x.id === dishId);
  if (!d) return false;
  const ings = d.ingredients.map((i) => i.id);
  if (ings.some((i) => countries.dietaryBreakers[rule]?.includes(i))) return true;
  return rule === "kosher" && ings.some((i) => countries.kosherMeat.includes(i)) && ings.some((i) => countries.kosherDairy.includes(i));
}

/**
 * Validates the extras against the FULL pack (library + hidden dishes). Returns human-readable problems; empty = valid.
 */
export function validateExtras(x: Extras, pack: ContentPack): string[] {
  const p: string[] = [];
  const dishIds = new Set(pack.dishes.map((d) => d.id));
  const ingredientIds = new Set(pack.ingredients.map((i) => i.id));
  const districtIds = new Set(pack.districts.map((d) => d.id));
  const dish = (id: string) => pack.dishes.find((d) => d.id === id);
  const needDish = (at: string, id: unknown) => {
    if (!isStr(id) || !dishIds.has(id)) p.push(`${at}: unknown dish ${JSON.stringify(id)}`);
  };

  // dish tags
  for (const [id, tags] of Object.entries(x.dishTags)) {
    needDish(`dishTags.${id}`, id);
    if (!Array.isArray(tags) || tags.length === 0) p.push(`dishTags.${id}: expected a non-empty array`);
    else for (const t of tags) if (!DISH_TAGS.includes(t)) p.push(`dishTags.${id}: unknown tag "${t}"`);
    if (Array.isArray(tags) && tags.includes("fast_food") && tags.includes("fine_dining")) p.push(`dishTags.${id}: both fast_food and fine_dining`);
  }
  const tagged = (t: DishTag) => Object.entries(x.dishTags).filter(([, ts]) => ts.includes(t)).map(([id]) => id);
  for (const id of [...tagged("fast_food"), ...tagged("fine_dining")]) {
    const d = dish(id);
    if (!d) continue;
    const c = costOf(pack, id);
    if (!(d.suggestedPrice > c)) p.push(`dishTags.${id}: no positive margin at suggested price (${d.suggestedPrice} vs cost ${Math.round(c)})`);
  }
  for (const id of tagged("fast_food")) {
    const d = dish(id);
    if (!d) continue;
    if (d.skillRequired < 10 || d.skillRequired > 30) p.push(`${id}: fast_food skillRequired ${d.skillRequired} outside 10–30`);
    if (d.prepTicks > 2) p.push(`${id}: fast_food prepTicks ${d.prepTicks} > 2`);
    if (d.course !== "drink" && (d.qualityCeiling < 55 || d.qualityCeiling > 75)) p.push(`${id}: fast_food qualityCeiling ${d.qualityCeiling} outside 55–75`);
    if (!["american", "cafe"].includes(d.cuisine)) p.push(`${id}: fast_food cuisine should be american or cafe`);
  }
  for (const id of tagged("fine_dining").filter((i) => !x.dishTags[i]!.includes("wine"))) {
    const d = dish(id);
    if (!d) continue;
    if (d.skillRequired < 65 || d.skillRequired > 90) p.push(`${id}: fine_dining skillRequired ${d.skillRequired} outside 65–90`);
    if (d.prepTicks < 3 || d.prepTicks > 6) p.push(`${id}: fine_dining prepTicks ${d.prepTicks} outside 3–6`);
    if (d.qualityCeiling < 88 || d.qualityCeiling > 98) p.push(`${id}: fine_dining qualityCeiling ${d.qualityCeiling} outside 88–98`);
  }

  // library hidden
  for (const id of x.libraryHidden) needDish("libraryHidden", id);
  if (new Set(x.libraryHidden).size !== x.libraryHidden.length) p.push("libraryHidden: duplicate ids");

  // formulas
  uniqueIds(p, "formulas", x.formulas);
  x.formulas.forEach((f) => {
    const at = `formulas[${f.id}]`;
    for (const k of ["name", "blurb", "pitch"] as const) if (!isStr(f[k])) p.push(`${at}.${k}: expected a string`);
    if (!Array.isArray(f.menuDishIds) || f.menuDishIds.length < 4) p.push(`${at}.menuDishIds: expected at least 4 dishes`);
    else {
      f.menuDishIds.forEach((id) => {
        needDish(`${at}.menuDishIds`, id);
        if (dishIds.has(id) && !x.dishTags[id]?.includes("fast_food")) p.push(`${at}: ${id} is not tagged fast_food`);
      });
      if (new Set(f.menuDishIds).size !== f.menuDishIds.length) p.push(`${at}.menuDishIds: duplicates`);
      if (f.menuDishIds.length > 8) p.push(`${at}.menuDishIds: more than 8 dishes costs standardisation in sim-empire`);
      if (!f.menuDishIds.some((id) => dish(id)?.course === "main")) p.push(`${at}: needs a main`);
    }
    if (!isNum(f.priceIndex) || f.priceIndex < 0.5 || f.priceIndex > 2) p.push(`${at}.priceIndex: expected 0.5..2`);
    for (const r of f.dietarySafe ?? []) {
      if (!DIETARY_RULES.includes(r)) p.push(`${at}.dietarySafe: unknown rule "${r}"`);
      else for (const id of f.menuDishIds) if (dishBreaksRule(pack, x.countries, id, r)) p.push(`${at}: claims ${r}-safe but ${id} breaks it`);
    }
  });

  // tasting menus
  uniqueIds(p, "tastingMenus", x.tastingMenus);
  x.tastingMenus.forEach((m) => {
    const at = `tastingMenus[${m.id}]`;
    if (!isStr(m.name) || !isStr(m.blurb)) p.push(`${at}: needs name and blurb`);
    if (!Array.isArray(m.months) || m.months.length === 0 || !m.months.every((n) => Number.isInteger(n) && n >= 1 && n <= 12)) p.push(`${at}.months: expected months 1-12`);
    const courses = m.courses.map((c) => c.course);
    for (const need of ["amuse", "fish", "meat", "pre_dessert", "dessert"] as const) if (!courses.includes(need)) p.push(`${at}: missing ${need} course`);
    let food = 0;
    for (const c of m.courses) {
      needDish(`${at}.courses`, c.dishId);
      if (dishIds.has(c.dishId) && !x.dishTags[c.dishId]?.includes("fine_dining")) p.push(`${at}: ${c.dishId} is not tagged fine_dining`);
      food += costOf(pack, c.dishId) || 0;
    }
    let wine = 0;
    for (const w of m.winePairing) {
      needDish(`${at}.winePairing`, w);
      if (dishIds.has(w) && !x.dishTags[w]?.includes("wine")) p.push(`${at}.winePairing: ${w} is not a wine`);
      wine += costOf(pack, w) || 0;
    }
    if (!(m.pricePerHead > food)) p.push(`${at}: pricePerHead ${m.pricePerHead} does not cover food cost ${Math.round(food)}`);
    if (!(m.pairingPrice > wine)) p.push(`${at}: pairingPrice ${m.pairingPrice} does not cover wine cost ${Math.round(wine)}`);
    // in season: every seasonal ingredient in the menu must be in season in at least one of its months
    for (const c of m.courses) {
      const d = dish(c.dishId);
      for (const ing of d?.ingredients ?? []) {
        const s = pack.ingredients.find((i) => i.id === ing.id)?.seasonality;
        if (s && !m.months.some((mo) => s.includes(mo))) p.push(`${at}: ${ing.id} (in ${c.dishId}) is never in season in months ${m.months.join(",")}`);
      }
    }
  });

  // wine list
  uniqueIds(p, "wineList", x.wineList);
  x.wineList.forEach((w) => {
    const at = `wineList[${w.id}]`;
    if (!isStr(w.region) || !isStr(w.note) || !isStr(w.name)) p.push(`${at}: needs name, region and note`);
    needDish(`${at}.glassDishId`, w.glassDishId);
    const mk = w.bottlePrice / w.bottleCost;
    if (!(mk >= 2.5 && mk <= 4)) p.push(`${at}: bottle markup ${mk.toFixed(2)}× outside 2.5–4×`);
  });

  // world
  const regionIds = uniqueIds(p, "regions", x.world.regions);
  const cityIds = uniqueIds(p, "cities", x.world.cities);
  const countryNames = new Set(x.countries.countries.map((c) => c.name));
  x.world.cities.forEach((c) => {
    const at = `cities[${c.id}]`;
    if (!regionIds.has(c.regionId)) p.push(`${at}: unknown region "${c.regionId}"`);
    if (!countryNames.has(c.country)) p.push(`${at}: country "${c.country}" missing from countries.json`);
    if (!isNum(c.population) || c.population <= 0) p.push(`${at}.population: expected > 0`);
    if (!isNum(c.costIndex) || c.costIndex <= 0 || c.costIndex > 3) p.push(`${at}.costIndex: expected 0..3`);
    if (!isNum(c.championStrength) || c.championStrength < 0 || c.championStrength > 1) p.push(`${at}.championStrength: expected 0..1`);
    if ((c.championStrength > 0) !== isStr(c.localChampion)) p.push(`${at}: championStrength and localChampion must go together`);
    if (!isStr(c.blurb)) p.push(`${at}.blurb: expected a string`);
    if (!Array.isArray(c.districts) || !c.districts.some((d) => districtIds.has(d))) p.push(`${at}.districts: needs at least one known district`);
    for (const d of c.districts) if (!districtIds.has(d)) p.push(`${at}.districts: unknown district "${d}"`);
    for (const r of c.dietaryRules) if (!DIETARY_RULES.includes(r)) p.push(`${at}.dietaryRules: unknown "${r}"`);
    const country = x.countries.countries.find((k) => k.name === c.country);
    if (country && [...c.dietaryRules].sort().join() !== [...country.dietaryRules].sort().join()) p.push(`${at}: dietaryRules differ from its country ${country.name}`);
  });
  for (const r of x.world.regions) if (!x.world.cities.some((c) => c.regionId === r.id)) p.push(`regions[${r.id}]: has no cities`);
  if (cityIds.size === 0) p.push("cities: empty");
  uniqueIds(p, "suppliers", x.world.suppliers);
  x.world.suppliers.forEach((s) => {
    const at = `suppliers[${s.id}]`;
    if (!(s.discountPct > 0 && s.discountPct < 0.5)) p.push(`${at}.discountPct: expected 0..0.5`);
    if (!(s.failureRisk >= 0 && s.failureRisk < 1)) p.push(`${at}.failureRisk: expected 0..1`);
    for (const i of s.ingredientIds) if (!ingredientIds.has(i)) p.push(`${at}: unknown ingredient "${i}"`);
  });

  // countries
  uniqueIds(p, "countries", x.countries.countries);
  x.countries.countries.forEach((c) => {
    const at = `countries[${c.id}]`;
    if (!regionIds.has(c.regionId)) p.push(`${at}: unknown region "${c.regionId}"`);
    nonEmptyStrings(p, `${at}.rules`, c.rules);
    if (!isStr(c.entryText)) p.push(`${at}.entryText: expected a string`);
    for (const r of c.dietaryRules) if (!DIETARY_RULES.includes(r)) p.push(`${at}.dietaryRules: unknown "${r}"`);
  });
  for (const r of DIETARY_RULES) {
    if (!x.countries.dietaryRules[r]) p.push(`countries.dietaryRules: missing ${r}`);
    for (const i of x.countries.dietaryBreakers[r] ?? []) if (!ingredientIds.has(i)) p.push(`countries.dietaryBreakers.${r}: unknown ingredient "${i}"`);
  }
  for (const i of [...x.countries.kosherMeat, ...x.countries.kosherDairy]) if (!ingredientIds.has(i)) p.push(`countries.kosher*: unknown ingredient "${i}"`);
  checkPlaceholders(p, "countries", x.countries, PLACEHOLDERS.countries);

  // critic text
  const ct = x.criticText;
  for (const k of ["1", "2", "3", "4", "5"]) nonEmptyStrings(p, `criticText.localCritic.${k}`, ct.localCritic?.[k]);
  if (Object.keys(ct.localCritic ?? {}).some((k) => !["1", "2", "3", "4", "5"].includes(k))) p.push("criticText.localCritic: unknown rating key");
  nonEmptyStrings(p, "criticText.criticNames", ct.criticNames);
  nonEmptyStrings(p, "criticText.inspectorRumours", ct.inspectorRumours);
  for (const k of ["gained", "gainedFirst", "gainedThird", "kept", "lost", "lostAll", "notAssessed", "stillNone"] as const) nonEmptyStrings(p, `criticText.guideDay.${k}`, ct.guideDay?.[k]);
  for (const k of ["elBulli", "dynasty", "handedBack"] as const) {
    if (!isStr(ct.endings?.[k]?.title)) p.push(`criticText.endings.${k}.title: expected a string`);
    nonEmptyStrings(p, `criticText.endings.${k}.body`, ct.endings?.[k]?.body);
  }
  nonEmptyStrings(p, "criticText.headChef.wantsOwnPlace", ct.headChef?.wantsOwnPlace);
  checkPlaceholders(p, "criticText", ct, PLACEHOLDERS.critic);

  // career text
  const cr = x.careerText;
  for (const o of ["balanced", "cheap", "premium"] as const) {
    for (const b of ["great", "good", "ok", "poor"] as const) nonEmptyStrings(p, `careerText.ownerReview.${o}.${b}`, cr.ownerReview?.[o]?.[b]);
    nonEmptyStrings(p, `careerText.offers.pitch.${o}`, cr.offers?.pitch?.[o]);
  }
  const bands = cr.ownerReview?.bands;
  if (!bands || !(bands.great > bands.good && bands.good > bands.ok && bands.ok > bands.poor)) p.push("careerText.ownerReview.bands: expected great > good > ok > poor");
  for (const t of ["chef", "bar", "waiter", "manager"] as const) {
    nonEmptyStrings(p, `careerText.mentor.${t}`, cr.mentor?.[t]);
    const rungs = cr.promotion?.[t];
    if (!isObj(rungs) || Object.keys(rungs).length === 0) p.push(`careerText.promotion.${t}: expected rung copy`);
    else for (const [id, r] of Object.entries(rungs)) if (!isStr(r?.title) || !isStr(r?.copy)) p.push(`careerText.promotion.${t}.${id}: needs title and copy`);
  }
  nonEmptyStrings(p, "careerText.openOwnPlace.handover", cr.openOwnPlace?.handover);
  checkPlaceholders(p, "careerText", cr, PLACEHOLDERS.career);

  // relocated sim-core text
  for (const [kind, t] of Object.entries(x.incidentText.INCIDENT_TEXT ?? {})) {
    if (!isStr(t.title) || !isStr(t.body) || !isStr(t.ignored)) p.push(`incidentText.${kind}: needs title, body, ignored`);
    if (!isObj(t.options) || Object.keys(t.options).length < 2) p.push(`incidentText.${kind}.options: expected 2+ options`);
  }
  checkPlaceholders(p, "incidentText", x.incidentText, PLACEHOLDERS.incident);
  uniqueIds(p, "goalText.GOAL_LADDER", x.goalText.GOAL_LADDER ?? []);
  checkPlaceholders(p, "goalText", x.goalText, PLACEHOLDERS.goal);

  return p;
}
