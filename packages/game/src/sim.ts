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
import { content as libraryPack, extras, fullContent, inLibrary as contentInLibrary, tagsOf as contentTagsOf } from "@full-plate/content";
import type { Command, ContentPack, GameState } from "@full-plate/sim-core";

export type * from "@full-plate/sim-core";

/** Incident and goal text travel with the pack (sim-core reads `ContentPack.incidentText/goalText` once it supports them). */
function withText(pack: ContentPack): ContentPack {
  return { ...pack, incidentText: extras.incidentText, goalText: extras.goalText } as unknown as ContentPack;
}

/** The owner game's pack: every dish, plus the Round 3 text. */
export const content: ContentPack = withText(fullContent);
/** The career's employer pack: library dishes only (the AI owner chooses from what it is given). */
export const careerContent: ContentPack = withText(libraryPack);
export { extras };
export const inLibrary = contentInLibrary;
export const tagsOf = contentTagsOf;

export const { newGame, applyCommand, tick, runDay, candidates, classifyMenu, serialize, deserialize } = sim;

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
 * Round 3 review P2: the one hire-affordability rule the UI uses, read only from sim-core exports (no copied
 * constants). It is sim-core's HIRE / HIRE_STAFF cash rule: the game's recruitment fee (`recruitmentFeeOf`, which
 * honours the career manager's cheaper-hiring perk) plus HIRE_CASH_BUFFER_SHIFTS shifts of the person's wages
 * (`shiftCost`). sim-core has no `canHire` export yet; when it gains one, call it here and nowhere else.
 */
export function hireCheck(state: GameState, person: { wage: number }): { fee: number; perShift: number; needed: number; canAfford: boolean } {
  const fee = recruitmentFeeOf(state);
  const perShift = sim.shiftCost(person);
  const needed = fee + sim.HIRE_CASH_BUFFER_SHIFTS * perShift;
  return { fee, perShift, needed, canAfford: state.cash >= needed };
}
