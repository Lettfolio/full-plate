/**
 * The ONLY module in the game that touches the simulation or the content pack.
 * Everything else imports from "./sim" (types may come from "@full-plate/sim-core" directly).
 *
 * Round 3: the game cooks with the FULL pack (library + fast-food + fine-dining dishes) everywhere, because a save
 * made after the fork can name `ff_*` / `fd_*` dishes and must load with the same pack. The starter library hides
 * the path dishes (`inLibrary`) until the matching fork. Career games run on the library pack (the AI owner picks
 * from every dish it is given); a library save loads fine under the full pack after the handover.
 */
import * as sim from "@full-plate/sim-core";
import { applySoftDrinks, cookbookStep, customBase, syncCustomDishes as syncDishes, type CookbookMeta, content as libraryPack, extras, fullContent, inLibrary as contentInLibrary, tagsOf as contentTagsOf, type CustomDishSpec } from "@full-plate/content";
import { getSettings, subscribeSettings } from "./lib/settings";
import type { Command, ContentPack, GameState } from "@full-plate/sim-core";

export type * from "@full-plate/sim-core";

/** Incident and goal text travel with the pack (sim-core reads `ContentPack.incidentText/goalText` once it supports them). */
function withText(pack: ContentPack): ContentPack {
  return { ...pack, incidentText: extras.incidentText, goalText: extras.goalText } as unknown as ContentPack;
}

/**
 * Round 11 (D, U8): "No grown-up drinks" (Settings, on by default) re-words the drinks in place — names, blurbs, the
 * Stars wine list and a few lines; ids and every number are unchanged, so saves and the sim's results are identical.
 */
export function syncSoftDrinks(on: boolean = getSettings().noGrownUpDrinks): boolean {
  return applySoftDrinks([fullContent, libraryPack, extras], on);
}
syncSoftDrinks();
if (typeof window !== "undefined") subscribeSettings(() => { syncSoftDrinks(); });

/** The owner game's pack: every dish, plus the Round 3 text. */
export const content: ContentPack = withText(fullContent);
/** The career's employer pack: library dishes only (the AI owner chooses from what it is given). */
export const careerContent: ContentPack = withText(libraryPack);
export { extras };

// ── Round 12 (F): invented dishes (packages/content/src/customDish.ts) ──
/** The pack whose real dishes an invented dish's numbers are derived from (the starter library; fixed for a game). */
export const customRef: ContentPack = libraryPack;
/** Puts this game's invented dishes into the owner pack (`content` and the full pack); memoised on the array. */
export const syncCustomDishes = (specs: readonly CustomDishSpec[] | undefined): boolean => syncDishes([fullContent, content], specs, customRef);
/** The reducer's step after every action: sync the pack, fold the day's sales into the cookbook. */
export const cookbook = <M extends CookbookMeta>(meta: M, game: GameState | null): M => cookbookStep([fullContent, content], customRef, meta, game);
/** `content`, or a fresh copy once invented dishes changed it (sim-stars memoises signatures per pack object). */
export const cookingBase = (): ContentPack => customBase(content);

export const inLibrary = contentInLibrary;
export const tagsOf = contentTagsOf;

export const { newGame, applyCommand, tick, runDay, candidates, classifyMenu, serialize, deserialize } = sim;
// Round 12 (C): the daily challenge builds its scenario with a scripted owner (lib/challenge.ts, lazy).
export const { runStrategyDay, STRATEGIES } = sim;

export const {
  SERVICE_TICKS,
  MINUTES_PER_TICK,
  DAYS_PER_MONTH,
  START_MONTH,
  START_WEEKDAY,
  WEEKEND_DAYS,
  TABLE_COST,
  RECRUITMENT_FEE,
  HIRE_CASH_BUFFER_SHIFTS,
  SHIFT_HOURS,
  MAX_MENU_ITEMS,
  COURSE_ORDER_CHANCE,
  weekdayOf,
  isWeekend,
  monthOf,
  shiftCost,
} = sim;

// ── round 6: the evening's one tip ──
export const { eveningAdvice, adviceTextOf, fillAdvice, actionWords } = sim;
// R7-B: the Staff tab's week strip and the GameOver cause read the round-5 rota rule (pure, no new sim rules).
export const { rotaAdvice, meanProfit, ROTA_ADVICE_DAYS } = sim;

// ── round 10: decorating ──
export const {
  DECOR_SLOTS, DECOR_CAPS, decorCatalogue, decorEffects, decorStyle, decorStyleName, findDecorItem, installedDecor, decorWear, decorWearShare,
  closedTableIds, fittingTablesClosed,
} = sim;

// ── round 2 ──
export const {
  suggestedOrder,
  expectedCovers,
  forecastNeeds,
  openingStockBudget,
  TRAINING_FEE,
  TRAINING_SKILL_GAIN,
  BREAK_TICKS,
  OWNER_FATIGUE_WARNING,
} = sim;

// ── round 3: sim-core hooks, feature-detected ──
/**
 * Commands the round-3 sim-core agent is adding. They are not in this sim-core's `Command` union yet, so the game
 * builds them as `HookCommand` and casts at the door. When the hooks land the casts become no-ops.
 */
export type HookCommand =
  | { type: "PLAYER_COOKED"; ticketId: string; quality: number }
  | { type: "PLAYER_SERVED"; customerId: string; ticketId: string; speedBonus: number }
  | { type: "PLAYER_CLEARED"; tableId: string }
  | { type: "PLAYER_TOOK_PAYMENT"; customerId: string }
  | { type: "PLAYER_DROPPED"; ticketIds: string[]; cost: number }
  | { type: "SET_HANDS_ON"; role: "chef" | "server" | "bar" | null; staffId?: string }
  | { type: "CLOSE_TODAY" }
  | { type: "SET_SET_MENU"; dishIds: string[]; price: number; active: boolean }
  | { type: "SET_OWNER_PROFILE"; skill: number; speed: number; charm: number };

export const asCommand = (c: HookCommand | Command): Command => c as unknown as Command;

const PROBE_STATE = sim.newGame(content, { type: "NEW_GAME", seed: 1, districtId: content.districts[0]!.id, restaurantName: "Probe", difficulty: "normal" });

/** True when sim-core has a handler for the command type (anything but the generic "Unknown command." refusal). */
export function simSupports(type: HookCommand["type"]): boolean {
  const r = sim.applyCommand(content, PROBE_STATE, { type } as unknown as Command);
  return !r.events.some((e) => e.type === "LOG" && e.entry.text === "Unknown command.");
}

/** Which round-3 sim-core hooks this build has. Read once at load; the UI degrades where one is missing. */
export const HOOKS = {
  /** PLAYER_COOKED / SERVED / CLEARED / TOOK_PAYMENT / DROPPED: hands-on results reach the sim. */
  player: simSupports("PLAYER_COOKED"),
  /** SET_HANDS_ON: the sim holds plated tickets at the pass while a hands-on server/bar is live. */
  handsOn: simSupports("SET_HANDS_ON"),
  closeToday: simSupports("CLOSE_TODAY"),
  setMenu: simSupports("SET_SET_MENU"),
  ownerProfile: simSupports("SET_OWNER_PROFILE"),
  /** GameState.recruitmentFee is honoured by HIRE (sim-core exports recruitmentFeeOf). */
  recruitmentFee: typeof (sim as Record<string, unknown>).recruitmentFeeOf === "function",
};

/** The fee HIRE charges in this game (GameState.recruitmentFee, else RECRUITMENT_FEE). */
export const recruitmentFeeOf: (s: GameState) => number = (sim as unknown as { recruitmentFeeOf?: (s: GameState) => number }).recruitmentFeeOf ?? (() => sim.RECRUITMENT_FEE);

/**
 * Round 3 review P2: the one hire-affordability rule the UI uses. Round 11: it *is* sim-core's `hireNeed` (the rule HIRE
 * and HIRE_STAFF apply: fee + a few shifts in the bank; on Cosy the fee may dip into the stock overdraft).
 */
export function hireCheck(state: GameState, person: { wage: number }): { fee: number; perShift: number; needed: number; canAfford: boolean } {
  const { fee, perShift, needed, canAfford } = sim.hireNeed(state, person.wage);
  return { fee, perShift, needed, canAfford };
}

// ── round 11: stop silent losing ──
export const { bankStatus, spendCheck, runningCostPerDay, starterLoanOffer, STARTER_LOAN, BANK_LAST_DAYS, BANK_RED_DAYS, INSOLVENCY_DAYS } = sim;
export const MAX_PRICE_PENCE = sim.MAX_PRICE;

/**
 * Round 11 (U2): what the "Hire →" prompts should say. The role she most needs (a chef, then a server, else anyone) and
 * how much more cash the cheapest such candidate today needs: 0 = she can hire now. Null when nobody in the pool fits.
 */
export function hireShortfall(state: GameState): { role: string; short: number; needed: number } | null {
  const pool = sim.candidates(content, state).filter((c) => !c.hired);
  const has = (r: string) => state.staff.some((s) => s.role === r);
  const role = !has("chef") ? "chef" : !has("server") ? "server" : "";
  const fit = pool.filter((c) => !role || c.role === role);
  if (!fit.length) return null;
  const needed = Math.min(...fit.map((c) => sim.hireNeed(state, c.wage).needed));
  return { role: role || "someone", needed, short: Math.max(0, needed - state.cash) };
}
