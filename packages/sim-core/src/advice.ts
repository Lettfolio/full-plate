/**
 * Round 5 review: the "trim the rota" advice (game Evening tip; the typical headless owner acts on it once noticed).
 *
 * Owner year 1 on hard: the typical script survived 0/100 since round 2 (balanced 45%). Diagnosis (50 seeds each): with
 * its rota trimming, incident answers and owner-cover noticing restored it survives 44%; with only hiring/table
 * thresholds like balanced, 28%; leaner menu or stock, 4–8%. The killer is doubled-up shifts kept through losing
 * weeks — and nothing in the game ever said so. This is the sentence the game now says.
 */
import { shiftCost } from "./systems/finance";
import type { GameState, Staff, StaffRole } from "./types";

/** Days of history the advice averages profit over. */
export const ROTA_ADVICE_DAYS = 14;

export interface RotaAdvice {
  staffId: string;
  name: string;
  role: StaffRole;
  /** Weekday indexes (0 = Monday) this person works alongside someone else in the same role. */
  doubledDays: number[];
  /** What those shifts cost a week, pence. */
  weeklyCost: number;
  /** Mean daily profit over the last ROTA_ADVICE_DAYS days (negative), pence. */
  dailyLoss: number;
}

/** Mean daily profit over the `days` ending at history index `end` (exclusive); undefined with too little history. */
export function meanProfit(history: GameState["history"], days = ROTA_ADVICE_DAYS, end = history.length): number | undefined {
  if (end < days) return undefined;
  const h = history.slice(end - days, end);
  return h.reduce((a, d) => a + d.profit, 0) / h.length;
}

/**
 * When the last fortnight lost money and someone works days a colleague in the same role already covers, the most
 * expensive such doubled-up rota (the later hire on ties). Undefined otherwise. Pure.
 */
export function rotaAdvice(state: Pick<GameState, "history" | "staff">, end = state.history.length): RotaAdvice | undefined {
  const profit = meanProfit(state.history, ROTA_ADVICE_DAYS, end);
  if (profit === undefined || profit >= 0) return undefined;
  let best: RotaAdvice | undefined;
  const byRole = new Map<StaffRole, Staff[]>();
  for (const s of state.staff) byRole.set(s.role, [...(byRole.get(s.role) ?? []), s]);
  for (const team of byRole.values()) {
    if (team.length < 2) continue;
    team.forEach((s, i) => {
      if (i === 0) return; // the first of a role is the one being covered, not the extra
      const doubled = s.rota.flatMap((on, d) => (on && team.some((o) => o !== s && o.rota[d]) ? [d] : []));
      if (!doubled.length) return;
      const weeklyCost = shiftCost(s) * doubled.length;
      if (!best || weeklyCost >= best.weeklyCost) best = { staffId: s.id, name: s.name, role: s.role, doubledDays: doubled, weeklyCost, dailyLoss: Math.round(profit) };
    });
  }
  return best;
}
