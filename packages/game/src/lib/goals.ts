import type { Goal, GoalKind } from "@full-plate/sim-core";

/** Planning tab that a goal's hint points at, for the "Show me" shortcut. */
export const GOAL_TAB: Partial<Record<GoalKind, "menu" | "staff" | "stock" | "restaurant">> = {
  add_dishes: "menu",
  hire_role: "staff",
  order_stock: "stock",
  buy_table: "restaurant",
};

export const MAX_GOALS_SHOWN = 4;

/**
 * Goals to show: up to 4 unfinished goals from the lowest unfinished tier (higher tiers unlock only when
 * every lower tier is done, so they stay hidden), plus any completed today so they can flash with their reward.
 */
export function visibleGoals(goals: readonly Goal[] | undefined, justDone: readonly string[] = []): { open: Goal[]; done: Goal[] } {
  const all = goals ?? [];
  const open = all.filter((g) => !g.done);
  const tier = open.length ? Math.min(...open.map((g) => g.tier)) : Infinity;
  return {
    open: open.filter((g) => g.tier === tier).slice(0, MAX_GOALS_SHOWN),
    done: all.filter((g) => g.done && justDone.includes(g.id)),
  };
}

export function goalFraction(g: Goal): number {
  return g.target > 0 ? Math.max(0, Math.min(1, g.progress / g.target)) : g.done ? 1 : 0;
}

/**
 * Round 11b: after the first week (day 8 on) or once five goals are done, the goals card stops pulsing and glowing
 * (no spotlight, no flash on a finished goal): it is still there, with "Show me", just quiet. Day 1 is unchanged.
 */
export const GOALS_QUIET_DAY = 7;
export const GOALS_QUIET_DONE = 5;
export function goalsQuiet(day: number, goals: readonly Goal[] | undefined): boolean {
  return day >= GOALS_QUIET_DAY || (goals ?? []).filter((g) => g.done).length >= GOALS_QUIET_DONE;
}
