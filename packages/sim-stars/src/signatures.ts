/**
 * Signature dishes. The game should cook from `withSignatures(content, stars)` instead of the raw pack: researched
 * dishes get × SIGNATURE_APPEAL_MULT appeal for every segment and + SIGNATURE_CEILING_BONUS quality ceiling, and are
 * renamed "… (signature)". Personality and footfall lifts are applied inside stepStarsDay / the ledger.
 * Memoised on the researched list, so a stable pack object is returned between research completions.
 */
import type { ContentPack } from "@full-plate/sim-core";
import { SIGNATURE_APPEAL_MULT, SIGNATURE_CEILING_BONUS } from "./constants";
import type { StarsState } from "./types";

const cache = new WeakMap<ContentPack, { key: string; pack: ContentPack }>();

export function withSignatures(content: ContentPack, stars: Pick<StarsState, "testKitchen">): ContentPack {
  const ids = stars.testKitchen.researched;
  if (ids.length === 0) return content;
  const key = ids.join("|");
  const hit = cache.get(content);
  if (hit && hit.key === key) return hit.pack;
  const set = new Set(ids);
  const pack: ContentPack = {
    ...content,
    dishes: content.dishes.map((d) =>
      set.has(d.id)
        ? {
            ...d,
            name: `${d.name} (signature)`,
            qualityCeiling: Math.min(100, d.qualityCeiling + SIGNATURE_CEILING_BONUS),
            baseAppeal: Object.fromEntries(Object.entries(d.baseAppeal).map(([k, v]) => [k, Math.min(1, v * SIGNATURE_APPEAL_MULT)])),
          }
        : d,
    ),
  };
  cache.set(content, { key, pack });
  return pack;
}

export function isSignature(stars: Pick<StarsState, "testKitchen">, dishId: string): boolean {
  return stars.testKitchen.researched.includes(dishId);
}
