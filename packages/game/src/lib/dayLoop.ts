/**
 * Round 7 (B): pure selectors for the owner's daily loop — the Stock tab's one-line forecast, the Staff tab's week
 * strip (who's on, where two people share one job), the Evening's week of profits and the GameOver cause. UI-only:
 * every number comes from GameState / DayResult or a sim-core export; nothing here changes a rule.
 */
import type { DayResult, GameState, Staff, StaffRole } from "@full-plate/sim-core";
import { meanProfit, ROTA_ADVICE_DAYS, rotaAdvice, shiftCost } from "../sim";
import { ROLE_LABEL } from "./staff";
import { WEEKDAY_NAMES } from "./calendar";

// ───────── stock ─────────

/** Portions shown to a child: whole numbers (stock is fractional after a service). Need rounds up, stock down. */
export const wholeHave = (n: number): number => Math.max(0, Math.floor(n + 1e-6));
export const wholeNeed = (n: number): number => Math.max(0, Math.ceil(n - 1e-6));

export type ForecastTone = "idle" | "ok" | "short" | "opening" | "coming";
export interface ForecastLine { tone: ForecastTone; text: string; need: number; have: number; short: number }

/**
 * One sentence per ingredient: "You'll need about 31 — you have 23." `have` is on hand plus what's already ordered
 * (it arrives tomorrow morning, before the next service this forecast is for).
 */
export function forecastLine(r: { need: number; onHand: number; incoming: number }, opening = false): ForecastLine {
  const need = wholeNeed(r.need);
  const onHand = wholeHave(r.onHand);
  const coming = wholeHave(r.incoming);
  const have = wholeHave(r.onHand + r.incoming);
  const short = Math.max(0, need - have);
  if (need === 0) return { tone: "idle", text: "Not on today's menu", need, have, short: 0 };
  if (opening) return { tone: "opening", text: `You'll need about ${need}. Opening stock is bought when you open.`, need, have, short: 0 };
  const youHave = coming > 0 ? `you have ${onHand} + ${coming} coming` : `you have ${onHand}`;
  if (short > 0) return { tone: "short", text: `You'll need about ${need} — ${youHave}. Order ${short} more.`, need, have, short };
  return { tone: coming > 0 && onHand < need ? "coming" : "ok", text: `You'll need about ${need} — ${youHave}.`, need, have, short: 0 };
}

// ───────── rota week strip ─────────

export interface RotaCell { day: number; people: Staff[]; doubled: boolean; empty: boolean }
export interface RotaRow { role: StaffRole; label: string; cells: RotaCell[] }
export interface DoubledSummary {
  /** Role and weekdays where two or more people of that role are rostered. */
  role: StaffRole;
  days: number[];
  /** Weekly cost of the extra people on those days (every shift but the dearest one each day: the least she would save). */
  weeklyExtra: number;
}

/** Rows for the week strip: chefs and servers always, other roles once someone has them. */
export function rotaWeek(staff: readonly Staff[]): RotaRow[] {
  const roles: StaffRole[] = ["chef", "server", ...(["bar", "porter", "manager"] as const).filter((r) => staff.some((s) => s.role === r))];
  return roles.map((role) => ({
    role,
    label: ROLE_LABEL[role],
    cells: Array.from({ length: 7 }, (_, day) => {
      const people = staff.filter((s) => s.role === role && s.rota[day]);
      return { day, people, doubled: people.length >= 2, empty: people.length === 0 };
    }),
  }));
}

/** Every role that has doubled-up days, with what the extra people cost a week. */
export function doubledShifts(staff: readonly Staff[]): DoubledSummary[] {
  return rotaWeek(staff).flatMap((row) => {
    const cells = row.cells.filter((c) => c.doubled);
    if (!cells.length) return [];
    const weeklyExtra = cells.reduce((a, c) => {
      const costs = c.people.map((p) => shiftCost(p)).sort((x, y) => y - x);
      return a + costs.slice(1).reduce((s, v) => s + v, 0);
    }, 0);
    return [{ role: row.role, days: cells.map((c) => c.day), weeklyExtra }];
  });
}

/** "Fri, Sat and Sun" (short names) or full names. */
export function daysPhrase(days: readonly number[], full = false): string {
  const n = days.map((d) => (full ? WEEKDAY_NAMES[d]! : WEEKDAY_NAMES[d]!.slice(0, 3)));
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

/** True when the last fortnight lost money (the condition the round-5 rota tip uses). */
export function losingFortnight(game: Pick<GameState, "history">): boolean {
  const p = meanProfit(game.history, ROTA_ADVICE_DAYS);
  return p !== undefined && p < 0;
}

// ───────── evening ─────────

export interface NightBar { day: number; profit: number; covers: number; closed: boolean }

/** The last `n` nights (oldest first), for the Evening sparkline. */
export function lastNights(history: readonly DayResult[], n = 7): NightBar[] {
  return history.slice(-n).map((d) => ({ day: d.day, profit: d.profit, covers: d.covers, closed: !!d.closed }));
}

/** Tonight against the night before: "£120 better than yesterday". Undefined on the first night. */
export function versusYesterday(history: readonly DayResult[]): number | undefined {
  if (history.length < 2) return undefined;
  return history.at(-1)!.profit - history.at(-2)!.profit;
}

// ───────── game over ─────────

const tenths = (part: number, whole: number) => Math.max(0, Math.min(10, Math.round((part / whole) * 10)));

/**
 * One sentence that says why the money ran out, from the last fortnight's own numbers: how many days lost money and
 * the biggest cost against what came in. Names doubled-up shifts when the round-5 rota rule holds.
 */
export function gameOverCause(game: Pick<GameState, "history" | "staff">): string {
  const h = game.history.slice(-ROTA_ADVICE_DAYS).filter((d) => !d.closed);
  if (!h.length) return "The restaurant never got going, so there was nothing to pay the bills with.";
  const losing = h.filter((d) => d.profit < 0).length;
  const sum = (f: (d: DayResult) => number) => h.reduce((a, d) => a + f(d), 0);
  const revenue = sum((d) => d.revenue);
  const lead = `You lost money on ${losing} of your last ${h.length} day${h.length === 1 ? "" : "s"}`;
  if (revenue <= 0) return `${lead}, because hardly anyone came in to eat.`;
  const costs: [string, number][] = [
    ["wages", sum((d) => d.labourCost)],
    ["food", sum((d) => d.foodCost + d.waste.spoil + d.waste.prep)],
    ["rent", sum((d) => d.rent + (d.overheads ?? 0))],
    ["loan", sum((d) => d.loanPayment)],
  ];
  const [kind, amount] = costs.reduce((a, b) => (b[1] > a[1] ? b : a));
  const per = tenths(amount, revenue);
  const rota = rotaAdvice(game);
  switch (kind) {
    case "wages":
      return `${lead}, mostly because wages took £${per} of every £10 that came in${rota ? ` (two ${ROLE_LABEL[rota.role].toLowerCase()}s were often on the same shift)` : ""}.`;
    case "food":
      return `${lead}, mostly because food took £${per} of every £10 that came in: prices were low or stock went in the bin.`;
    case "rent":
      return `${lead}, mostly because too few guests came to pay the rent and bills (£${per} of every £10 that came in).`;
    default:
      return `${lead}, and the loan repayments took £${per} of every £10 that came in.`;
  }
}
