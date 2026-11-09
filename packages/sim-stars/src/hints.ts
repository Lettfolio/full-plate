/**
 * "What's holding you back" — round 3 review P2. A player with a 98-steadiness bistro got "no star, 69" and no idea
 * why. `starsHints` ranks the five criteria by how far the player's OWN recent data (the last week's dishes, the
 * steadiness window, the menu, suppliers, the head chef) sits below the next star's bar, and words each as one plain
 * sentence with a fix.
 *
 * Hidden stays hidden: it never reads this year's inspector visits, the schedule, the assessment accumulators,
 * `lastCriteria` or `inspectorModel`. It re-runs the public criteria formulas (proxies.ts) on what the player can see
 * on their own screens, and returns words only — no criterion scores, no thresholds, no predicted stars.
 */
import type { ContentPack, DayResult, DishDef, GameState } from "@full-plate/sim-core";
import { CRITERIA_KEYS, dayCriteria, produceShares, weakNights, windowConsistency, type DayInputs, type DishLine } from "./proxies";
import { STAR_THRESHOLDS, STRESS_CONSISTENCY_FROM, SUPPLIERS, TECHNIQUE_AMBITION_SCALE } from "./constants";
import type { Criteria, StarsState } from "./types";

export type CriterionKey = keyof Criteria;

export interface StarsHint {
  criterion: CriterionKey;
  /** Player-facing name of the criterion ("Technique"). */
  label: string;
  /** One plain-English sentence: what is weak, in the player's own numbers, and what to do. */
  text: string;
  /** True when this criterion is below the next star's bar on the player's recent form. */
  behind: boolean;
}

export const CRITERION_LABEL: Record<CriterionKey, string> = {
  harmony: "Flavour",
  technique: "Technique",
  personality: "Personality",
  ingredients: "Ingredients",
  consistency: "Consistency",
};

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** Nights of history the hints read (one week, like the menu matrix). */
const HINT_DAYS = 7;

const isFood = (d: DishDef | undefined): d is DishDef => !!d && d.course !== "drink";
const round = (x: number) => Math.round(x);

/**
 * The last week as one "typical night": per-dish sales and plate quality from DayResult.perDish (what the evening
 * screen shows), falling back to the menu's 7-day sales at the steadiness window's mean quality on older saves.
 */
export function recentInputs(content: ContentPack, stars: StarsState, state: GameState): DayInputs {
  const byId = new Map(content.dishes.map((d) => [d.id, d]));
  const days: DayResult[] = state.history.filter((h) => !h.closed && h.covers > 0).slice(-HINT_DAYS);
  const acc = new Map<string, { sold: number; plated: number; q: number }>();
  for (const h of days) {
    for (const [id, l] of Object.entries(h.perDish ?? {})) {
      if (!isFood(byId.get(id))) continue;
      const a = acc.get(id) ?? { sold: 0, plated: 0, q: 0 };
      acc.set(id, { sold: a.sold + l.sold, plated: a.plated + l.plated, q: a.q + l.qualityMean * l.plated });
    }
  }
  let dishes: DishLine[] = [...acc].map(([dishId, a]) => ({ dishId, sold: a.sold, plated: a.plated, ...(a.plated > 0 ? { quality: a.q / a.plated } : {}) }));
  if (!dishes.length) {
    const w = stars.consistencyWindow;
    const q = w.length ? w.reduce((x, y) => x + y, 0) / w.length : undefined;
    dishes = state.menu
      .filter((m) => m.active && isFood(byId.get(m.dishId)) && m.sold7d > 0)
      .map((m) => ({ dishId: m.dishId, sold: m.sold7d, plated: m.sold7d, ...(q !== undefined ? { quality: q } : {}) }));
  }
  dishes.sort((a, b) => (a.dishId < b.dishId ? -1 : a.dishId > b.dishId ? 1 : 0));
  const plated = dishes.reduce((a, d) => a + (d.quality !== undefined ? d.plated : 0), 0);
  const quality = plated > 0 ? dishes.reduce((a, d) => a + (d.quality ?? 0) * d.plated, 0) / plated : 0;
  const covers = days.reduce((a, d) => a + d.covers, 0);
  return { day: state.day, open: dishes.length > 0, covers, quality, dishes };
}

function consistencyText(stars: StarsState, state: GameState, steady: number): string {
  const weak = weakNights(stars.consistencyWindow, stars.consistencyDays).sort((a, b) => a.mean - b.mean)[0];
  if (weak) {
    const chef = state.staff.filter((s) => s.role === "chef" && s.rota[weak.weekday]).sort((a, b) => b.skill - a.skill)[0];
    return `Your weakest night is ${WEEKDAY[weak.weekday]}: it cooks about ${round(weak.mean)} against ${round(weak.others)} the rest of the week${chef ? ` (${chef.name.split(" ")[0]} is the best chef on)` : " (no chef on — you're cooking)"}. Put a stronger chef on, or close that night.`;
  }
  const hc = stars.headChef;
  if ((hc.disruptedUntil ?? -1) > state.day) return "The kitchen is still finding its feet after losing its head chef. Keep the same brigade on every night until it settles.";
  if (hc.stress > STRESS_CONSISTENCY_FROM) return `Your head chef is stressed (${round(hc.stress)}/100) and the cooking wobbles. Stagiaires, a quieter week or a relaunch would help.`;
  const untrained = stars.satellites.filter((s) => !s.headChefTrained).length;
  if (untrained) return `${untrained === 1 ? "A satellite" : `${untrained} satellites`} without a trained head chef ${untrained === 1 ? "pulls" : "pull"} your cooks thin. Train a head chef for ${untrained === 1 ? "it" : "them"}.`;
  return `Steadiness is ${round(steady)}: the guide wants every night to taste the same. Restock every evening and keep your best chefs on the rota.`;
}

function techniqueText(content: ContentPack, inputs: DayInputs): string {
  const byId = new Map(content.dishes.map((d) => [d.id, d]));
  const sold = inputs.dishes.reduce((a, d) => a + d.sold, 0);
  const ambition = sold > 0 ? inputs.dishes.reduce((a, d) => a + (byId.get(d.dishId)?.skillRequired ?? 0) * d.sold, 0) / sold : 0;
  const simplest = [...inputs.dishes].filter((d) => d.sold > 0).sort((a, b) => (byId.get(a.dishId)?.skillRequired ?? 0) - (byId.get(b.dishId)?.skillRequired ?? 0) || b.sold - a.sold)[0];
  const name = simplest ? byId.get(simplest.dishId)?.name : undefined;
  if (TECHNIQUE_AMBITION_SCALE * ambition >= 90) return `Your menu is ambitious enough. Technique now comes from cooking it better (plates come out at about ${round(inputs.quality)}): a stronger chef, or fewer dishes done perfectly.`;
  return `The dishes you sell are cautious (they need about ${round(ambition)} skill on average)${name ? `, and ${name} is the simplest` : ""}. Inspectors want ambition: put two harder dishes on and cook them well.`;
}

function harmonyText(content: ContentPack, inputs: DayInputs): string {
  const tasted = inputs.dishes.filter((d) => d.quality !== undefined && d.plated > 0);
  const worst = [...tasted].sort((a, b) => (a.quality ?? 0) - (b.quality ?? 0))[0];
  if (worst && tasted.length > 1) {
    const rest = tasted.filter((d) => d !== worst);
    const others = rest.reduce((a, d) => a + (d.quality ?? 0) * d.plated, 0) / Math.max(1, rest.reduce((a, d) => a + d.plated, 0));
    const name = content.dishes.find((d) => d.id === worst.dishId)?.name ?? worst.dishId;
    if ((worst.quality ?? 0) < others - 3) return `Your weakest dish is ${name}: it comes out at about ${round(worst.quality ?? 0)} against ${round(others)} for the rest, and one weak dish drags the whole meal. Fix it or take it off.`;
  }
  return `Plates come out at about ${round(inputs.quality)}. A better chef, fresher stock and dishes within your brigade's skill lift every course.`;
}

function personalityText(content: ContentPack, stars: StarsState, state: GameState): string {
  const food = state.menu.filter((m) => m.active && isFood(content.dishes.find((d) => d.id === m.dishId)));
  const n = food.length;
  const sig = food.filter((m) => stars.testKitchen.researched.includes(m.dishId)).length;
  const plain = n - sig;
  const ofYours = (k: number) => `${k} of your ${n} dish${n === 1 ? "" : "es"} ${k === 1 ? "is" : "are"}`;
  if (!stars.testKitchen.unlocked) return `${sig === 0 ? `None of your ${n} dish${n === 1 ? "" : "es"} is` : `Only ${ofYours(sig)}`} your own. Inspectors want signatures: build the test kitchen and develop one.`;
  if (sig < stars.testKitchen.researched.length) return "You have signatures that aren't on the menu. Put them on: inspectors want to taste the chef's own dishes.";
  if (stars.testKitchen.inProgress) return `${ofYours(plain)} still other people's recipes. Your test kitchen is on it — put each new signature on the menu when it's ready.`;
  if (plain === 0) return "Every dish is a signature. The head chef's reputation grows with each open night; keep them happy and in the kitchen.";
  return `${ofYours(plain)} not signatures yet. Inspectors want the chef's own food: develop another in the test kitchen.`;
}

function ingredientsText(content: ContentPack, stars: StarsState, inputs: DayInputs): string {
  const p = produceShares(content, stars, inputs);
  if (!stars.sourcing.length) return "You buy everything from the wholesaler. Sign a local farm or boat under Sourcing: the guide notices where the produce comes from.";
  const unsigned = SUPPLIERS.length - stars.sourcing.length;
  const rel = stars.sourcing.reduce((a, s) => a + s.relationship, 0) / stars.sourcing.length;
  if (p.season < 0.5) return `Only about ${round(p.season * 100)}% of your fresh produce is in season this month. Cook with the season (a tasting menu that's in season is the quick way).`;
  if (rel < 50) return `Your suppliers are still getting to know you (relationship about ${round(rel)}/100). It grows every night you're open${unsigned ? `, and ${unsigned} more supplier${unsigned === 1 ? " is" : "s are"} waiting to sign` : ""}.`;
  return unsigned ? `${unsigned} local supplier${unsigned === 1 ? " is" : "s are"} still unsigned. More of your plates from partners lifts the ingredients score.` : "Your produce is local and in season. Keep it that way through the winter months.";
}

/**
 * The five criteria ranked by how far the player's recent form sits below the next star's bar (the current star's
 * bar at ★★★), worst first, each with one plain sentence. Show the first one or two where `behind` is true.
 */
export function starsHints(content: ContentPack, stars: StarsState, state: GameState): StarsHint[] {
  const inputs = recentInputs(content, stars, state);
  const steady = windowConsistency(stars.consistencyWindow);
  const est: Criteria = inputs.open
    ? dayCriteria(content, stars, inputs, stars.consistencyWindow)
    : { harmony: 0, technique: 0, personality: 0, ingredients: 0, consistency: steady };
  const bar = STAR_THRESHOLDS[Math.min(2, stars.guides.michelin.stars)]!;
  const text: Record<CriterionKey, () => string> = {
    consistency: () => consistencyText(stars, state, steady),
    technique: () => techniqueText(content, inputs),
    harmony: () => harmonyText(content, inputs),
    personality: () => personalityText(content, stars, state),
    ingredients: () => ingredientsText(content, stars, inputs),
  };
  return CRITERIA_KEYS.map((k, i) => ({ k, gap: bar - est[k], i }))
    .sort((a, b) => b.gap - a.gap || a.i - b.i)
    .map(({ k, gap }) => ({ criterion: k, label: CRITERION_LABEL[k], text: text[k](), behind: gap > 0 }));
}
