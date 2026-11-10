/**
 * Round 12 (F): dishes the player invents. A content TRANSFORM in the shape of `applySoftDrinks`: the game keeps the
 * player's recipes (name, course, icon, 2–5 ingredients with quantities) beside the save, and this module turns each
 * one into an ordinary `DishDef` and appends it to the content packs handed to the sim. The sim then cooks, prices,
 * sells and reviews it exactly as it does a shipped dish.
 *
 * Every number of a custom dish is a pure function of its recipe and the reference pack's real dishes (no randomness,
 * no wall clock):
 *
 * - **cost** is the real ingredient cost; the **suggested price** is that cost at the pack's usual food-cost share for
 *   the course (the median of the real dishes), rounded up to 5p. Guests judge the menu price against it as usual.
 * - **skill** and **prep time** come from the real dishes that use each ingredient (skill: 80% the mean, 20% the
 *   hardest one's; prep: the mean), and rise with every ingredient (+2 skill, +¼ tick each, counted from three). Run on
 *   the shipped dishes' own recipes this lands within a few points of their real skill on average (CONTENT-NOTES).
 * - **quality ceiling** is the ingredients' mean, held between the course's 25th percentile and its median.
 * - **appeal** per guest type is the mean of three readings of the pack's own tag model — real dishes of the same course
 *   and cuisine, real dishes using these ingredients, real dishes of the same course that are (or aren't) vegetarian —
 *   cut for a price band well above the course's going rate (by each guest type's price sensitivity), for a price past
 *   1.5× a guest type's budget per head (by the square of the overshoot), and for a thin
 *   plate (under half the course's usual ingredient cost), and **capped** at
 *   the course's 75th percentile. A custom dish can be as good as a good real dish, never better than the best quarter.
 *
 * The cuisine isn't asked for: it's read from the ingredients (the cuisine whose real dishes use them most).
 */
import type { ContentPack, Cuisine, DishCourse, DishDef, IngredientDef } from "@full-plate/sim-core";
import customDishTextJson from "../data/customDishText.json";

/** The Evening's line for an invented dish's first night ({dish}, {restaurant}). */
export const NEW_DISH_REVIEWS: readonly string[] = (customDishTextJson as { newDish: string[] }).newDish;

/** Courses a player can invent (no sides: they never lead an order). */
export const CUSTOM_COURSES = ["starter", "main", "dessert", "drink"] as const;
export type CustomCourse = (typeof CUSTOM_COURSES)[number];
/** The plate motifs (emoji, as the shipped dishes use). */
export const CUSTOM_ICONS = ["🍲", "🥘", "🍝", "🍛", "🍜", "🥗", "🥪", "🌮", "🍔", "🥩", "🍤", "🍣", "🥧", "🍰", "🧁", "🍮", "🍨", "🍹", "🥤", "☕"] as const;
export const CUSTOM_ID_RE = /^custom:[a-z0-9]{6,16}$/;
export const CUSTOM_NAME_MAX = 32;
export const CUSTOM_MIN_INGREDIENTS = 2;
export const CUSTOM_MAX_INGREDIENTS = 5;
export const CUSTOM_QTY_MIN = 0.25;
export const CUSTOM_QTY_MAX = 3;
export const CUSTOM_QTY_STEP = 0.25;
/** At most this many invented dishes per game. */
export const CUSTOM_MAX_PER_GAME = 12;
/** Ingredients that are never on the picker (not food, or a path-only freebie). */
const NOT_FOOD = new Set(["toy_surprise"]);
/** Ingredients that make a dish not vegetarian. */
const MEAT_FISH = new Set([
  "beef_steak", "beef_mince", "chicken_breast", "pork_belly", "sausages", "bacon", "lamb", "cod", "salmon", "scallops", "prawns",
  "mussels", "duck_breast", "beef_patty", "chicken_fillet_crumbed", "chicken_nuggets", "fish_fillet_crumbed", "pork_sausage_patty",
  "turbot", "venison_loin", "langoustines", "beef_fillet", "lobster", "fine_stock",
]);
const CUISINES: readonly Cuisine[] = ["british", "italian", "american", "asian", "french", "cafe"];

/** What the player made: everything else is derived. */
export interface CustomDishSpec {
  id: string;
  name: string;
  course: CustomCourse;
  icon: string;
  ingredients: { id: string; qty: number }[];
  /** Sim day it was invented (shown in the Cookbook; not used by the maths). */
  createdDay: number;
}

// ───────── the reference model (from the real dishes) ─────────
interface CourseStats {
  dishes: DishDef[];
  costShare: number;
  medianPrice: number;
  medianCost: number;
  ceilingLo: number;
  ceilingHi: number;
  /** Per segment: 75th percentile of appeal (the cap). */
  appealCap: Record<string, number>;
}
interface IngredientStats { skill: number; prep: number; ceiling: number; appeal: Record<string, number>; cuisine: Record<string, number> }
interface Model {
  ingredients: Map<string, IngredientDef>;
  costOf: (d: Pick<DishDef, "ingredients">) => number;
  courses: Record<CustomCourse, CourseStats>;
  byIngredient: Map<string, IngredientStats>;
  segments: string[];
  /** Ingredients a player can pick (used by at least one real dish), cheapest first within name order. */
  pickable: IngredientDef[];
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
export const isCustomDishId = (id: string): boolean => id.startsWith("custom:");

const models = new WeakMap<ContentPack, Model>();

/** The model for a reference pack (its real dishes; custom dishes in it are ignored). Memoised per pack. */
function modelOf(ref: ContentPack): Model {
  const hit = models.get(ref);
  if (hit) return hit;
  const ingredients = new Map(ref.ingredients.map((i) => [i.id, i]));
  const costOf = (d: Pick<DishDef, "ingredients">) => d.ingredients.reduce((a, x) => a + (ingredients.get(x.id)?.unitCost ?? 0) * x.qty, 0);
  const real = ref.dishes.filter((d) => !isCustomDishId(d.id));
  const segments = ref.segments.map((s) => s.id);
  const courses = {} as Record<CustomCourse, CourseStats>;
  for (const c of CUSTOM_COURSES) {
    const ds = real.filter((d) => d.course === c);
    courses[c] = {
      dishes: ds,
      costShare: quantile(ds.map((d) => costOf(d) / d.suggestedPrice), 0.5) || 0.3,
      medianPrice: quantile(ds.map((d) => d.suggestedPrice), 0.5) || 500,
      medianCost: quantile(ds.map(costOf), 0.5) || 100,
      ceilingLo: quantile(ds.map((d) => d.qualityCeiling), 0.25),
      ceilingHi: quantile(ds.map((d) => d.qualityCeiling), 0.5),
      appealCap: Object.fromEntries(segments.map((s) => [s, quantile(ds.map((d) => d.baseAppeal[s] ?? 0), 0.75)])),
    };
  }
  const byIngredient = new Map<string, IngredientStats>();
  for (const ing of ref.ingredients) {
    const uses = real.filter((d) => d.ingredients.some((x) => x.id === ing.id));
    if (!uses.length) continue;
    const cuisine: Record<string, number> = {};
    for (const d of uses) cuisine[d.cuisine] = (cuisine[d.cuisine] ?? 0) + 1 / uses.length;
    byIngredient.set(ing.id, {
      skill: mean(uses.map((d) => d.skillRequired)),
      prep: mean(uses.map((d) => d.prepTicks)),
      ceiling: mean(uses.map((d) => d.qualityCeiling)),
      appeal: Object.fromEntries(segments.map((s) => [s, mean(uses.map((d) => d.baseAppeal[s] ?? 0))])),
      cuisine,
    });
  }
  const pickable = ref.ingredients.filter((i) => byIngredient.has(i.id) && !NOT_FOOD.has(i.id));
  const m: Model = { ingredients, costOf, courses, byIngredient, segments, pickable };
  models.set(ref, m);
  return m;
}

/** Ingredients the invent sheet offers (pack order). */
export const pickableIngredients = (ref: ContentPack): readonly IngredientDef[] => modelOf(ref).pickable;

// ───────── validation ─────────
/**
 * Characters that can reorder or hide text — the same class sim-core's save schema strips from restaurant names
 * (`UNSAFE_CHARS`, copied: content imports sim-core types only). The zero-width joiner stays (emoji need it).
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\ufff9-\ufffb]/g;
/** Strips those characters and line breaks, collapses spaces, caps the length at 32 code points. */
export function cleanDishName(raw: string): string {
  const s = raw.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  return [...s].slice(0, CUSTOM_NAME_MAX).join("").trim();
}

/** Problems with a recipe (empty = fine). Ingredient ids must be pickable in the reference pack. */
export function checkCustomDish(spec: unknown, ref: ContentPack): string[] {
  const p: string[] = [];
  if (!spec || typeof spec !== "object") return ["custom dish: expected an object"];
  const s = spec as Record<string, unknown>;
  if (typeof s.id !== "string" || !CUSTOM_ID_RE.test(s.id)) p.push(`custom dish id ${JSON.stringify(s.id)} is not custom:<letters/digits>`);
  if (typeof s.name !== "string" || !s.name.trim() || cleanDishName(s.name) !== s.name) p.push("custom dish name: 1–32 plain characters");
  if (!CUSTOM_COURSES.includes(s.course as CustomCourse)) p.push(`custom dish course ${JSON.stringify(s.course)}`);
  if (!(CUSTOM_ICONS as readonly string[]).includes(s.icon as string)) p.push(`custom dish icon ${JSON.stringify(s.icon)}`);
  if (!Number.isInteger(s.createdDay) || (s.createdDay as number) < 0 || (s.createdDay as number) > 1e6) p.push("custom dish createdDay");
  const ings = s.ingredients;
  if (!Array.isArray(ings) || ings.length < CUSTOM_MIN_INGREDIENTS || ings.length > CUSTOM_MAX_INGREDIENTS) {
    p.push(`custom dish: ${CUSTOM_MIN_INGREDIENTS}–${CUSTOM_MAX_INGREDIENTS} ingredients`);
    return p;
  }
  const m = modelOf(ref);
  const seen = new Set<string>();
  ings.forEach((x: unknown, i) => {
    const r = x as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return p.push(`custom dish ingredient ${i}: expected an object`);
    if (typeof r.id !== "string" || !m.pickable.some((ing) => ing.id === r.id)) p.push(`custom dish ingredient ${JSON.stringify(r.id)} is not on the list`);
    else if (seen.has(r.id)) p.push(`custom dish ingredient ${r.id} twice`);
    else seen.add(r.id);
    const q = r.qty;
    if (typeof q !== "number" || !Number.isFinite(q) || q < CUSTOM_QTY_MIN || q > CUSTOM_QTY_MAX || Math.abs(q / CUSTOM_QTY_STEP - Math.round(q / CUSTOM_QTY_STEP)) > 1e-9)
      p.push(`custom dish ingredient ${i}: quantity ${JSON.stringify(q)} (${CUSTOM_QTY_MIN}–${CUSTOM_QTY_MAX} in steps of ${CUSTOM_QTY_STEP})`);
  });
  return p;
}

// ───────── derivation ─────────
/** The derived numbers behind a recipe (what the invent sheet shows). */
export interface CustomDishFacts {
  dish: DishDef;
  /** Raw ingredient cost in pence (unrounded sum; the dish's plate cost rounds it). */
  cost: number;
  cuisine: Cuisine;
  vegetarian: boolean;
  /** Suggested price ÷ the course's going rate (1 = typical). */
  priceBand: number;
  /** Segments whose appeal was capped at the course's top quarter. */
  capped: string[];
  /** 0.5–1: appeal kept by a plate with less in it than the course's usual (1 = a proper portion). */
  portion: number;
}

const ceil5 = (p: number) => Math.ceil(p / 5) * 5;

/** Turns a recipe into a DishDef, from the reference pack's real dishes. Pure. */
export function customDishFacts(spec: CustomDishSpec, ref: ContentPack): CustomDishFacts {
  const m = modelOf(ref);
  const course = m.courses[spec.course] ?? m.courses.main;
  const stats = spec.ingredients.map((x) => m.byIngredient.get(x.id)).filter((x): x is IngredientStats => !!x);
  const n = spec.ingredients.length;
  const cost = m.costOf(spec);
  const suggestedPrice = Math.max(100, ceil5(cost / course.costShare), ceil5(cost * 1.25 + 5));
  // The shipped dishes have three to five ingredients; each one past three makes it harder and slower (and fewer, easier).
  const extra = n - 3;
  const skills = stats.map((x) => x.skill);
  const skillRequired = Math.round(clamp(0.2 * Math.max(0, ...skills) + 0.8 * mean(skills) + 2 * extra, 5, 95));
  const prepTicks = Math.round(clamp(mean(stats.map((x) => x.prep)) + 0.25 * extra, 1, 12));
  const qualityCeiling = Math.round(clamp(mean(stats.map((x) => x.ceiling)), course.ceilingLo, course.ceilingHi));
  // Cuisine: whose real dishes use these ingredients most (ties go to the earlier cuisine in the list).
  let cuisine: Cuisine = "cafe";
  let best = -1;
  for (const c of CUISINES) {
    const score = stats.reduce((a, x) => a + (x.cuisine[c] ?? 0), 0);
    if (score > best + 1e-9) { best = score; cuisine = c; }
  }
  const vegetarian = !spec.ingredients.some((x) => MEAT_FISH.has(x.id));
  const sameCuisine = course.dishes.filter((d) => d.cuisine === cuisine);
  const sameVeg = course.dishes.filter((d) => !d.ingredients.some((x) => MEAT_FISH.has(x.id)) === vegetarian);
  const priceBand = suggestedPrice / course.medianPrice;
  const over = Math.max(0, priceBand - 1.25);
  // A thin plate (well under half the course's usual ingredients) reads as stingy: up to half its appeal goes.
  const portion = clamp(cost / (0.5 * course.medianCost), 0.5, 1);
  const capped: string[] = [];
  const baseAppeal: Record<string, number> = {};
  for (const seg of ref.segments) {
    const pick = (ds: DishDef[]) => mean((ds.length ? ds : course.dishes).map((d) => d.baseAppeal[seg.id] ?? 0));
    const raw = (pick(sameCuisine) + mean(stats.map((x) => x.appeal[seg.id] ?? 0)) + pick(sameVeg)) / 3;
    // Well past what this guest type spends a head (1.5× their budget), almost nobody orders it, whatever their taste.
    const budget = Math.min(1, ((1.5 * seg.averageBudget) / suggestedPrice) ** 2);
    const priced = raw * portion * budget * (1 - seg.priceSensitivity * Math.min(0.8, over * 0.6));
    const cap = course.appealCap[seg.id] ?? 1;
    if (priced > cap) capped.push(seg.id);
    baseAppeal[seg.id] = clamp(Math.min(round2(priced), Math.floor(cap * 100 + 1e-9) / 100), 0.01, 1);
  }
  const names = spec.ingredients.map((x) => (m.ingredients.get(x.id)?.name ?? x.id).replace(/\s*\(.*\)$/, "").toLowerCase());
  const blurb = `Your own recipe: ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}.`;
  const dish: DishDef = {
    id: spec.id,
    name: spec.name,
    course: spec.course as DishCourse,
    cuisine,
    ingredients: spec.ingredients.map((x) => ({ id: x.id, qty: x.qty })),
    prepTicks,
    skillRequired,
    qualityCeiling,
    baseAppeal,
    suggestedPrice,
    blurb,
  };
  return { dish, cost, cuisine, vegetarian, priceBand, capped, portion };
}

export const deriveCustomDish = (spec: CustomDishSpec, ref: ContentPack): DishDef => customDishFacts(spec, ref).dish;

/** How a dish would sell in a district: Σ segment share × appeal, and where that sits among the course's real dishes. */
export interface PopularityGuess {
  /** 0–1 weighted appeal. */
  score: number;
  /** Share of the course's real dishes it beats (0–1). */
  rank: number;
  band: "favourite" | "steady" | "slow" | "hard";
}

export function guessPopularity(dish: DishDef, ref: ContentPack, districtId: string): PopularityGuess {
  const m = modelOf(ref);
  const district = ref.districts.find((d) => d.id === districtId) ?? ref.districts[0]!;
  const w = (d: DishDef) => Object.entries(district.segmentMix).reduce((a, [s, share]) => a + share * (d.baseAppeal[s] ?? 0), 0);
  const course = m.courses[dish.course as CustomCourse] ?? m.courses.main;
  const score = w(dish);
  const others = course.dishes.map(w);
  const rank = others.length ? others.filter((x) => x < score - 1e-9).length / others.length : 0.5;
  const band = rank >= 0.7 ? "favourite" : rank >= 0.4 ? "steady" : rank >= 0.15 ? "slow" : "hard";
  return { score, rank, band };
}

// ───────── the transform ─────────
let appliedKey = "";

/** Stable key of the recipes (ids and every input), so a re-sync with the same recipes is a no-op. */
export const customDishesKey = (specs: readonly CustomDishSpec[]): string =>
  specs.map((s) => `${s.id}|${s.name}|${s.course}|${s.icon}|${s.ingredients.map((x) => `${x.id}*${x.qty}`).join(",")}`).join(";");

/**
 * Puts these recipes into the packs (in place, like `applySoftDrinks`): each root's `dishes` array is REPLACED by its
 * shipped dishes plus the derived custom ones (a new array, so sim-core re-indexes the pack). Recipes that fail
 * `checkCustomDish` are skipped. Idempotent; returns whether anything changed.
 */
export function applyCustomDishes(roots: readonly ContentPack[], specs: readonly CustomDishSpec[], ref: ContentPack): boolean {
  const ok = specs.filter((s) => checkCustomDish(s, ref).length === 0).slice(0, CUSTOM_MAX_PER_GAME);
  const key = customDishesKey(ok);
  if (key === appliedKey) return false;
  const derived = ok.map((s) => deriveCustomDish(s, ref));
  for (const r of roots) (r as { dishes: DishDef[] }).dishes = [...r.dishes.filter((d) => !isCustomDishId(d.id)), ...derived];
  appliedKey = key;
  return true;
}

/** A NEW pack with these recipes appended (for headless runs and tests; the shipped packs are untouched). */
export function withCustomDishes(pack: ContentPack, specs: readonly CustomDishSpec[], ref: ContentPack = pack): ContentPack {
  const derived = specs.filter((s) => checkCustomDish(s, ref).length === 0).map((s) => deriveCustomDish(s, ref));
  return { ...pack, dishes: [...pack.dishes.filter((d) => !isCustomDishId(d.id)), ...derived] };
}

/** A short id for a new recipe: `custom:` + 8 base-36 characters hashed from the game seed, day, count and name. */
export function customDishId(seed: number, day: number, n: number, name: string, taken: ReadonlySet<string> = new Set()): string {
  for (let salt = 0; ; salt++) {
    let h = 0x811c9dc5;
    for (const ch of `${seed}|${day}|${n}|${name}|${salt}`) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
    let h2 = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    const id = `custom:${(h.toString(36) + h2.toString(36)).padEnd(8, "0").slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}

// ───────── the cookbook (game-side records; kept here so the game's main chunk stays small) ─────────
/** A recipe as the game saves it (PathMeta.customDishes): the spec plus its lifetime sales. */
export interface CustomDishRecord extends CustomDishSpec {
  /** Plates sold, all time (folded in each evening). */
  sold: number;
  /** The first sim day it sold a plate. */
  firstSoldDay?: number;
}
/** The part of the game's PathMeta this module reads and writes. */
export interface CookbookMeta { customDishes?: CustomDishRecord[] | undefined; cookbookDay?: number | undefined }
type SalesDay = { day: number; perDish?: Record<string, { sold: number }> | undefined };
/** What the invent sheet makes. */
export type CustomDishDraft = Pick<CustomDishSpec, "name" | "course" | "icon" | "ingredients">;

/** A new recipe from a draft (id hashed from the seed, day, count and name; name cleaned), or why it can't be made. */
export function makeCustomDish(have: readonly CustomDishRecord[], seed: number, day: number, draft: CustomDishDraft, ref: ContentPack): { dish: CustomDishRecord } | { error: string } {
  if (have.length >= CUSTOM_MAX_PER_GAME) return { error: `Your cookbook is full (${CUSTOM_MAX_PER_GAME} recipes).` };
  const name = cleanDishName(typeof draft.name === "string" ? draft.name : "");
  if (!name) return { error: "Give the dish a name first." };
  if (have.some((d) => d.name.toLowerCase() === name.toLowerCase())) return { error: `You already have a dish called ${name}.` };
  const id = customDishId(seed, day, have.length, name, new Set(have.map((d) => d.id)));
  const spec: CustomDishSpec = { id, name, course: draft.course, icon: draft.icon, createdDay: day, ingredients: (draft.ingredients ?? []).map((x) => ({ id: x.id, qty: x.qty })) };
  if (checkCustomDish(spec, ref).length) return { error: "That recipe doesn't add up: check the ingredients and try again." };
  return { dish: { ...spec, sold: 0 } };
}

/**
 * Adds a recipe to the cookbook (the same meta back when it fails the recipe check, its id or name is taken, or the
 * book is full). Sales are counted from the last day already played.
 */
export function addCustomDish<M extends CookbookMeta>(meta: M, dish: CustomDishRecord, lastDay: number, ref: ContentPack): M {
  const have = meta.customDishes ?? [];
  if (have.length >= CUSTOM_MAX_PER_GAME || checkCustomDish(dish, ref).length || have.some((d) => d.id === dish.id || d.name.toLowerCase() === dish.name.toLowerCase())) return meta;
  return { ...meta, customDishes: [...have, { ...dish, sold: 0 }], cookbookDay: Math.max(meta.cookbookDay ?? -1, lastDay) };
}

/**
 * The reducer's "invent" step: adds the recipe when the game is in planning and inventing is allowed here (an owner's
 * game, below the cap). The same meta back otherwise.
 */
export function inventInto<M extends CookbookMeta & { mode: string; career?: { handover?: unknown } | undefined }>(
  meta: M, dish: CustomDishRecord, game: { phase: string; history: readonly SalesDay[] } | null, ref: ContentPack,
): M {
  return game && game.phase === "planning" && canInventIn(meta) ? addCustomDish(meta, dish, game.history.at(-1)?.day ?? -1, ref) : meta;
}

/**
 * After every reducer step: the packs carry this game's recipes (`syncCustomDishes`, memoised on the array) and the
 * days played since `cookbookDay` are folded into their sales (`foldCookbook`).
 */
export function cookbookStep<M extends CookbookMeta>(roots: readonly ContentPack[], ref: ContentPack, meta: M, game: { history: readonly SalesDay[] } | null): M {
  syncCustomDishes(roots, meta.customDishes, ref);
  return game ? foldCookbook(meta, game.history) : meta;
}

/** Folds the days after `meta.cookbookDay` into the recipes' sales and first-sold day. Same meta when nothing is new. */
export function foldCookbook<M extends CookbookMeta>(meta: M, history: readonly SalesDay[]): M {
  const dishes = meta.customDishes;
  const last = history.at(-1)?.day ?? -1;
  const from = meta.cookbookDay ?? -1;
  if (!dishes?.length || last <= from) return meta;
  const next = dishes.map((d) => {
    let sold = d.sold;
    let first = d.firstSoldDay;
    for (const h of history) {
      const n = h.day > from ? h.perDish?.[d.id]?.sold ?? 0 : 0;
      if (n > 0) { sold += n; first ??= h.day; }
    }
    return sold === d.sold && first === d.firstSoldDay ? d : { ...d, sold, ...(first !== undefined ? { firstSoldDay: first } : {}) };
  });
  return { ...meta, customDishes: next.some((d, i) => d !== dishes[i]) ? next : dishes, cookbookDay: last };
}

const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h;
};

/**
 * The Evening's line for a recipe's first night (it sold today and never before), or null. Picked from `newDish` by a
 * hash of the seed, day and dish: a reload shows the same words, and no RNG is drawn.
 */
export function newDishReview(meta: CookbookMeta | undefined, seed: number, restaurant: string, result: SalesDay): { dishId: string; name: string; icon: string; text: string; quality: number } | null {
  const d = meta?.customDishes?.find((x) => x.firstSoldDay === result.day && (result.perDish?.[x.id]?.sold ?? 0) > 0);
  if (!d || !NEW_DISH_REVIEWS.length) return null;
  const line = NEW_DISH_REVIEWS[hash32(`${seed}|${result.day}|${d.id}`) % NEW_DISH_REVIEWS.length]!;
  return { dishId: d.id, name: d.name, icon: d.icon, text: line.replaceAll("{dish}", d.name).replaceAll("{restaurant}", restaurant), quality: (result.perDish?.[d.id] as { qualityMean?: number } | undefined)?.qualityMean ?? 60 };
}

/**
 * Tonight's reviews with that line first, as a word-of-mouth review of the dish (stars from the plates' mean quality,
 * 1–5). The sim's reviews are not touched: this is display only. Same array when there's no first night.
 */
export function withNewDishReview<R extends { day: number; source: string; rating: number; text: string; dishId?: string }>(
  reviews: R[], meta: CookbookMeta | undefined, seed: number, restaurant: string, result: SalesDay,
): R[] {
  const line = newDishReview(meta, seed, restaurant, result);
  if (!line) return reviews;
  const rating = Math.max(1, Math.min(5, Math.round(line.quality / 20)));
  return [{ day: result.day, source: "wordofmouth", rating, text: line.text, dishId: line.dishId } as R, ...reviews];
}

// ───────── the game's side: when inventing is allowed, and the pack sync ─────────
/** The player can invent here: an owner's game (or a career that became their own place), below the cap. */
export const canInventIn = (meta: (CookbookMeta & { mode: string; career?: { handover?: unknown } | undefined }) | undefined): boolean =>
  !!meta && (meta.mode === "owner" || !!meta.career?.handover) && (meta.customDishes?.length ?? 0) < CUSTOM_MAX_PER_GAME;

let syncedSpecs: readonly CustomDishSpec[] | undefined;
let syncVersion = 0;
const bases = new WeakMap<ContentPack, { v: number; pack: ContentPack }>();
/**
 * `applyCustomDishes` for the game: memoised on the recipes array (a call per reducer step costs one comparison).
 * Returns whether the packs changed.
 */
export function syncCustomDishes(roots: readonly ContentPack[], specs: readonly CustomDishSpec[] | undefined, ref: ContentPack): boolean {
  if (specs === syncedSpecs) return false;
  syncedSpecs = specs;
  const changed = applyCustomDishes(roots, specs ?? [], ref);
  if (changed) syncVersion++;
  return changed;
}
/**
 * `pack` itself until the first sync changes anything, then a shallow copy per change: sim-stars memoises its
 * signature pack per pack object, so it needs a new object to see new dishes.
 */
export function customBase(pack: ContentPack): ContentPack {
  if (syncVersion === 0) return pack;
  const hit = bases.get(pack);
  if (hit?.v === syncVersion) return hit.pack;
  const copy = { ...pack };
  bases.set(pack, { v: syncVersion, pack: copy });
  return copy;
}
