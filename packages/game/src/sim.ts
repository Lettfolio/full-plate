/**
 * The ONLY module in the game that touches the simulation or the content pack.
 * Everything else imports from "./sim" (types may come from "@full-plate/sim-core" directly).
 */
import * as sim from "@full-plate/sim-core";
import { content as realContent } from "@full-plate/content";
import type { ContentPack } from "@full-plate/sim-core";

export type * from "@full-plate/sim-core";

export const content: ContentPack = realContent;

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

// ── round 2: optional exports the sim agent is adding in parallel ──
// Read by name so the game typechecks and runs whether or not they have landed yet.
const optional = sim as unknown as Record<string, unknown>;
const firstNumber = (...names: string[]): number | undefined => {
  for (const n of names) if (typeof optional[n] === "number") return optional[n] as number;
  return undefined;
};

/** Fee for one TRAIN day, if sim-core exports it (undefined → the UI shows "£—"). */
export const TRAINING_FEE: number | undefined = firstNumber("TRAINING_FEE", "TRAIN_FEE", "TRAINING_COST", "TRAIN_COST");

type OrderLine = { ingredientId: string; qty: number };
/**
 * sim-core's own restock suggestion (`suggestedOrder(content, state)`), normalised to order lines, or
 * null while it hasn't landed (callers then fall back to the UI forecast in screens/planning/stockNeeds).
 * Accepts either a Record<ingredientId, qty> or an array of { ingredientId, qty }.
 */
export function simSuggestedOrder(state: sim.GameState): OrderLine[] | null {
  const fn = optional.suggestedOrder;
  if (typeof fn !== "function") return null;
  const raw = (fn as (c: ContentPack, s: sim.GameState) => unknown)(content, state);
  const lines: OrderLine[] = Array.isArray(raw)
    ? (raw as OrderLine[]).map((l) => ({ ingredientId: l.ingredientId, qty: l.qty }))
    : raw && typeof raw === "object" ? Object.entries(raw as Record<string, number>).map(([ingredientId, qty]) => ({ ingredientId, qty })) : [];
  return lines.filter((l) => typeof l.ingredientId === "string" && Number.isInteger(l.qty) && l.qty > 0);
}
