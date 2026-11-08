/**
 * GoalSystem — a fixed, scripted ladder of guided goals (src/goals/text.ts). newGame seeds tier 0;
 * when a tier is finished the next tier is appended. Progress is recomputed from state after every
 * command and every evening (`updateGoals` is idempotent), completed goals pay their small reward once
 * and emit GOAL_COMPLETED.
 */
import { GOAL_PROFIT_WEEK_DAYS } from "../constants";
import { GOAL_LADDER, GOAL_LINES, type GoalDef } from "../goals/text";
import type { ContentPack, GameState, Goal, SimEvent } from "../types";
import { clamp, logEvent, round2 } from "../util";
import type { SystemResult } from "./system";

function targetOf(content: ContentPack, def: GoalDef): number {
  return def.target === "tablesPlus2" ? Math.max(5, content.balance.startingTables + 2) : def.target;
}

export function goalsForTier(content: ContentPack, tier: number): Goal[] {
  return GOAL_LADDER.filter((d) => d.tier === tier).map((d) => {
    const target = targetOf(content, d);
    return {
      id: d.id,
      kind: d.kind,
      tier: d.tier,
      title: d.title.replaceAll("{target}", String(target)),
      hint: d.hint.replaceAll("{target}", String(target)),
      target,
      progress: 0,
      done: false,
      ...(d.role ? { role: d.role } : {}),
      ...(d.reward ? { reward: { ...d.reward } } : {}),
    };
  });
}

/** Consecutive profitable days, newest first. */
function profitStreak(state: GameState): number {
  let n = 0;
  for (let i = state.history.length - 1; i >= 0 && state.history[i]!.profit > 0; i--) n++;
  return n;
}

/** Current measure for a goal (before max-ing with stored progress for monotonic goals). */
function measure(content: ContentPack, state: GameState, g: Goal): number {
  const last = state.history.at(-1);
  switch (g.kind) {
    case "add_dishes":
      return state.menu.filter((m) => m.active).length;
    case "hire_role":
      return state.staff.filter((s) => s.role === g.role).length;
    case "order_stock":
      return state.orders.length > 0 ? 1 : 0;
    case "open_first_day":
      return state.phase === "service" || state.stats.daysOpen > 0 ? 1 : 0;
    case "serve_covers":
      return last?.covers ?? 0;
    case "earn_rating":
      return last && last.covers > 0 ? round2(last.averageRating) : 0;
    case "profit_day":
      return g.target > 1 ? profitStreak(state) : last && last.profit > 0 ? 1 : 0;
    case "profit_week": {
      const week = state.history.slice(-GOAL_PROFIT_WEEK_DAYS);
      return week.length >= GOAL_PROFIT_WEEK_DAYS && week.reduce((a, d) => a + d.profit, 0) > 0 ? 1 : 0;
    }
    case "buy_table":
      return g.id === "t3-tables" ? state.tables.length : Math.max(0, state.tables.length - content.balance.startingTables);
    case "survive_days":
      return state.stats.daysOpen;
    case "resolve_incident":
      return state.incidentsHandled ?? 0;
    case "reach_popularity":
      return Math.floor(state.reputation.popularity);
  }
}

/** Streaks can fall back; everything else only goes up. */
const isStreak = (g: Goal): boolean => g.kind === "profit_day" && g.target > 1;

function rewardText(g: Goal): string {
  const parts: string[] = [];
  if (g.reward?.cash) parts.push(`£${Math.round(g.reward.cash / 100)}`);
  if (g.reward?.popularity) parts.push(`+${g.reward.popularity} popularity`);
  return parts.join(" and ");
}

const NOTHING: SimEvent[] = [];

export function updateGoals(content: ContentPack, state: GameState): SystemResult {
  const goals = state.goals;
  if (!goals || goals.length === 0 || state.phase === "gameover") return { state, events: NOTHING };
  // Fast path: every goal finished (most of a long game).
  if (goals[goals.length - 1]!.done && goals.every((g) => g.done)) return { state, events: NOTHING };
  let changed = false;
  let cash = state.cash;
  let popularity = state.reputation.popularity;
  const events: SimEvent[] = [];
  const next = goals.map((g) => {
    if (g.done) return g;
    const m = measure(content, state, g);
    const progress = isStreak(g) ? m : Math.max(g.progress, m);
    if (progress >= g.target) {
      changed = true;
      cash += g.reward?.cash ?? 0;
      popularity += g.reward?.popularity ?? 0;
      events.push({ type: "GOAL_COMPLETED", goalId: g.id });
      const reward = rewardText(g);
      const line = reward ? GOAL_LINES.reward.replace("{reward}", reward) : GOAL_LINES.completed;
      events.push(logEvent(state, line.replace("{title}", g.title), "good"));
      return { ...g, progress: g.target, done: true };
    }
    if (progress === g.progress) return g;
    changed = true;
    return { ...g, progress };
  });
  if (!changed) return { state, events: NOTHING };
  let all = next;
  // Unlock the next tier once the highest tier present is all done.
  const top = Math.max(...all.map((g) => g.tier));
  if (all.filter((g) => g.tier === top).every((g) => g.done)) {
    const more = goalsForTier(content, top + 1);
    if (more.length) all = [...all, ...more];
  }
  const s: GameState = {
    ...state,
    goals: all,
    cash,
    reputation: { ...state.reputation, popularity: round2(clamp(popularity, 0, 100)) },
  };
  // A new tier may already be partly (or fully) met.
  if (all.length !== next.length) {
    const again = updateGoals(content, s);
    return { state: again.state, events: [...events, ...again.events] };
  }
  return { state: s, events };
}

export function goalSystem(content: ContentPack, state: GameState): SystemResult {
  return updateGoals(content, state);
}
