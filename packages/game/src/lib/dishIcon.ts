import type { DishCourse } from "@full-plate/sim-core";

/**
 * Round 14 (E, U20): a picture per dish from what it is, not one per course (every starter was 🥗, so cheesy garlic
 * bread and prawn cocktail wore a salad). First matching word wins, in this order (so "Fish & chips" is fish, "Cheesy
 * chips" is chips); a dish matching nothing falls back to its course's picture.
 */
const DRINKS: [RegExp, string][] = [
  [/\b(glass of|wine|riesling|burgundy|rioja|sauternes|ros[eé]|loire|prosecco|sparkling)\b/i, "🍷"],
  [/\b(lager|ale|beer)\b/i, "🍺"],
  [/\b(gin|martini|cocktail)\b/i, "🍸"],
  [/\b(flat white|coffee|espresso)\b/i, "☕"],
  [/\btea\b/i, "🍵"],
  [/\b(hot chocolate)\b/i, "☕"],
  [/\b(milkshake|shake)\b/i, "🥤"],
  [/\b(lemonade|cola|juice|fountain|drink)\b/i, "🥤"],
];
/** Food only (a drink's words never match a dish: "Steak & ale pie" is a pie). */
const WORDS: [RegExp, string][] = [
  [/\bprawn cocktail\b/i, "🍤"],
  [/\b(soup|bisque|shot)\b/i, "🍲"],
  [/\b(garlic bread|bruschetta|sourdough|toast)\b/i, "🥖"],
  [/\b(pizza)\b/i, "🍕"],
  [/\b(burger|stacker|bun)\b/i, "🍔"],
  [/\b(wrap)\b/i, "🌯"],
  [/\b(spaghetti|pasta|linguine|carbonara|bolognese|raviolo|mac & cheese)\b/i, "🍝"],
  [/\b(ramen|noodle)/i, "🍜"],
  [/\b(gyoza)\b/i, "🥟"],
  [/\b(curry|masala|tikka)\b/i, "🍛"],
  [/\b(risotto)\b/i, "🍚"],
  [/\b(pie|pasty|crumble)\b/i, "🥧"],
  [/\b(fish|cod|salmon|turbot|fishcakes)\b/i, "🐟"],
  [/\b(prawn|scallop|langoustine|lobster|moules|mussels|seafood)/i, "🦐"],
  [/\b(steak|beef|sirloin|venison|lamb)\b/i, "🥩"],
  [/\b(chicken|nugget|duck)\b/i, "🍗"],
  [/\b(bangers|sausage|pork|bacon)\b/i, "🌭"],
  [/\b(full english|egg|muffin|hash brown)\b/i, "🍳"],
  [/\b(jacket potato|potato skins)\b/i, "🥔"],
  [/\b(chips|fries|frites)\b/i, "🍟"],
  [/\b(onion rings)\b/i, "🧅"],
  [/\b(salad|peas|leeks|asparagus|beetroot)\b/i, "🥗"],
  [/\b(cheese|halloumi|gougères|ploughman)/i, "🧀"],
  [/\b(ice cream|sorbet|cone|knickerbocker)\b/i, "🍨"],
  [/\b(brownie|chocolate|cookie)\b/i, "🍫"],
  [/\b(pudding|tiramisu|brûlée|soufflé|custard|eton mess|tart|cake)\b/i, "🍮"],
  [/\b(strawberr|rhubarb|apple|passion fruit|yuzu)/i, "🍓"],
];

export const COURSE_FALLBACK: Record<DishCourse, string> = { starter: "🥣", main: "🍽️", dessert: "🍰", drink: "🥤", side: "🍟" };

export function dishIcon(name: string, course: DishCourse): string {
  for (const [re, icon] of course === "drink" ? DRINKS : WORDS) if (re.test(name)) return icon;
  return COURSE_FALLBACK[course] ?? "🍽️";
}
