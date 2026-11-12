/**
 * Round 14 (F, U10): what the Evening shows for each review. The sim stores each review's words (sim-core
 * `reviewText`: a template from content `reviewTemplates`, picked by the seeded stream); this only changes how they are
 * SHOWN, never what was stored:
 *
 * - **No repeats in one evening.** A review whose template was already shown tonight is re-worded with the next
 *   unused template of the same pool (its stars, or "rough"), in review order, so the same night always reads the same.
 *   When the pool is used up it isn't shown; the Evening says how many more "said much the same".
 * - **Today's dish name.** The dish is named from the content now (so "Hide alcoholic drinks" and a renamed recipe
 *   apply), and a menu line that is a choice ("Cola or lemonade") names the one this guest had (alternating by index).
 *
 * Text that matches no template (an invented dish's first-night line, old saves' words) is shown as stored.
 */
import type { Review } from "@full-plate/sim-core";

type Pools = Readonly<Record<string, readonly string[]>>;
interface Parsed { key: string; index: number; segment?: string | undefined }

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cache = new WeakMap<object, Map<string, RegExp[]>>();
function regexes(pools: Pools, key: string): RegExp[] {
  let m = cache.get(pools);
  if (!m) cache.set(pools, (m = new Map()));
  let r = m.get(key);
  if (!r) {
    r = (pools[key] ?? []).map((t) => new RegExp(`^${esc(t)
      .replace(/\\\{dish\\\}/g, "(?:.+?)")
      .replace(/\\\{restaurant\\\}/g, "(?:.+?)")
      .replace(/\\\{segment\\\}/g, "(?<segment>.+?)")}$`, "s"));
    m.set(key, r);
  }
  return r;
}

/** Which template wrote this text (its stars' pool first, then the rough-night pool). */
export function parseReview(pools: Pools, rating: number, text: string): Parsed | undefined {
  for (const key of [String(rating), "rough"]) {
    const i = regexes(pools, key).findIndex((re) => re.test(text));
    if (i >= 0) return { key, index: i, segment: regexes(pools, key)[i]!.exec(text)?.groups?.segment };
  }
  return undefined;
}

/** "Cola or lemonade" → "Cola" for one guest and "lemonade" for the next (the menu line is a choice). */
export function hadOne(name: string, n: number): string {
  const parts = name.split(/ or /);
  if (parts.length < 2) return name;
  const pick = parts[n % parts.length]!.trim();
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

export interface ReviewWords {
  pools: Pools;
  restaurant: string;
  /** The dish's name now (content, soft-drinks view, invented dishes). */
  dishName: (id: string) => string | undefined;
}

/**
 * The words to show for each review tonight, in order; null for a review whose every line has already been shown
 * tonight (a busy night has more 5★ guests than the pool has lines): the Evening counts those as "said much the same".
 */
export function eveningReviewText(reviews: readonly Pick<Review, "rating" | "text" | "dishId">[], w: ReviewWords): (string | null)[] {
  const used = new Set<string>();
  return reviews.map((rv, i) => {
    const p = parseReview(w.pools, rv.rating, rv.text);
    if (!p) return rv.text;
    const pool = w.pools[p.key]!;
    let index = p.index;
    const fits = (j: number) => !used.has(`${p.key}:${j}`) && (!pool[j]!.includes("{segment}") || p.segment !== undefined);
    if (!fits(index)) {
      let found = false;
      for (let k = 1; k < pool.length && !found; k++) {
        const j = (p.index + k) % pool.length;
        if (fits(j)) { index = j; found = true; }
      }
      if (!found) return null; // every line of this pool has been said tonight: "said much the same"
    }
    used.add(`${p.key}:${index}`);
    const known = rv.dishId ? w.dishName(rv.dishId) : undefined;
    if (rv.dishId && known === undefined && index === p.index) return rv.text;
    const name = known ?? "food";
    return pool[index]!
      .replaceAll("{dish}", hadOne(name, i))
      .replaceAll("{restaurant}", w.restaurant)
      .replaceAll("{segment}", p.segment ?? "guest");
  });
}
