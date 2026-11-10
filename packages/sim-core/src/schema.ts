/**
 * Round 11: a small schema checker for loaded saves (save files, the account copy, the device cache). Every save type's
 * validator (sim-core/validate.ts, sim-empire/validate.ts, sim-stars/validate.ts, sim-career/validate.ts and the game's
 * envelope in state/saveCheck.ts) is written with these builders. A check returns a cleaned copy of the value (names
 * stripped of bidi / zero-width / control characters and capped, unknown keys dropped or sanitised) or throws a
 * SchemaError naming the path. Nothing here runs during play: the game loads it lazily with the save code.
 *
 * Kept out of the package index on purpose (import "@full-plate/sim-core/schema"), so the game's main chunk never
 * carries it.
 */

export class SchemaError extends Error {
  constructor(readonly at: string, what: string) {
    super(`${at}: ${what}`);
    this.name = "SchemaError";
  }
}

export type Check<T = unknown> = ((v: unknown, at: string) => T) & { optional?: true };

export const fail = (at: string, what: string): never => {
  throw new SchemaError(at, what);
};

/** Money bound (pence): £100bn either way. Anything past it is a crafted file, not a game. */
export const MONEY = 1e13;
/** A generous bound for counters and tallies that are not money. */
export const BIG = 1e12;
/** Days, ticks and other calendar numbers. */
export const DAYS = 1e6;

/**
 * Characters that can reorder or hide text: C0/C1 controls (not tab/newline), soft hyphen, Arabic letter mark, Hangul
 * fillers, Mongolian vowel separator, zero-width space/non-joiner, LRM/RLM, the bidi embeddings/overrides/isolates,
 * word joiner and invisible operators, BOM, interlinear annotation marks. The zero-width joiner (U+200D) stays: emoji
 * sequences need it.
 */
// eslint-disable-next-line no-control-regex
export const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­؜ᅟᅠ᠎​‌‎‏‪-‮⁠-⁯ㅤ﻿￹-￻]/g;

export const cleanText = (s: string): string => (UNSAFE_CHARS.test(s) ? s.replace(UNSAFE_CHARS, "") : s);

/** A display name: unsafe characters stripped, at most `max` characters (whole code points). */
export function cleanName(s: string, max = 40): string {
  const t = cleanText(s);
  if (t.length <= max) return t;
  return Array.from(t.slice(0, max * 2)).slice(0, max).join("");
}

const opt = <T>(c: Check<T>): Check<T | undefined> => Object.assign((v: unknown, at: string) => (v === undefined || v === null ? undefined : c(v, at)), { optional: true as const });
export { opt };

/** A finite number in [lo, hi]. */
export const num = (lo = -BIG, hi = BIG): Check<number> => (v, at) =>
  typeof v === "number" && Number.isFinite(v) ? (v >= lo && v <= hi ? v : fail(at, `out of range ${v}`)) : fail(at, "not a finite number");

/** An integer in [lo, hi]. */
export const int = (lo = -BIG, hi = BIG): Check<number> => (v, at) =>
  Number.isInteger(v) ? ((v as number) >= lo && (v as number) <= hi ? (v as number) : fail(at, `out of range ${v as number}`)) : fail(at, "not an integer");

export const money: Check<number> = num(-MONEY, MONEY);
export const day: Check<number> = num(-DAYS, DAYS);
export const pct100: Check<number> = num(-1, 101);

export const bool: Check<boolean> = (v, at) => (typeof v === "boolean" ? v : fail(at, "not true/false"));

/** A string of at most `max` characters, unsafe characters stripped. Longer = refused (ids and text never grow). */
export const str = (max = 200): Check<string> => (v, at) =>
  typeof v === "string" ? (v.length <= max ? cleanText(v) : fail(at, `longer than ${max}`)) : fail(at, "not text");

/** A display name: stripped and cut to `max` (a 300 kB name becomes a 40-character one). */
export const name = (max = 40): Check<string> => (v, at) => (typeof v === "string" ? cleanName(v, max) : fail(at, "not a name"));

export const id: Check<string> = str(80);
export const text: Check<string> = str(4000);

/** One of the listed values. */
export const oneOf = <T extends string | number | boolean>(...vals: readonly T[]): Check<T> => (v, at) =>
  vals.includes(v as T) ? (v as T) : fail(at, `not one of ${vals.join("/")}`);

/** An array of at most `max` items (at least `min`). */
export const arr = <T>(item: Check<T>, max: number, min = 0): Check<T[]> => (v, at) => {
  if (!Array.isArray(v)) return fail(at, "not a list");
  if (v.length > max || v.length < min) return fail(at, `list of ${v.length} (allowed ${min}-${max})`);
  const out = new Array<T>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = item(v[i], `${at}[${i}]`);
  return out;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const DROP = (k: string) => k === "__proto__";

/** Any JSON value, sanitised: finite numbers, capped strings/lists/keys, bounded depth. For fields with no stricter schema. */
export function json(depth = 16): Check<unknown> {
  const walk = (v: unknown, at: string, d: number): unknown => {
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : fail(at, "not a finite number");
    if (typeof v === "string") return v.length <= 4000 ? cleanText(v) : fail(at, "text too long");
    if (d <= 0) return fail(at, "nested too deep");
    if (Array.isArray(v)) {
      if (v.length > 5000) return fail(at, "list too long");
      return v.map((x, i) => walk(x, `${at}[${i}]`, d - 1));
    }
    if (isObj(v)) {
      const keys = Object.keys(v);
      if (keys.length > 2000) return fail(at, "too many keys");
      const out: Record<string, unknown> = {};
      for (const k of keys) if (!DROP(k) && v[k] !== undefined) out[k] = walk(v[k], `${at}.${k}`, d - 1);
      return out;
    }
    return fail(at, "not JSON");
  };
  return (v, at) => walk(v, at, depth);
}
export const anyJson: Check<unknown> = json();

/**
 * An object with the listed fields (an `opt()` field may be absent). Other keys: dropped when `rest` is false (top-level
 * states), otherwise kept through `rest` (default: sanitised JSON), so a nested field this schema doesn't name survives.
 */
export function obj<T = Record<string, unknown>>(shape: Record<string, Check>, rest: Check | false = anyJson): Check<T> {
  const keys = Object.keys(shape);
  return (v, at) => {
    if (!isObj(v)) return fail(at, "not an object");
    // The input's key order is kept, so a real save comes back byte-identical through a non-canonical serialiser.
    const out: Record<string, unknown> = {};
    let extra = 0;
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (DROP(k) || x === undefined) continue;
      const c = Object.hasOwn(shape, k) ? shape[k]! : null;
      if (c) {
        if (x === null && c.optional) continue;
        const y = c(x, `${at}.${k}`);
        if (y !== undefined) out[k] = y;
      } else if (rest) {
        if (++extra > 200) fail(at, "too many keys");
        out[k] = rest(x, `${at}.${k}`);
      }
    }
    for (const k of keys) if (!Object.hasOwn(out, k) && !shape[k]!.optional) fail(`${at}.${k}`, "missing");
    return out as T;
  };
}

/** A map (Record) of at most `max` entries; keys are capped like ids. */
export const rec = <T>(val: Check<T>, max = 2000, key: Check<string> = id): Check<Record<string, T>> => (v, at) => {
  if (!isObj(v)) return fail(at, "not a map");
  const keys = Object.keys(v);
  if (keys.length > max) return fail(at, `map of ${keys.length} (allowed ${max})`);
  const out: Record<string, T> = {};
  for (const k of keys) {
    if (DROP(k) || v[k] === undefined) continue;
    out[key(k, `${at}{key}`)] = val(v[k], `${at}.${k}`);
  }
  return out;
};

/** The sims' RNG state: four uint32 words. */
export const rngState: Check<number[]> = arr(int(0, 0xffffffff), 4, 4);

/** Runs a check; a SchemaError (or anything else) becomes `null`. */
export function tryCheck<T>(c: Check<T>, v: unknown, at = "$"): T | null {
  try { return c(v, at); } catch { return null; }
}
