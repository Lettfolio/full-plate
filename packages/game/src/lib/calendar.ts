import { MINUTES_PER_TICK, SERVICE_TICKS } from "../sim";

/**
 * The public contract (types.ts / index.ts) has no calendar. These mirror sim-core's internal
 * src/constants.ts (DAYS_PER_MONTH = 30, START_MONTH = 4 i.e. April, rota index = day % 7 with
 * 0 = Monday). If sim-core exports
 * them from index.ts, import them instead. See docs/UI-NOTES.md → contract gaps.
 */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const START_MONTH = 3; // 0-based: April (sim-core START_MONTH = 4)

export function weekdayIndex(day: number): number {
  return ((day % 7) + 7) % 7;
}

export function dateLabel(day: number): string {
  const monthsIn = Math.floor(day / 30);
  const month = (START_MONTH + monthsIn) % 12;
  const year = 1 + Math.floor(monthsIn / 12); // years of trading, not calendar years
  return `${WEEKDAYS[weekdayIndex(day)]} ${(day % 30) + 1} ${MONTHS[month]} · Year ${year}`;
}


/** 12:00 at tick 0 → 22:00 at SERVICE_TICKS. */
export function clockLabel(tick: number): string {
  const t = Math.max(0, Math.min(SERVICE_TICKS, tick));
  const minutes = 12 * 60 + t * MINUTES_PER_TICK;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
