/** Small pure helpers shared by systems. No game rules live here beyond lookups and calendar. */
import {
  DAYS_PER_MONTH,
  LOG_MAX,
  MONTHS_PER_YEAR,
  START_MONTH,
  START_WEEKDAY,
  WEEKEND_DAYS,
} from "./constants";
import type {
  ContentPack,
  DishDef,
  DistrictDef,
  GameState,
  IngredientDef,
  LogEntry,
  SegmentDef,
  ServiceTally,
  SimEvent,
  Staff,
  StaffRole,
  TraitDef,
} from "./types";

// ── numbers ──
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
/** Rounds to 2 decimal places; keeps non-money floats in state short and stable. */
export const round2 = (x: number): number => Math.round(x * 100) / 100;

// ── calendar ──
/** Month 1-12 for a 0-based day. */
export const monthOf = (day: number): number =>
  ((START_MONTH - 1 + Math.floor(day / DAYS_PER_MONTH)) % MONTHS_PER_YEAR) + 1;
/** 0 = Monday … 6 = Sunday. Rota arrays are indexed by this. */
export const weekdayOf = (day: number): number => (day + START_WEEKDAY) % 7;
export const isWeekend = (day: number): boolean => WEEKEND_DAYS.includes(weekdayOf(day));

// ── content lookups (linear scans are fine at content sizes; cached per pack) ──
interface Index {
  dishes: Map<string, DishDef>;
  ingredients: Map<string, IngredientDef>;
  segments: Map<string, SegmentDef>;
  districts: Map<string, DistrictDef>;
  traits: Map<string, TraitDef>;
}
const indexCache = new WeakMap<ContentPack, Index>();

function indexOf(content: ContentPack): Index {
  let idx = indexCache.get(content);
  if (!idx) {
    idx = {
      dishes: new Map(content.dishes.map((d) => [d.id, d])),
      ingredients: new Map(content.ingredients.map((i) => [i.id, i])),
      segments: new Map(content.segments.map((s) => [s.id, s])),
      districts: new Map(content.districts.map((d) => [d.id, d])),
      traits: new Map(content.traits.map((t) => [t.id, t])),
    };
    indexCache.set(content, idx);
  }
  return idx;
}

export const findDish = (c: ContentPack, id: string) => indexOf(c).dishes.get(id);
export const findIngredient = (c: ContentPack, id: string) => indexOf(c).ingredients.get(id);
export const findSegment = (c: ContentPack, id: string) => indexOf(c).segments.get(id);
export const findDistrict = (c: ContentPack, id: string) => indexOf(c).districts.get(id);
export const findTrait = (c: ContentPack, id: string) => indexOf(c).traits.get(id);

export function districtOf(content: ContentPack, state: GameState): DistrictDef {
  const d = findDistrict(content, state.districtId);
  if (!d) throw new Error(`Unknown district ${state.districtId}`);
  return d;
}

/** Base ingredient cost of one plate of a dish. */
export function plateCost(content: ContentPack, dish: DishDef): number {
  let cost = 0;
  for (const ing of dish.ingredients) cost += (findIngredient(content, ing.id)?.unitCost ?? 0) * ing.qty;
  return Math.round(cost);
}

export function isInSeason(ing: IngredientDef, month: number): boolean {
  return !!ing.seasonality && ing.seasonality.includes(month);
}

// ── staff ──
/** Product of a trait effect across a staff member's traits (1 when none apply). */
export function traitMult(
  content: ContentPack,
  traits: readonly string[],
  key: keyof TraitDef["effects"],
): number {
  let m = 1;
  for (const id of traits) m *= findTrait(content, id)?.effects[key] ?? 1;
  return m;
}

export const worksToday = (s: Staff, day: number): boolean => s.rota[weekdayOf(day)] === true;
/** Rostered, not on a training day, and not on a break right now. */
export const onFloor = (s: Staff, state: Pick<GameState, "day" | "tick">): boolean =>
  worksToday(s, state.day) && s.trainingDay !== state.day && !((s.breakUntilTick ?? 0) > state.tick);
export const onShift = (state: GameState, role?: StaffRole): Staff[] =>
  state.staff.filter((s) => onFloor(s, state) && (role === undefined || s.role === role));

/** Deterministic dither in [0, 1) from a string (used to round fractional cook times without RNG). */
export function dither(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return ((Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0) % 10_000) / 10_000;
}

// ── logging ──
export function logEvent(state: GameState, text: string, kind: LogEntry["kind"]): SimEvent {
  return { type: "LOG", entry: { day: state.day, tick: state.tick, text, kind } };
}

/** Appends LOG entries from events to state.log, keeping the last LOG_MAX. */
export function foldLog(state: GameState, events: readonly SimEvent[]): GameState {
  const entries: LogEntry[] = [];
  for (const e of events) if (e.type === "LOG") entries.push(e.entry);
  if (entries.length === 0) return state;
  const log = state.log.concat(entries);
  return { ...state, log: log.length > LOG_MAX ? log.slice(log.length - LOG_MAX) : log };
}

// ── service tally ──
export function emptyTally(): ServiceTally {
  return {
    parties: 0,
    ratingSum: 0,
    satisfactionSum: 0,
    ratedCovers: 0,
    qualitySum: 0,
    plates: 0,
    dishes: {},
    potentialParties: 0,
    arrivals: [],
    nextCustomer: 0,
    nextTicket: 0,
    actionsPerTick: 0,
    actionsLeft: 0,
    plateWaste: 0,
    walkoutParties: 0,
    serverTips: 0,
    ingredientsUsed: {},
    paid: [],
    // round 2: always present on new tallies so every tally has one object shape (V8 stays monomorphic).
    foodCost: 0,
    frontCharm: 50,
    mods: [],
    kitchenCarry: 0,
    prestigeBonus: 0,
    popularityBonus: 0,
    incidentCosts: 0,
    incidentsStarted: 0,
    lastIncidentTick: -1000,
  };
}

export const tallyOf = (state: GameState): ServiceTally => state.service ?? emptyTally();

// ── copy-on-write arrays ──
/**
 * Maps an array, returning the original when no element changed (identity compare).
 * Lets systems stay pure without reallocating every tick.
 */
export function mapIfChanged<T>(arr: readonly T[], fn: (x: T, i: number) => T): T[] {
  let out: T[] | undefined;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i]!;
    const y = fn(x, i);
    if (y !== x) {
      out ??= arr.slice();
      out[i] = y;
    }
  }
  return out ?? (arr as T[]);
}
