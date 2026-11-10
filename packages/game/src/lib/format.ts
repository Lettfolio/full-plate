/** Money is integer pence everywhere in the sim; these are the only places it becomes pounds. */

// Round 11 (D, U12): the formatter itself lives in sim-core (money.ts) so the sim packages' lines match the UI's.
import { formatPence, MINUS, type MoneyFormatOptions } from "@full-plate/sim-core";
export { formatPence, type MoneyFormatOptions };
/** Whole pounds: "£1,234" / "−£1,234". */
export const formatPounds = (pence: number): string => formatPence(pence, { whole: true });

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function signed(n: number, digits = 1): string {
  const v = Number(n.toFixed(digits));
  if (v > 0) return `+${v.toFixed(digits)}`;
  if (v < 0) return `${MINUS}${Math.abs(v).toFixed(digits)}`;
  return (0).toFixed(digits);
}
