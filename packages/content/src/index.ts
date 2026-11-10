/**
 * @full-plate/content — static game data for Full Plate.
 *
 * Loads every collection from data/*.json, validates it with hand-written guards
 * (no runtime deps), and exports the result as a typed ContentPack.
 * Importing this module throws if the shipped data is invalid, listing every problem.
 */
import type {
  AdviceTextPack,
  BalanceDef,
  ContentPack,
  DecorPack,
  DishDef,
  DistrictDef,
  EventDef,
  IngredientDef,
  SegmentDef,
  StaffArchetypeDef,
  StaffTextPack,
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
import dishTagsJson from "../data/dishTags.json";
import libraryHiddenJson from "../data/libraryHidden.json";
import formulasJson from "../data/formulas.json";
import tastingMenusJson from "../data/tastingMenus.json";
import wineListJson from "../data/wineList.json";
import citiesJson from "../data/cities.json";
import countriesJson from "../data/countries.json";
import criticTextJson from "../data/criticText.json";
import careerTextJson from "../data/careerText.json";
import incidentTextJson from "../data/incidentText.json";
import goalTextJson from "../data/goalText.json";
import adviceTextJson from "../data/adviceText.json";
import decorJson from "../data/decor.json";
import staffQuotesJson from "../data/staffQuotes.json";
import type {
  CareerText, CountriesData, CriticText, DietaryRule, DishTag, DishTags, Extras, FormulaDef, GoalTextData, IncidentTextData,
  TastingMenuDef, WineDef, WorldData,
} from "./extras";
import { validateExtras } from "./extras";

export * from "./extras";
export * from "./softDrinks";

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

  // [round 6] evening tips (optional on ContentPack, always shipped here)
  if (pack.adviceText !== undefined) validateAdvice(p, pack.adviceText);
  // [round 10] decorating catalogue (optional on ContentPack, always shipped here)
  if (pack.decor !== undefined) validateDecor(p, pack.decor, Array.isArray(pack.segments) ? pack.segments.map((s) => (s as { id?: string }).id ?? "") : []);
  if (pack.staffText !== undefined) validateStaffText(p, pack.staffText, archetypes.map((a) => (isObj(a) ? a.id : undefined)));

  return p;
}

const ADVICE_KINDS = ["rota", "overstock", "dog", "idleChef", "underpriced"];
const ADVICE_TEXT_KEYS = ["icon", "title", "body", "why", "action", "fix"];
/** Placeholders each tip's words may use (sim-core advice.ts fills them). */
export const ADVICE_PLACEHOLDERS: Record<string, string[]> = {
  rota: ["name", "role", "days", "weeklyCost", "dailyLoss", "totalLoss", "shifts", "shiftCost"],
  overstock: ["ingredient", "ingredientLower", "used", "binned", "cost", "shelfLife", "days", "cut"],
  dog: ["dish", "sold", "days", "course", "courseSold", "margin", "courseMargin"],
  idleChef: ["name", "days", "weeklyCost", "plates", "soloName", "soloPeak", "soloDay"],
  underpriced: ["walkouts", "popularity", "raise", "keep", "days"],
};
/** Rule knobs: [min, max]. */
const ADVICE_RULE_RANGES: Record<string, [number, number]> = {
  cooldownDays: [0, 60], rotaRestAfter: [0, 30], overstockDays: [1, 28], overstockMinCost: [0, 1_000_000], overstockMinShare: [0, 10],
  dogDays: [2, 56], dogSoldShare: [0, 1], dogMinCourse: [2, 10], idleChefDays: [1, 28], idleChefMinDays: [1, 7], idleChefRatio: [0.1, 3],
  underpricedDays: [1, 56], underpricedPopularity: [0, 100], underpricedWalkouts: [0, 100], underpricedMaxMargin: [-1, 1],
  underpricedMaxPriceIndex: [0.5, 3], underpricedRaise: [0.01, 0.5],
};

function validateAdvice(p: Problems, at: unknown): void {
  if (!isObj(at)) {
    p.push("adviceText: expected an object");
    return;
  }
  const rules = at.rules;
  if (rules !== undefined) {
    if (!isObj(rules)) p.push("adviceText.rules: expected an object");
    else {
      for (const [k, v] of Object.entries(rules)) {
        if (k === "priority") {
          if (!Array.isArray(v) || v.some((x) => !ADVICE_KINDS.includes(x as string)) || new Set(v).size !== v.length)
            p.push(`adviceText.rules.priority: expected distinct kinds from ${ADVICE_KINDS.join(", ")}`);
          continue;
        }
        const range = ADVICE_RULE_RANGES[k];
        if (!range) p.push(`adviceText.rules: unknown rule "${k}"`);
        else num(p, `adviceText.rules.${k}`, v, range[0], range[1]);
      }
    }
  }
  const text = at.text;
  if (text === undefined) return;
  if (!isObj(text)) {
    p.push("adviceText.text: expected an object");
    return;
  }
  for (const [kind, t] of Object.entries(text)) {
    if (!ADVICE_KINDS.includes(kind)) {
      p.push(`adviceText.text: unknown kind "${kind}"`);
      continue;
    }
    if (!isObj(t)) {
      p.push(`adviceText.text.${kind}: expected an object`);
      continue;
    }
    for (const [k, v] of Object.entries(t)) {
      if (!ADVICE_TEXT_KEYS.includes(k)) p.push(`adviceText.text.${kind}: unknown key "${k}"`);
      else if (str(p, `adviceText.text.${kind}.${k}`, v)) {
        for (const ph of v.match(/\{[^}]*\}/g) ?? [])
          if (!ADVICE_PLACEHOLDERS[kind]!.includes(ph.slice(1, -1))) p.push(`adviceText.text.${kind}.${k}: unknown placeholder ${ph}`);
        for (const m of v.matchAll(/\[\[([^\]|]*)\|([^\]]*)\]\]/g)) if (!m[1] || !m[2]) p.push(`adviceText.text.${kind}.${k}: bad term ${m[0]}`);
      }
    }
  }
}

/** [round 10] Decor slots and tags (mirror sim-core DECOR_SLOTS / DecorTag). */
export const DECOR_SLOT_IDS = ["floor", "walls", "lighting", "seating", "tables", "signage", "plants", "music", "window"];
export const DECOR_TAGS = ["cosy", "smart", "fun", "posh"];
const DECOR_EFFECT_RANGES: Record<string, [number, number]> = { prestige: [0, 2], popularity: [0, 2], comfort: [0, 3], stay: [0, 2], spend: [0, 5], upkeep: [0, 1000] };
const DECOR_ITEM_KEYS = ["id", "slot", "name", "description", "price", "tags", "starter", "effects", "fitTables", "lifeDays", "refreshCost", "nightLine"];

function validateDecor(p: Problems, d: unknown, segmentIds: string[]): void {
  if (!isObj(d)) { p.push("decor: expected an object"); return; }
  str(p, "decor.plainName", d.plainName);
  str(p, "decor.mixedName", d.mixedName);
  const styles = d.styles;
  if (!isObj(styles)) p.push("decor.styles: expected an object keyed by tag");
  else for (const tag of DECOR_TAGS) {
    const st = styles[tag];
    if (!isObj(st)) { p.push(`decor.styles.${tag}: missing`); continue; }
    str(p, `decor.styles.${tag}.name`, st.name);
    if (!isObj(st.segments)) p.push(`decor.styles.${tag}.segments: expected an object`);
    else for (const [seg, v] of Object.entries(st.segments)) {
      if (!segmentIds.includes(seg)) p.push(`decor.styles.${tag}.segments: unknown segment "${seg}"`);
      num(p, `decor.styles.${tag}.segments.${seg}`, v, -0.25, 0.25);
    }
    if (st.critic !== undefined) num(p, `decor.styles.${tag}.critic`, st.critic, 0, 5, true);
  }
  if (!Array.isArray(d.items)) { p.push("decor.items: expected an array"); return; }
  const ids = new Set<string>();
  d.items.forEach((it: unknown, i) => {
    const w = `decor.items[${i}]`;
    if (!isObj(it)) { p.push(`${w}: expected an object`); return; }
    const at = isStr(it.id) ? `decor.${it.id}` : w;
    if (!str(p, `${w}.id`, it.id)) return;
    if (ids.has(it.id)) p.push(`${at}: duplicate id`);
    ids.add(it.id);
    for (const k of Object.keys(it)) if (!DECOR_ITEM_KEYS.includes(k)) p.push(`${at}: unknown key "${k}"`);
    if (!DECOR_SLOT_IDS.includes(it.slot as string)) p.push(`${at}.slot: unknown slot ${JSON.stringify(it.slot)}`);
    str(p, `${at}.name`, it.name);
    if (str(p, `${at}.description`, it.description) && (it.description as string).length > 120) p.push(`${at}.description: keep it under 120 characters`);
    num(p, `${at}.price`, it.price, 0, 1_000_000, true);
    num(p, `${at}.fitTables`, it.fitTables, 0, 3, true);
    num(p, `${at}.lifeDays`, it.lifeDays, 0, 1000, true);
    num(p, `${at}.refreshCost`, it.refreshCost, 0, 100_000, true);
    if (!Array.isArray(it.tags) || it.tags.some((t) => !DECOR_TAGS.includes(t as string))) p.push(`${at}.tags: expected tags from ${DECOR_TAGS.join(", ")}`);
    if (!isObj(it.effects)) p.push(`${at}.effects: expected an object`);
    else for (const [k, v] of Object.entries(it.effects)) {
      const r = DECOR_EFFECT_RANGES[k];
      if (!r) p.push(`${at}.effects: unknown effect "${k}"`);
      else num(p, `${at}.effects.${k}`, v, r[0], r[1], true);
    }
    if (it.nightLine !== undefined) str(p, `${at}.nightLine`, it.nightLine);
    if (it.starter) {
      if (it.price !== 0 || it.lifeDays !== 0 || it.fitTables !== 0 || (isObj(it.effects) && Object.keys(it.effects).length) || (Array.isArray(it.tags) && it.tags.length))
        p.push(`${at}: a starter item is free, plain, never tires and has no effects`);
    } else {
      if (!isNum(it.price) || it.price <= 0) p.push(`${at}.price: a bought item costs something`);
      if (!isNum(it.lifeDays) || it.lifeDays <= 0) p.push(`${at}.lifeDays: a bought item wears out`);
      if (!Array.isArray(it.tags) || it.tags.length === 0) p.push(`${at}.tags: a bought item has at least one tag`);
      if (isNum(it.refreshCost) && isNum(it.price) && it.refreshCost >= it.price) p.push(`${at}.refreshCost: should be cheaper than buying it`);
      if (it.nightLine === undefined) p.push(`${at}.nightLine: missing`);
    }
  });
  for (const slot of DECOR_SLOT_IDS) {
    const inSlot = (d.items as Record<string, unknown>[]).filter((x) => isObj(x) && x.slot === slot);
    if (inSlot.filter((x) => x.starter).length !== 1) p.push(`decor: slot ${slot} needs exactly one starter item`);
    if (inSlot.length < 4 || inSlot.length > 7) p.push(`decor: slot ${slot} has ${inSlot.length} items (4–7 wanted)`);
  }
}

/** [round 10] sim-core personality.ts LIKE_IDS / DISLIKE_IDS (local copy: this file imports types only; a test checks). */
export const STAFF_LIKE_IDS: readonly string[] = ["busy_nights", "quiet_nights", "weekends_off", "happy_guests", "tips", "learning", "short_weeks"];
export const STAFF_DISLIKE_IDS: readonly string[] = ["mondays", "long_weeks", "grumpy_guests", "mad_rush", "slow_nights", "working_tired", "sunday_shifts"];
const QUOTE_MAX = 70;

/** [round 10] staffQuotes.json: quotes keyed by archetype (or role) id, labels for every like and dislike. */
function validateStaffText(p: Problems, st: unknown, archetypeIds: unknown[]): void {
  if (!isObj(st)) {
    p.push("staffText: expected an object");
    return;
  }
  const keys = new Set([...archetypeIds.filter(isStr), ...ROLES]);
  if (st.quotes !== undefined) {
    if (!isObj(st.quotes)) p.push("staffText.quotes: expected an object");
    else
      for (const [k, v] of Object.entries(st.quotes)) {
        if (!keys.has(k)) p.push(`staffText.quotes: unknown archetype or role "${k}"`);
        if (!Array.isArray(v) || v.length === 0) p.push(`staffText.quotes.${k}: expected a non-empty array`);
        else v.forEach((q, i) => { if (str(p, `staffText.quotes.${k}[${i}]`, q) && q.length > QUOTE_MAX) p.push(`staffText.quotes.${k}[${i}]: longer than ${QUOTE_MAX} characters`); });
      }
  }
  for (const [field, ids] of [["likes", STAFF_LIKE_IDS], ["dislikes", STAFF_DISLIKE_IDS]] as const) {
    const m = st[field];
    if (m === undefined) continue;
    if (!isObj(m)) {
      p.push(`staffText.${field}: expected an object`);
      continue;
    }
    for (const id of ids) if (!(id in m)) p.push(`staffText.${field}: missing "${id}"`);
    for (const [k, v] of Object.entries(m)) {
      if (!ids.includes(k)) p.push(`staffText.${field}: unknown id "${k}"`);
      else str(p, `staffText.${field}.${k}`, v);
    }
  }
}

/** Dish ids kept out of the starter library and the default pack (Round 3 path dishes). */
export const LIBRARY_HIDDEN_DISH_IDS: readonly string[] = (libraryHiddenJson as { dishIds: string[] }).dishIds;

/** Assemble the shipped JSON into the FULL pack, path dishes included (unvalidated). */
function assembleFull(): ContentPack {
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
    adviceText: adviceTextOf(adviceTextJson),
    decor: decorOf(decorJson),
    staffText: staffTextOf(staffQuotesJson),
  };
}

/** [round 10] The decorating catalogue, without the `_note`. */
function decorOf(json: unknown): DecorPack {
  const { _note: _n, ...rest } = json as Record<string, unknown>;
  return rest as unknown as DecorPack;
}

/** [round 10] Staff quotes and like/dislike labels, without the `_note`. */
function staffTextOf(json: unknown): StaffTextPack {
  const { _note: _n, ...rest } = json as Record<string, unknown>;
  return rest as StaffTextPack;
}

/** [round 6] The evening tips' rules and words (sim-core advice.ts), without the `_note`. */
function adviceTextOf(json: unknown): AdviceTextPack {
  const { _note: _n, ...rest } = json as Record<string, unknown>;
  return rest as AdviceTextPack;
}

/**
 * The library pack: the full pack minus `libraryHidden` dishes and any ingredient only they use.
 * This is exactly the round-2 pack, so sim-core balance and headless results are unchanged.
 */
export function libraryPack(full: ContentPack, hidden: readonly string[] = LIBRARY_HIDDEN_DISH_IDS): ContentPack {
  const hide = new Set(hidden);
  const dishes = full.dishes.filter((d) => !hide.has(d.id));
  const used = new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.id)));
  return { ...full, dishes, ingredients: full.ingredients.filter((i) => used.has(i.id)) };
}

function throwIfProblems(what: string, problems: string[]): void {
  if (problems.length) {
    throw new Error(`Full Plate ${what} is invalid (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n  - ${problems.join("\n  - ")}`);
  }
}

/** Load and validate the library pack; throws one Error listing every problem. */
export function loadContent(): ContentPack {
  const pack = libraryPack(assembleFull());
  throwIfProblems("content", validateContent(pack));
  return pack;
}

/** Load and validate the full pack (library + fast-food + fine-dining dishes and their ingredients). */
export function loadFullContent(): ContentPack {
  const pack = assembleFull();
  throwIfProblems("full content", validateContent(pack));
  return pack;
}

/** The validated, shipped content pack (starter library; what sim-core, headless and the owner game use by default). */
export const content: ContentPack = loadContent();
export default content;

/**
 * The validated full pack: `content` plus the Round 3 path dishes (fast food for the Empire, fine dining and wines for
 * the Stars). Cook with this once a path is chosen, or everywhere and hide `LIBRARY_HIDDEN_DISH_IDS` in the menu editor.
 */
export const fullContent: ContentPack = loadFullContent();

/** Assemble Round 3 extras from the shipped JSON (unvalidated). Notes keys ("_…") are dropped. */
function assembleExtras(): Extras {
  const { _placeholders: _a, ...criticText } = criticTextJson as Record<string, unknown>;
  const { _placeholders: _b, ...careerText } = careerTextJson as Record<string, unknown>;
  const { _breakersNote: _c, ...countries } = countriesJson as Record<string, unknown>;
  return {
    dishTags: dishTagsJson as DishTags,
    libraryHidden: [...LIBRARY_HIDDEN_DISH_IDS],
    formulas: formulasJson as FormulaDef[],
    tastingMenus: tastingMenusJson as TastingMenuDef[],
    wineList: wineListJson as WineDef[],
    world: citiesJson as WorldData,
    countries: countries as unknown as CountriesData,
    criticText: criticText as unknown as CriticText,
    careerText: careerText as unknown as CareerText,
    incidentText: incidentTextJson as IncidentTextData,
    goalText: goalTextJson as GoalTextData,
  };
}

/** Load and validate the extras against the full pack; throws one Error listing every problem. */
export function loadExtras(): Extras {
  const x = assembleExtras();
  throwIfProblems("extras", validateExtras(x, fullContent));
  return x;
}

/** Validated Round 3 extras: path data and text that sit beside the ContentPack. */
export const extras: Extras = loadExtras();

// ───────── typed getters ─────────
export const dishTags: DishTags = extras.dishTags;
export const formulas: readonly FormulaDef[] = extras.formulas;
export const tastingMenus: readonly TastingMenuDef[] = extras.tastingMenus;
export const wineList: readonly WineDef[] = extras.wineList;
export const world: WorldData = extras.world;
export const countries: CountriesData = extras.countries;
export const criticText: CriticText = extras.criticText;
export const careerText: CareerText = extras.careerText;
export const incidentText: IncidentTextData = extras.incidentText;
export const goalText: GoalTextData = extras.goalText;

/** UI flag: false for dishes the starter library should hide. */
export const inLibrary = (dishId: string): boolean => !LIBRARY_HIDDEN_DISH_IDS.includes(dishId);
/** Tags of a dish ([] when untagged). */
export const tagsOf = (dishId: string): readonly DishTag[] => extras.dishTags[dishId] ?? [];
/** Dishes in the full pack carrying a tag, in pack order. */
export const dishesWithTag = (tag: DishTag): DishDef[] => fullContent.dishes.filter((d) => tagsOf(d.id).includes(tag));
export const formulaById = (id: string): FormulaDef | undefined => extras.formulas.find((f) => f.id === id);
export const tastingMenuById = (id: string): TastingMenuDef | undefined => extras.tastingMenus.find((m) => m.id === id);
export const cityById = (id: string) => extras.world.cities.find((c) => c.id === id);
export const countryByName = (name: string) => extras.countries.countries.find((c) => c.name === name);
/** Player-facing rule lines for a city's country (the country-entry puzzle). */
export const rulesTextForCity = (cityId: string): string[] => {
  const c = cityById(cityId);
  return (c && countryByName(c.country)?.rules) ?? [];
};
export const dietaryRuleText = (rule: DietaryRule) => extras.countries.dietaryRules[rule];

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
