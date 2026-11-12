/**
 * Round 11 (D, red-team U8): the "No grown-up drinks" setting (off by default since Round 11b; a parent can switch it on in Settings).
 *
 * A content VIEW, applied when the game loads (and again if the player flips the setting): every alcoholic drink, the
 * ingredients they pour from, the Stars wine list and the few lines that mention them are re-worded as soft drinks of
 * the same shape. Ids, prices, costs, prestige, shelf lives — every number — stay exactly as shipped, so saves,
 * determinism and balance are untouched; only display strings change. Cooking with ale or wine (pie, jus, batter) is
 * re-worded too, so no screen says "ale" or "wine" with the setting on.
 *
 * The swap is by exact string, through the whole pack and extras (names, blurbs, notes, regions, critic and country
 * lines), so text a sim builds from a name at run time ("Pint of lager added to the menu.") follows automatically.
 * Text already written into a save before the switch (old log lines) keeps its words.
 */

/** Dish id → soft name and blurb (same price, cost, prestige and course). */
export const SOFT_DISHES: Readonly<Record<string, { from: [string, string]; to: [string, string] }>> = {
  steak_ale_pie: { from: ["Steak & ale pie", ""], to: ["Steak & onion pie", ""] },
  duck_breast: { from: ["Duck breast, red wine jus", ""], to: ["Duck breast, cherry jus", ""] },
  onion_rings: { from: ["Beer-battered onion rings", ""], to: ["Crispy battered onion rings", ""] },
  house_wine: { from: ["Glass of house wine", "Red or white, friendly and fuss-free. (Over-18s only.)"], to: ["Glass of sparkling elderflower", "Cold, fizzy and flowery, friendly and fuss-free."] },
  fine_red: { from: ["Glass of good red", "Picked by someone who uses the word 'tannins'. (Over-18s only.)"], to: ["Glass of blackcurrant crush", "Deep purple, picked by someone who says 'zingy' a lot."] },
  prosecco: { from: ["Glass of prosecco", "Bubbles for celebrating, or for Tuesday. (Over-18s only.)"], to: ["Glass of fizzy apple", "Bubbles for celebrating, or for Tuesday."] },
  lager: { from: ["Pint of lager", "Cold, crisp and poured with a proper head. (Over-18s only.)"], to: ["Tall fizzy lemonade", "Cold, crisp and poured with a proper froth on top."] },
  local_ale: { from: ["Pint of local ale", "Brewed three streets away by a man with a magnificent beard. (Over-18s only.)"], to: ["Tall local dandelion & burdock", "Brewed three streets away by a man with a magnificent beard."] },
  gin_tonic: { from: ["Gin & tonic", "Ice, a slice, and a satisfying fizz. (Over-18s only.)"], to: ["Tonic & lime", "Ice, a slice, and a satisfying fizz."] },
  espresso_martini: { from: ["Espresso martini", "Shaken hard until it's frothy on top. (Over-18s only.)"], to: ["Iced mocha", "Shaken hard until it's frothy on top."] },
  fd_wine_sparkling: { from: ["Glass of Downs sparkling", "Tiny bubbles from chalky hills, for celebrating. (Over-18s only.)"], to: ["Glass of Downs pressed apple", "Tiny bubbles from chalky hills, for celebrating."] },
  fd_wine_loire: { from: ["Glass of Loire white", "Crisp and zesty, best friends with fish. (Over-18s only.)"], to: ["Glass of lemon & thyme cordial", "Crisp and zesty, best friends with fish."] },
  fd_wine_riesling: { from: ["Glass of Alsace Riesling", "Smells like apples and flowers; sings next to spicy things. (Over-18s only.)"], to: ["Glass of apple blossom press", "Smells like apples and flowers; sings next to spicy things."] },
  fd_wine_white_burgundy: { from: ["Glass of white Burgundy", "Rich and buttery, made for lobster. (Over-18s only.)"], to: ["Glass of peach & vanilla nectar", "Rich and smooth, made for lobster."] },
  fd_wine_rose: { from: ["Glass of Provence rosé", "Pale pink and sunny. (Over-18s only.)"], to: ["Glass of rhubarb & rose pressé", "Pale pink and sunny."] },
  fd_wine_rioja: { from: ["Glass of Rioja reserva", "Warm and spicy, aged in oak barrels for years. (Over-18s only.)"], to: ["Glass of spiced cherry cordial", "Warm and spicy, steeped with cinnamon for days."] },
  fd_wine_red_burgundy: { from: ["Glass of red Burgundy", "Light, silky and fussy to grow: the sommelier's favourite. (Over-18s only.)"], to: ["Glass of pressed Pinot Noir grape", "Light, silky and fussy to grow: the drinks expert's favourite."] },
  fd_wine_sauternes: { from: ["Small glass of Sauternes", "Golden and honey-sweet, for pudding. (Over-18s only.)"], to: ["Small glass of honey & pear nectar", "Golden and honey-sweet, for pudding."] },
};

/** Ingredient id → soft name (same unit cost and shelf life). */
export const SOFT_INGREDIENTS: Readonly<Record<string, [string, string]>> = {
  house_wine: ["House wine (175ml)", "Sparkling elderflower (175ml)"],
  fine_wine: ["Good red wine (175ml)", "Blackcurrant crush (175ml)"],
  prosecco: ["Prosecco (125ml)", "Fizzy apple (125ml)"],
  lager: ["Draught lager (pint)", "Fizzy lemonade on tap (tall glass)"],
  craft_ale: ["Local ale (pint)", "Local dandelion & burdock (tall glass)"],
  wine_albrenn_sparkling: ["Sparkling wine from the downs (glass)", "Sparkling pressed apple from the downs (glass)"],
  wine_loire_white: ["Loire Valley white (glass)", "Lemon & thyme cordial (glass)"],
  wine_alsace_riesling: ["Alsace Riesling (glass)", "Apple blossom press (glass)"],
  wine_burgundy_white: ["White Burgundy (glass)", "Peach & vanilla nectar (glass)"],
  wine_provence_rose: ["Provence rosé (glass)", "Rhubarb & rose pressé (glass)"],
  wine_rioja_red: ["Rioja reserva (glass)", "Spiced cherry cordial (glass)"],
  wine_burgundy_red: ["Red Burgundy (glass)", "Pressed Pinot Noir grape (glass)"],
  wine_sauternes: ["Sweet Sauternes (small glass)", "Honey & pear nectar (small glass)"],
};

/** Stars wine list → the drinks list: bottle id → [name, region, note] before and after (same bottle cost/price). */
export const SOFT_WINES: Readonly<Record<string, { from: [string, string, string]; to: [string, string, string] }>> = {
  bottle_sparkling: { from: ["Downs sparkling", "The Chalk Downs, Albrenn", "Made the slow, careful way; tastes of green apples and toast."], to: ["Downs pressed apple", "The Chalk Downs, Albrenn", "Made the slow, careful way; tastes of green apples and toast."] },
  bottle_loire: { from: ["Loire white", "Loire Valley", "Crisp as a fresh apple, with a squeeze of lemon. Perfect with fish."], to: ["Lemon & thyme cordial", "A herb garden in the Loire Valley", "Crisp as a fresh apple, with a squeeze of lemon. Perfect with fish."] },
  bottle_riesling: { from: ["Alsace Riesling", "Alsace", "Flowery and bright, with just enough sweetness to tame a spicy sauce."], to: ["Apple blossom press", "An orchard in Alsace", "Flowery and bright, with just enough sweetness to tame a spicy sauce."] },
  bottle_white_burgundy: { from: ["White Burgundy", "Burgundy (Côte de Beaune)", "Rich, nutty and buttery; lobster's best friend."], to: ["Peach & vanilla nectar", "A farm near Beaune", "Rich, smooth and creamy; lobster's best friend."] },
  bottle_rose: { from: ["Provence rosé", "Provence", "Pale pink and sunny, like a summer holiday in a glass."], to: ["Rhubarb & rose pressé", "A rose garden in Provence", "Pale pink and sunny, like a summer holiday in a glass."] },
  bottle_rioja: { from: ["Rioja reserva", "Rioja", "Warm vanilla and red berries from years asleep in oak barrels."], to: ["Spiced cherry cordial", "A cherry farm in northern Spain", "Warm vanilla and red berries, steeped with cinnamon for days."] },
  bottle_red_burgundy: { from: ["Red Burgundy", "Burgundy (Côte de Nuits)", "Light, silky and famously fussy to grow; sommeliers sigh over it."], to: ["Pressed Pinot Noir grape", "A vineyard near Nuits", "Light, silky and famously fussy to grow; drinks experts sigh over it."] },
  bottle_sauternes: { from: ["Sauternes", "Sauternes, Bordeaux", "Golden and honey-sweet; made from grapes that are allowed to go wrinkly."], to: ["Honey & pear nectar", "A beekeeper near Bordeaux", "Golden and honey-sweet; made from pears that are allowed to go extra ripe."] },
};

/** Other lines that mention drink, swapped whole. */
export const SOFT_LINES: Readonly<Record<string, string>> = {
  "A guest ate alone, slowly, and asked for the wine list twice. The sommelier is now very nervous.":
    "A guest ate alone, slowly, and asked for the drinks list twice. The drinks expert is now very nervous.",
  "No alcohol on the menu.": "Soft drinks only on the menu.",
  "No pork, no alcohol, halal meat only.": "No pork, soft drinks only, halal meat only.",
  "Halal kitchens use meat from certified suppliers, never serve pork, and keep alcohol off the menu.":
    "Halal kitchens use meat from certified suppliers, never serve pork, and serve soft drinks only.",
};

/** Every original display string → its soft-drinks version. */
export function softDrinkSwaps(): Map<string, string> {
  const m = new Map<string, string>();
  const add = (a: string, b: string) => { if (a && a !== b) m.set(a, b); };
  for (const d of Object.values(SOFT_DISHES)) { add(d.from[0], d.to[0]); add(d.from[1], d.to[1]); }
  for (const [a, b] of Object.values(SOFT_INGREDIENTS)) add(a, b);
  for (const w of Object.values(SOFT_WINES)) w.from.forEach((s, i) => add(s, w.to[i]!));
  for (const [a, b] of Object.entries(SOFT_LINES)) add(a, b);
  return m;
}

/** Words that must not appear on screen with the setting on (whole words, any case). */
export const GROWN_UP_WORDS = /\b(lager|ales?|wines?|prosecco|gin|martini|beers?|beer-battered|sommeliers?|pints?|alcohol(ic)?|riesling|burgundy|rioja|sauternes|champagne|over-18s only)\b/i;

/** Walks plain data (objects and arrays) and replaces every string that `map` has a key for. In place. */
export function swapStrings(root: unknown, map: ReadonlyMap<string, string>): number {
  let n = 0;
  const seen = new Set<object>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    const rec = o as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (typeof v === "string") {
        const r = map.get(v);
        if (r !== undefined) { rec[k] = r; n++; }
      } else if (v && typeof v === "object") walk(v);
    }
  };
  walk(root);
  return n;
}

let applied = false;
/**
 * Switch the soft-drinks view on or off for these packs/extras (in place; idempotent). The game calls this at load
 * with the player's setting and again when it changes. Returns whether anything changed.
 */
export function applySoftDrinks(roots: readonly unknown[], on: boolean): boolean {
  if (on === applied) return false;
  const swaps = softDrinkSwaps();
  const map = on ? swaps : new Map([...swaps].map(([a, b]) => [b, a] as const));
  for (const r of roots) swapStrings(r, map);
  // Round 14 (F, G9): an invented dish's description is built from its ingredients' names ("Your own recipe: burger
  // buns and draught lager."), so no whole-string swap matches it. Swap the drink words inside it too, both ways.
  const words = [...softIngredientWords()].map(([a, b]): [string, string] => (on ? [a, b] : [b, a])).sort((x, y) => y[0].length - x[0].length);
  const seen = new Set<object>();
  for (const r of roots) {
    for (const d of (r as { dishes?: { id?: unknown; blurb?: unknown }[] }).dishes ?? []) {
      if (seen.has(d) || typeof d.id !== "string" || !d.id.startsWith("custom:") || typeof d.blurb !== "string") continue;
      seen.add(d);
      d.blurb = swapWords(d.blurb, words);
    }
  }
  applied = on;
  return true;
}

/** Round 14 (F, G9): each poured ingredient's name as an invented dish's description says it (lower case, no "(pint)"). */
export function softIngredientWords(): Map<string, string> {
  const plain = (x: string) => x.replace(/\s*\(.*\)$/, "").toLowerCase();
  return new Map(Object.values(SOFT_INGREDIENTS).map(([a, b]) => [plain(a), plain(b)] as const));
}
/** Replaces each word in one pass (longest first), so a swapped word is never swapped again. */
function swapWords(text: string, words: readonly (readonly [string, string])[]): string {
  if (!words.length) return text;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const to = new Map(words.map(([a, b]) => [a, b]));
  return text.replace(new RegExp(words.map(([a]) => esc(a)).join("|"), "g"), (m) => to.get(m) ?? m);
}
/** Whether the soft-drinks view is on now. */
export const softDrinksOn = (): boolean => applied;
