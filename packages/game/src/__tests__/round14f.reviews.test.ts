/**
 * Round 14 (F, U10): review lines. (1) No line twice in one evening — a display-only, deterministic re-wording (the
 * save keeps the sim's words). (2) Every template reads properly with every dish name: no "a Apple crumble", no
 * "The Chunky chips was", nothing food-only said about a drink, and a "Cola or lemonade" guest had one of them.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "@full-plate/sim-core";
import { content, newGame, runStrategyDay, STRATEGIES } from "../sim";
import { eveningReviewText, hadOne, parseReview } from "../lib/reviewLines";

const pools = content.reviewTemplates!;
const words = (restaurant: string) => ({ pools, restaurant, dishName: (id: string) => content.dishes.find((d) => d.id === id)?.name });
/** Said of a dish, these only make sense for food. */
const FOOD_ONLY = /licked the plate|piping hot|beige|arrived cold|crunchy|chewy/i;
/** Verbs that must agree with the dish (plural names: "chips", "fries"). */
const AGREES = /^(was|were|is|are|has|have|does|doesn't|wasn't|isn't|hasn't|looks|tastes|smells)\b/;

describe("Round 14 F — U10 review lines", () => {
  it("every template, with every dish name the game can show, reads properly (audit)", () => {
    const problems: string[] = [];
    for (const [key, pool] of Object.entries(pools)) {
      for (const [i, t] of pool.entries()) {
        if (/\ban? \{dish\}/i.test(t)) problems.push(`${key}[${i}] "a {dish}" (a/an)`);
        if (t.includes("{segment}")) problems.push(`${key}[${i}] {segment} is a capitalised name mid-sentence`);
        const after = t.split("{dish}").slice(1).map((x) => x.trimStart());
        if (after.some((x) => AGREES.test(x))) problems.push(`${key}[${i}] the verb after {dish} must agree with it`);
        if (t.includes("{dish}") && FOOD_ONLY.test(t)) problems.push(`${key}[${i}] food-only words about the dish`);
        for (const d of content.dishes) {
          for (const n of [0, 1]) {
            const text = eveningReviewText([{ rating: key === "rough" ? 5 : Number(key), text: t.replaceAll("{dish}", d.name).replaceAll("{restaurant}", "Long Table"), dishId: d.id }], words("Long Table"))[0]!;
            if (/ or /.test(hadOne(d.name, n)) || (t.includes("{dish}") && text.includes(" or lemonade"))) problems.push(`${key}[${i}] "${d.name}" names a choice`);
            if (/\{\w+\}/.test(text)) problems.push(`${key}[${i}] unfilled placeholder with ${d.id}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("a stored line is matched to its template, and re-worded only when it would repeat", () => {
    const t = pools["4"]!;
    const lines = [0, 0, 0].map(() => ({ rating: 4, text: t[2]!.replaceAll("{dish}", "Margherita pizza").replaceAll("{restaurant}", "R"), dishId: "margherita" }));
    expect(parseReview(pools, 4, lines[0]!.text)).toMatchObject({ key: "4", index: 2 });
    const shown = eveningReviewText(lines, words("R"));
    expect(shown[0]).toBe(lines[0]!.text);
    expect(new Set(shown).size).toBe(3);
    expect(eveningReviewText(lines, words("R"))).toEqual(shown); // the same night always reads the same
    expect(lines.every((l) => l.text === t[2]!.replaceAll("{dish}", "Margherita pizza").replaceAll("{restaurant}", "R"))).toBe(true); // stored words untouched
    // Words that match no template (an invented dish's first night) are shown as they are.
    expect(eveningReviewText([{ rating: 4, text: "Something else entirely." }], words("R"))).toEqual(["Something else entirely."]);
    // A choice on the menu: this guest had one of them.
    expect(hadOne("Cola or lemonade", 0)).toBe("Cola");
    expect(hadOne("Cola or lemonade", 1)).toBe("Lemonade");
  });

  it("over 120 real evenings no review line repeats within an evening; a used-up pool is counted, not repeated", () => {
    let g: GameState = newGame(content, { type: "NEW_GAME", seed: 7, districtId: "high_street", restaurantName: "Long Table", difficulty: "normal" });
    let rawRepeats = 0;
    for (let n = 0; n < 120 && g.phase !== "gameover"; n++) {
      g = runStrategyDay(content, g, STRATEGIES.typical);
      const r = g.history.at(-1)!;
      const shown = eveningReviewText(r.reviews, words(g.restaurantName));
      const lines = r.reviews.map((rv, i) => (shown[i] === null ? null : parseReview(pools, rv.rating, shown[i]!))).filter((x) => x);
      const keys = lines.map((p) => `${p!.key}:${p!.index}`);
      if (new Set(r.reviews.map((x) => parseReview(pools, x.rating, x.text)).map((p) => `${p?.key}:${p?.index}`)).size < r.reviews.length) rawRepeats++;
      expect(new Set(keys).size, `day ${r.day}`).toBe(keys.length);
      // Only a pool that is used up hides a review.
      const hidden = r.reviews.filter((_, i) => shown[i] === null).map((rv) => parseReview(pools, rv.rating, rv.text)!.key);
      for (const k of hidden) expect(keys.filter((x) => x.startsWith(`${k}:`)).length).toBe(pools[k]!.length);
    }
    expect(rawRepeats).toBeGreaterThan(30); // the sim does repeat itself; the screen no longer does
  }, 300_000);
});
