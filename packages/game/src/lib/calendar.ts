import { DAYS_PER_MONTH, MINUTES_PER_TICK, SERVICE_TICKS, isWeekend, monthOf, weekdayOf } from "../sim";

/** Calendar labels. All the rules (start month, weekday of day 0, weekend) come from sim-core. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Rota index for a day: 0 = Monday … 6 = Sunday (sim-core `weekdayOf`). */
export function weekdayIndex(day: number): number {
  return weekdayOf(day);
}

export { isWeekend };

export function dateLabel(day: number): string {
  const monthsIn = Math.floor(day / DAYS_PER_MONTH);
  const year = 1 + Math.floor(monthsIn / 12); // years of trading, not calendar years
  return `${WEEKDAYS[weekdayIndex(day)]} ${(day % DAYS_PER_MONTH) + 1} ${MONTHS[monthOf(day) - 1]} · Year ${year}`;
}

/** 12:00 at tick 0 → 22:00 at SERVICE_TICKS. */
export function clockLabel(tick: number): string {
  const t = Math.max(0, Math.min(SERVICE_TICKS, tick));
  const minutes = 12 * 60 + t * MINUTES_PER_TICK;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The first morning of a new game: the larder is empty until the first "Open" buys opening stock (sim-core isFirstService). */
export function isOpeningDay(game: { day: number; history: readonly unknown[]; stats: { daysOpen: number } }): boolean {
  return game.day === 0 && game.history.length === 0 && game.stats.daysOpen === 0;
}
