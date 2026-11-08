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
  weekdayOf,
  isWeekend,
  monthOf,
  shiftCost,
} = sim;
