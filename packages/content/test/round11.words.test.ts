/**
 * Round 11 (D): the "No grown-up drinks" content view (red-team U8) and the plain-words pass over the content JSON (U7).
 * Round 11b: the player is 14 — the content trade words (HMRC, VAT, call-out fee, sommelier) are back; the game tips them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySoftDrinks, content, extras, fullContent, GROWN_UP_WORDS, SOFT_DISHES, SOFT_INGREDIENTS, SOFT_WINES, softDrinksOn, softDrinkSwaps,
  swapStrings, validateContent,
} from "../src/index";

const DATA = join(__dirname, "..", "data");
const files = readdirSync(DATA).filter((f) => f.endsWith(".json"));
/** Every display string in a JSON value (ids, tags and other snake_case keys are not shown to the player). */
function strings(v: unknown, out: string[] = [], key = ""): string[] {
  if (typeof v === "string") { if (!/^[a-z0-9_]+$/.test(v) && !key.startsWith("_")) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) strings(x, out, k);
  return out;
}
/** Everything but the words: ids, numbers, structure. */
const shape = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "string" && !/^[a-z0-9_]+$/.test(x) ? "·" : x)));

afterEach(() => { applySoftDrinks([fullContent, content, extras], false); });

describe("No grown-up drinks (content view)", () => {
  it("covers every alcoholic drink, its ingredient and every bottle on the Stars list", () => {
    const drinks = fullContent.dishes.filter((d) => d.course === "drink" && GROWN_UP_WORDS.test(`${d.name} ${d.blurb ?? ""}`));
    expect(drinks.length).toBeGreaterThanOrEqual(15);
    for (const d of drinks) expect(SOFT_DISHES[d.id], d.id).toBeTruthy();
    for (const i of fullContent.ingredients.filter((x) => GROWN_UP_WORDS.test(x.name))) expect(SOFT_INGREDIENTS[i.id], i.id).toBeTruthy();
    for (const w of extras.wineList) expect(SOFT_WINES[w.id], w.id).toBeTruthy();
    // every "from" string is the shipped text, so the swap really finds it
    const all = new Set([...strings(fullContent), ...strings(extras)]);
    for (const from of softDrinkSwaps().keys()) expect(all.has(from), from).toBe(true);
  });

  it("with the setting on, no content string a player can see names a grown-up drink", () => {
    applySoftDrinks([fullContent, content, extras], true);
    expect(softDrinksOn()).toBe(true);
    const bad = [...strings(fullContent), ...strings(extras)].filter((s) => GROWN_UP_WORDS.test(s));
    expect(bad).toEqual([]);
    // the shipped JSON, run through the same swap, is clean too (every file, not only what the pack loads)
    const swaps = softDrinkSwaps();
    for (const f of files) {
      const json = JSON.parse(readFileSync(join(DATA, f), "utf8"));
      swapStrings(json, swaps);
      expect(strings(json).filter((s) => GROWN_UP_WORDS.test(s)), f).toEqual([]);
    }
  });

  it("changes words only: ids, numbers and structure are identical, the pack still validates, and off restores it", () => {
    const before = JSON.stringify(fullContent);
    const beforeShape = shape(fullContent);
    const beforeExtras = shape(extras);
    applySoftDrinks([fullContent, content, extras], true);
    expect(JSON.stringify(fullContent)).not.toBe(before);
    expect(shape(fullContent)).toEqual(beforeShape);
    expect(shape(extras)).toEqual(beforeExtras);
    expect(validateContent(fullContent)).toEqual([]);
    applySoftDrinks([fullContent, content, extras], false);
    expect(JSON.stringify(fullContent)).toBe(before);
  });
});

describe("Trade words in the content JSON (R11b: the player is 14)", () => {
  const all = files.flatMap((f) => strings(JSON.parse(readFileSync(join(DATA, f), "utf8"))).map((s) => [f, s] as const));
  it("the real words are back where R11-D had swapped them (the game tips each one on screen)", () => {
    const has = (f: string, re: RegExp) => all.some(([g, s]) => g === f && re.test(s));
    expect(has("events.json", /A brown envelope from HMRC/)).toBe(true);
    expect(has("events.json", /overpaid VAT/)).toBe(true);
    expect(has("events.json", /call-out fee/)).toBe(true);
    expect(has("criticText.json", /The sommelier is now very nervous/)).toBe(true);
    expect(has("wineList.json", /sommeliers sigh/)).toBe(true);
  });

  it("only the trade words the game's glossary covers appear (no 86'd, tronc, footfall or wholesaler in content lines)", () => {
    expect(all.filter(([, s]) => /\b(wholesalers?|86'd|tronc|footfall)\b/i.test(s))).toEqual([]);
  });

  it("the burnout line no longer has a chef sitting in the walk-in fridge", () => {
    expect(all.filter(([, s]) => /sat (down )?in the walk-in/i.test(s))).toEqual([]);
    expect(all.some(([f, s]) => f === "criticText.json" && /upturned crate/.test(s))).toBe(true);
  });
});
