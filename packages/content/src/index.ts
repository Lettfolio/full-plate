/**
 * @full-plate/content — static game data for Full Plate.
 *
 * Loads every collection from data/*.json, validates it with hand-written guards
 * (no runtime deps), and exports the result as a typed ContentPack.
 * Importing this module throws if the shipped data is invalid, listing every problem.
 */
import type {
  BalanceDef,
  ContentPack,
  DishDef,
  DistrictDef,
  EventDef,
  IngredientDef,
  SegmentDef,
  StaffArchetypeDef,
  TraitDef,
} from "@full-plate/sim-core";

import ingredientsJson from "../data/ingredients.json";
import dishesJson from "../data/dishes.json";
import segmentsJson from "../data/segments.json";
import districtsJson from "../data/districts.json";
import staffArchetypesJson from "../data/staffArchetypes.json";
import traitsJson from "../data/traits.json";
import eventsJson from "../data/events.json";
import balanceJson from "../data/balance.json";
import reviewTemplatesJson from "../data/reviewTemplates.json";

const SERVICE_TICKS = 120; // mirrors sim-core SERVICE_TICKS; kept local so this file imports types only
const COURSES = ["starter", "main", "dessert", "drink", "side"];
const CUISINES = ["british", "italian", "american", "asian", "french", "cafe"];
const ROLES = ["chef", "server", "bar", "porter", "manager"];
const TRAIT_EFFECT_KEYS = ["skill", "speed", "charm", "moodDecay", "wageDemand", "mistakeRate"];
const EVENT_WHEN_KEYS = ["minDay", "maxDay", "minCash", "maxCash", "minPopularity", "minPrestige", "month"];
const EVENT_EFFECT_KEYS = ["cash", "popularity", "prestige", "staffMood", "footfallMultDays"];
/** UK National Living Wage (21+) from April 2026, in pence per hour. */
export const NATIONAL_LIVING_WAGE: number = 1271;
const SUM_TOLERANCE = 0.01;
const REVIEW_KEYS = ["1", "2", "3", "4", "5"];
const REVIEW_PLACEHOLDERS = ["{dish}", "{restaurant}", "{segment}"];

// ───────── small guards ─────────
type Problems = string[];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function num(p: Problems, where: string, v: unknown, min: number, max: number, integer = false): v is number {
  if (!isNum(v) || (integer && !isInt(v))) {
    p.push(`${where}: expected ${integer ? "an integer" : "a number"}, got ${JSON.stringify(v)}`);
    return false;
  }
  if (v < min || v > max) {
    p.push(`${where}: ${v} is outside ${min}..${max}`);
    return false;
  }
  return true;
}
function str(p: Problems, where: string, v: unknown): v is string {
  if (!isStr(v)) p.push(`${where}: expected a non-empty string, got ${JSON.stringify(v)}`);
  return isStr(v);
}
function oneOf(p: Problems, where: string, v: unknown, allowed: string[]) {
  if (typeof v !== "string" || !allowed.includes(v)) p.push(`${where}: ${JSON.stringify(v)} is not one of ${allowed.join(", ")}`);
}
function range(p: Problems, where: string, v: unknown, min: number, max: number, integer = false) {
  if (!Array.isArray(v) || v.length !== 2) {
    p.push(`${where}: expected [min, max]`);
    return;
  }
  const okA = num(p, `${where}[0]`, v[0], min, max, integer);
  const okB = num(p, `${where}[1]`, v[1], min, max, integer);
  if (okA && okB && (v[0] as number) > (v[1] as number)) p.push(`${where}: min ${v[0]} > max ${v[1]}`);
}
function list(p: Problems, name: string, v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) {
    p.push(`${name}: expected an array`);
    return [];
  }
  if (v.length === 0) p.push(`${name}: is empty`);
  return v.filter((x, i) => {
    if (!isObj(x)) p.push(`${name}[${i}]: expected an object`);
    return isObj(x);
  }) as Record<string, unknown>[];
}
function ids(p: Problems, name: string, items: Record<string, unknown>[]): Set<string> {
  const seen = new Set<string>();
  items.forEach((x, i) => {
    if (!str(p, `${name}[${i}].id`, x.id)) return;
    if (seen.has(x.id)) p.push(`${name}: duplicate id "${x.id}"`);
    seen.add(x.id);
  });
  return seen;
}
const label = (name: string, x: Record<string, unknown>, i: number) => `${name}[${isStr(x.id) ? x.id : i}]`;

// ───────── validation ─────────
/**
 * Validate a content pack. Returns a list of human-readable problems; empty means valid.
 * Accepts `unknown` so it can check raw JSON as well as typed packs.
 */
export function validateContent(pack: unknown): string[] {
  const p: Problems = [];
  if (!isObj(pack)) return ["content pack: expected an object"];

  // ingredients
  const ingredients = list(p, "ingredients", pack.ingredients);
  const ingredientIds = ids(p, "ingredients", ingredients);
  ingredients.forEach((x, i) => {
    const at = label("ingredients", x, i);
    str(p, `${at}.name`, x.name);
    num(p, `${at}.unitCost`, x.unitCost, 0, 1_000_000, true);
    num(p, `${at}.shelfLifeDays`, x.shelfLifeDays, 1, 3650, true);
    if (x.seasonality !== undefined) {
      if (!Array.isArray(x.seasonality) || x.seasonality.length === 0) p.push(`${at}.seasonality: expected a non-empty array of months`);
      else x.seasonality.forEach((m, j) => num(p, `${at}.seasonality[${j}]`, m, 1, 12, true));
    }
  });
  const costOf = new Map(ingredients.map((x) => [x.id as string, isNum(x.unitCost) ? x.unitCost : 0]));

  // segments
  const segments = list(p, "segments", pack.segments);
  const segmentIds = ids(p, "segments", segments);
  segments.forEach((x, i) => {
    const at = label("segments", x, i);
    str(p, `${at}.name`, x.name);
    num(p, `${at}.priceSensitivity`, x.priceSensitivity, 0, 1);
    num(p, `${at}.qualityWeight`, x.qualityWeight, 0, 1);
    num(p, `${at}.speedWeight`, x.speedWeight, 0, 1);
    num(p, `${at}.averageBudget`, x.averageBudget, 1, 1_000_000, true);
    num(p, `${at}.tipRate`, x.tipRate, 0, 0.2);
    if (!Array.isArray(x.partySizeWeights) || x.partySizeWeights.length === 0) p.push(`${at}.partySizeWeights: expected a non-empty array`);
    else {
      x.partySizeWeights.forEach((v, j) => num(p, `${at}.partySizeWeights[${j}]`, v, 0, 1000));
      if (sum(x.partySizeWeights.filter(isNum)) <= 0) p.push(`${at}.partySizeWeights: weights must not all be zero`);
    }
    if (!Array.isArray(x.arrivalCurve) || x.arrivalCurve.length !== SERVICE_TICKS) {
      p.push(`${at}.arrivalCurve: expected length ${SERVICE_TICKS}, got ${Array.isArray(x.arrivalCurve) ? x.arrivalCurve.length : "non-array"}`);
    } else {
      x.arrivalCurve.forEach((v, j) => num(p, `${at}.arrivalCurve[${j}]`, v, 0, 1));
      const s = sum(x.arrivalCurve.filter(isNum));
      if (Math.abs(s - 1) > SUM_TOLERANCE) p.push(`${at}.arrivalCurve: sums to ${s.toFixed(4)}, expected ≈1`);
    }
  });

  const checkSegmentRecord = (at: string, rec: unknown, min: number, max: number): number[] => {
    if (!isObj(rec)) {
      p.push(`${at}: expected an object keyed by segment id`);
      return [];
    }
    for (const k of Object.keys(rec)) if (!segmentIds.has(k)) p.push(`${at}: unknown segment "${k}"`);
    const vals: number[] = [];
    for (const s of segmentIds) {
      if (!(s in rec)) p.push(`${at}: missing segment "${s}"`);
      else if (num(p, `${at}.${s}`, rec[s], min, max)) vals.push(rec[s] as number);
    }
    return vals;
  };

  // dishes
  const dishes = list(p, "dishes", pack.dishes);
  ids(p, "dishes", dishes);
  dishes.forEach((x, i) => {
    const at = label("dishes", x, i);
    str(p, `${at}.name`, x.name);
    oneOf(p, `${at}.course`, x.course, COURSES);
    oneOf(p, `${at}.cuisine`, x.cuisine, CUISINES);
    num(p, `${at}.prepTicks`, x.prepTicks, 1, 12, true);
    num(p, `${at}.skillRequired`, x.skillRequired, 0, 100);
    num(p, `${at}.qualityCeiling`, x.qualityCeiling, 0, 100);
    const priceOk = num(p, `${at}.suggestedPrice`, x.suggestedPrice, 1, 1_000_000, true);
    if (x.blurb !== undefined && typeof x.blurb !== "string") p.push(`${at}.blurb: expected a string`);
    checkSegmentRecord(`${at}.baseAppeal`, x.baseAppeal, 0, 1);
    let cost = 0;
    if (!Array.isArray(x.ingredients) || x.ingredients.length === 0) p.push(`${at}.ingredients: expected a non-empty array`);
    else
      x.ingredients.forEach((ing: unknown, j) => {
        if (!isObj(ing)) return p.push(`${at}.ingredients[${j}]: expected an object`);
        if (!isStr(ing.id) || !ingredientIds.has(ing.id)) p.push(`${at}.ingredients[${j}]: unknown ingredient ${JSON.stringify(ing.id)}`);
        if (num(p, `${at}.ingredients[${j}].qty`, ing.qty, 0.01, 100)) cost += (costOf.get(ing.id as string) ?? 0) * (ing.qty as number);
      });
    if (priceOk && cost >= (x.suggestedPrice as number)) p.push(`${at}: suggestedPrice ${x.suggestedPrice} does not cover ingredient cost ${Math.round(cost)}`);
  });

  // districts
  const districts = list(p, "districts", pack.districts);
  ids(p, "districts", districts);
  districts.forEach((x, i) => {
    const at = label("districts", x, i);
    str(p, `${at}.name`, x.name);
    str(p, `${at}.blurb`, x.blurb);
    num(p, `${at}.monthlyRent`, x.monthlyRent, 1, 10_000_000, true);
    num(p, `${at}.depositMonths`, x.depositMonths, 0, 12);
    num(p, `${at}.footfall`, x.footfall, 1, 100_000);
    const mix = checkSegmentRecord(`${at}.segmentMix`, x.segmentMix, 0, 1);
    if (mix.length && Math.abs(sum(mix) - 1) > SUM_TOLERANCE) p.push(`${at}.segmentMix: sums to ${sum(mix).toFixed(4)}, expected 1`);
    if (!Array.isArray(x.seasonCurve) || x.seasonCurve.length !== 12) p.push(`${at}.seasonCurve: expected 12 monthly values`);
    else x.seasonCurve.forEach((v, j) => num(p, `${at}.seasonCurve[${j}]`, v, 0, 5));
  });

  // traits
  const traits = list(p, "traits", pack.traits);
  const traitIds = ids(p, "traits", traits);
  traits.forEach((x, i) => {
    const at = label("traits", x, i);
    str(p, `${at}.name`, x.name);
    str(p, `${at}.description`, x.description);
    if (!isObj(x.effects)) p.push(`${at}.effects: expected an object`);
    else
      for (const [k, v] of Object.entries(x.effects)) {
        if (!TRAIT_EFFECT_KEYS.includes(k)) p.push(`${at}.effects: unknown effect "${k}"`);
        else num(p, `${at}.effects.${k}`, v, 0.1, 3);
      }
  });

  // staff archetypes
  const archetypes = list(p, "staffArchetypes", pack.staffArchetypes);
  ids(p, "staffArchetypes", archetypes);
  archetypes.forEach((x, i) => {
    const at = label("staffArchetypes", x, i);
    oneOf(p, `${at}.role`, x.role, ROLES);
    if (!Array.isArray(x.nameSamples) || x.nameSamples.length === 0 || !x.nameSamples.every(isStr)) p.push(`${at}.nameSamples: expected a non-empty array of names`);
    range(p, `${at}.skillRange`, x.skillRange, 0, 100);
    range(p, `${at}.speedRange`, x.speedRange, 0, 100);
    range(p, `${at}.charmRange`, x.charmRange, 0, 100);
    range(p, `${at}.wageRange`, x.wageRange, 0, 100_000, true);
    if (Array.isArray(x.wageRange) && isNum(x.wageRange[0]) && x.wageRange[0] < NATIONAL_LIVING_WAGE)
      p.push(`${at}.wageRange: ${x.wageRange[0]}p/h is below the National Living Wage (${NATIONAL_LIVING_WAGE}p/h)`);
    if (!Array.isArray(x.traits) || x.traits.length === 0) p.push(`${at}.traits: expected a non-empty pool`);
    else x.traits.forEach((t) => { if (!isStr(t) || !traitIds.has(t)) p.push(`${at}.traits: unknown trait ${JSON.stringify(t)}`); });
  });

  // events
  const events = list(p, "events", pack.events);
  ids(p, "events", events);
  events.forEach((x, i) => {
    const at = label("events", x, i);
    str(p, `${at}.title`, x.title);
    str(p, `${at}.body`, x.body);
    num(p, `${at}.weight`, x.weight, 0, 1000);
    if (x.when !== undefined) {
      if (!isObj(x.when)) p.push(`${at}.when: expected an object`);
      else
        for (const [k, v] of Object.entries(x.when)) {
          if (!EVENT_WHEN_KEYS.includes(k)) p.push(`${at}.when: unknown condition "${k}"`);
          else if (k === "month") {
            if (!Array.isArray(v) || v.length === 0) p.push(`${at}.when.month: expected a non-empty array`);
            else v.forEach((m, j) => num(p, `${at}.when.month[${j}]`, m, 1, 12, true));
          } else num(p, `${at}.when.${k}`, v, -1e9, 1e9, k.endsWith("Cash") || k.endsWith("Day"));
        }
    }
    if (!Array.isArray(x.choices) || x.choices.length < 2 || x.choices.length > 3) {
      p.push(`${at}.choices: expected 2–3 choices`);
      return;
    }
    const choiceIds = new Set<string>();
    x.choices.forEach((c: unknown, j) => {
      const cat = `${at}.choices[${j}]`;
      if (!isObj(c)) return p.push(`${cat}: expected an object`);
      if (str(p, `${cat}.id`, c.id)) {
        if (choiceIds.has(c.id)) p.push(`${at}: duplicate choice id "${c.id}"`);
        choiceIds.add(c.id);
      }
      str(p, `${cat}.label`, c.label);
      if (!isObj(c.effects)) return p.push(`${cat}.effects: expected an object`);
      for (const [k, v] of Object.entries(c.effects)) {
        if (!EVENT_EFFECT_KEYS.includes(k)) p.push(`${cat}.effects: unknown effect "${k}"`);
        else if (k === "cash") num(p, `${cat}.effects.cash`, v, -10_000_000, 10_000_000, true);
        else if (k === "footfallMultDays") {
          if (!isObj(v)) p.push(`${cat}.effects.footfallMultDays: expected { mult, days }`);
          else {
            num(p, `${cat}.effects.footfallMultDays.mult`, v.mult, 0, 5);
            num(p, `${cat}.effects.footfallMultDays.days`, v.days, 1, 365, true);
          }
        } else num(p, `${cat}.effects.${k}`, v, -100, 100);
      }
    });
  });

  // balance
  const b = pack.balance;
  if (!isObj(b)) p.push("balance: expected an object");
  else {
    num(p, "balance.startingCash", b.startingCash, 0, 1e10, true);
    num(p, "balance.loanPrincipal", b.loanPrincipal, 0, 1e10, true);
    num(p, "balance.loanTermDays", b.loanTermDays, 1, 36500, true);
    num(p, "balance.loanApr", b.loanApr, 0, 1);
    num(p, "balance.fitOutCost", b.fitOutCost, 0, 1e10, true);
    num(p, "balance.reputationDecay", b.reputationDecay, 0, 100);
    num(p, "balance.reviewRatePer10Covers", b.reviewRatePer10Covers, 0, 10);
    num(p, "balance.startingTables", b.startingTables, 1, 100, true);
    num(p, "balance.maxTables", b.maxTables, 1, 100, true);
    num(p, "balance.seatsPerTable", b.seatsPerTable, 1, 20, true);
    num(p, "balance.weekendFootfallMult", b.weekendFootfallMult, 0, 5);
    num(p, "balance.targetYear1Survival", b.targetYear1Survival, 0, 1);
    if (isNum(b.startingTables) && isNum(b.maxTables) && b.startingTables > b.maxTables) p.push("balance: startingTables > maxTables");
    const ws = b.wasteShares;
    if (!isObj(ws)) p.push("balance.wasteShares: expected { prep, plate, spoil }");
    else {
      const parts = ["prep", "plate", "spoil"].map((k) => (num(p, `balance.wasteShares.${k}`, ws[k], 0, 1) ? (ws[k] as number) : 0));
      if (Math.abs(sum(parts) - 1) > SUM_TOLERANCE) p.push(`balance.wasteShares: sums to ${sum(parts).toFixed(4)}, expected 1`);
    }
    // the player must be able to afford fit-out + deposit at the start
    const cheapestDeposit = Math.min(
      ...districts.map((d) => (isNum(d.monthlyRent) && isNum(d.depositMonths) ? d.monthlyRent * d.depositMonths : Infinity)),
    );
    if (isNum(b.startingCash) && isNum(b.loanPrincipal) && isNum(b.fitOutCost) && b.startingCash + b.loanPrincipal - b.fitOutCost < cheapestDeposit)
      p.push("balance: startingCash + loanPrincipal − fitOutCost cannot cover even the cheapest rent deposit");
  }

  // review templates (optional on ContentPack, always shipped here)
  if (pack.reviewTemplates !== undefined) {
    const rt = pack.reviewTemplates;
    if (!isObj(rt)) p.push("reviewTemplates: expected an object keyed \"1\"–\"5\"");
    else {
      for (const k of Object.keys(rt)) if (!REVIEW_KEYS.includes(k)) p.push(`reviewTemplates: unknown rating key "${k}"`);
      for (const k of REVIEW_KEYS) {
        const lines = rt[k];
        if (!Array.isArray(lines) || lines.length === 0) {
          p.push(`reviewTemplates.${k}: expected a non-empty array of strings`);
          continue;
        }
        lines.forEach((line, j) => {
          if (!str(p, `reviewTemplates.${k}[${j}]`, line)) return;
          for (const ph of line.match(/\{[^}]*\}/g) ?? [])
            if (!REVIEW_PLACEHOLDERS.includes(ph)) p.push(`reviewTemplates.${k}[${j}]: unknown placeholder ${ph}`);
        });
      }
    }
  }

  return p;
}

/** Assemble the shipped JSON into a pack (unvalidated). */
function assemble(): ContentPack {
  return {
    ingredients: ingredientsJson as IngredientDef[],
    dishes: dishesJson as DishDef[],
    segments: segmentsJson as SegmentDef[],
    districts: districtsJson as DistrictDef[],
    staffArchetypes: staffArchetypesJson as unknown as StaffArchetypeDef[],
    traits: traitsJson as TraitDef[],
    events: eventsJson as EventDef[],
    balance: balanceJson as BalanceDef,
    reviewTemplates: reviewTemplatesJson as Record<string, string[]>,
  };
}

/** Load and validate; throws one Error listing every problem. */
export function loadContent(): ContentPack {
  const pack = assemble();
  const problems = validateContent(pack);
  if (problems.length) {
    throw new Error(`Full Plate content is invalid (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n  - ${problems.join("\n  - ")}`);
  }
  return pack;
}

/** The validated, shipped content pack. */
export const content: ContentPack = loadContent();
export default content;

/** Ingredient cost of one plate of a dish, in pence (rounded). */
export function dishCost(pack: ContentPack, dish: DishDef): number {
  const cost = new Map(pack.ingredients.map((i) => [i.id, i.unitCost]));
  return Math.round(dish.ingredients.reduce((s, x) => s + (cost.get(x.id) ?? 0) * x.qty, 0));
}

/** Gross margin (0–1) of a dish at a given price (defaults to its suggested price). */
export function dishMargin(pack: ContentPack, dish: DishDef, price: number = dish.suggestedPrice): number {
  return (price - dishCost(pack, dish)) / price;
}

/** Dishes that only adult customers can order. The sim should never sell these to a party flagged as children. */
export const ALCOHOLIC_DISH_IDS: readonly string[] = [
  "house_wine", "fine_red", "prosecco", "lager", "local_ale", "gin_tonic", "espresso_martini",
];
