/**
 * StatsSystem (evening, last) — assembles the DayResult, rolls the 7-day menu window,
 * and updates lifetime stats and history.
 *
 * P&L: profit = revenue − VAT − foodCost − prep waste − spoilage − labour − rent − overheads − loan.
 * VAT is settled daily for simplicity (real businesses pay quarterly).
 * Plate waste is already part of foodCost and is shown for information only.
 */
import { HISTORY_MAX, MENU_WINDOW_DAYS } from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, DayResult, DishId, GameState, MenuItem, ServiceTally } from "../types";
import { round2, tallyOf } from "../util";
import type { SystemResult } from "./system";

type DishTally = ServiceTally["dishes"][string];

/** Best = highest margin today; worst = lowest mean plate quality (only dishes that sold). */
export function bestAndWorst(dishes: Record<DishId, DishTally>): { best?: DishId; worst?: DishId } {
  let best: DishId | undefined;
  let worst: DishId | undefined;
  let bestMargin = -Infinity;
  let worstQuality = Infinity;
  for (const [id, d] of Object.entries(dishes)) {
    if (d.sold <= 0) continue;
    if (d.margin > bestMargin) [best, bestMargin] = [id, d.margin];
    const q = d.plated ? d.qualitySum / d.plated : 0;
    if (q < worstQuality) [worst, worstQuality] = [id, q];
  }
  return { ...(best ? { best } : {}), ...(worst && worst !== best ? { worst } : {}) };
}

export function rollMenu(menu: readonly MenuItem[], dishes: Record<DishId, DishTally>): MenuItem[] {
  return menu.map((m) => {
    const d = dishes[m.dishId];
    const recent = [...(m.recent ?? []), { sold: d?.sold ?? 0, margin: d?.margin ?? 0 }].slice(-MENU_WINDOW_DAYS);
    return {
      ...m,
      recent,
      sold7d: recent.reduce((a, r) => a + r.sold, 0),
      margin7d: recent.reduce((a, r) => a + r.margin, 0),
    };
  });
}

export function buildDayResult(state: GameState): DayResult {
  const t = state.todays;
  const tally = tallyOf(state);
  const covers = t.covers ?? 0;
  const revenue = t.revenue ?? 0;
  const waste = t.waste ?? { prep: 0, plate: 0, spoil: 0 };
  const foodCost = t.foodCost ?? 0;
  const labourCost = t.labourCost ?? 0;
  const rent = t.rent ?? 0;
  const loanPayment = t.loanPayment ?? 0;
  const overheads = t.overheads ?? 0;
  const vat = t.vat ?? 0;
  const { best, worst } = bestAndWorst(tally.dishes);
  return {
    day: state.day,
    covers,
    walkouts: t.walkouts ?? 0,
    revenue,
    tips: t.tips ?? 0,
    foodCost,
    labourCost,
    rent,
    loanPayment,
    overheads,
    vat,
    waste,
    profit: revenue - vat - foodCost - waste.prep - waste.spoil - labourCost - rent - overheads - loanPayment,
    averageSpend: covers ? Math.round(revenue / covers) : 0,
    averageRating: t.averageRating ?? 0,
    ...(best ? { bestDish: best } : {}),
    ...(worst ? { worstDish: worst } : {}),
    popularityDelta: round2(t.popularityDelta ?? 0),
    prestigeDelta: round2(t.prestigeDelta ?? 0),
    reviews: t.reviews,
    staffMoodDelta: t.staffMoodDelta ?? {},
  };
}

export function statsSystem(_content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  const result = buildDayResult(state);
  const history = [...state.history, result];
  return {
    state: {
      ...state,
      todays: { ...result },
      history: history.length > HISTORY_MAX ? history.slice(-HISTORY_MAX) : history,
      menu: rollMenu(state.menu, tallyOf(state).dishes),
      stats: {
        totalCovers: state.stats.totalCovers + result.covers,
        totalRevenue: state.stats.totalRevenue + result.revenue,
        daysOpen: state.stats.daysOpen + 1,
      },
    },
    events: [],
  };
}
