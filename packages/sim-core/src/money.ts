/**
 * Round 11 (D, red-team U12): the ONE pounds formatter. Money is integer pence everywhere; this is where it becomes
 * "£1,234.50". Pure and dependency-free so every sim package can use it for its player-facing lines, and the game's
 * lib/format.ts re-exports it. Negatives use the typographic minus ("−£12.30"), never "-£12" or "£-12".
 */
export const MINUS = "−";

export interface MoneyFormatOptions {
  /** Prefix positive values with "+". */
  signed?: boolean;
  /** Drop the pennies: £1,235. Rounds half away from zero. */
  whole?: boolean;
  /** Pennies only when there are some: "£12" but "£12.50". */
  trim?: boolean;
}

export function formatPence(pence: number, opts: MoneyFormatOptions = {}): string {
  if (!Number.isFinite(pence)) return "£—";
  const negative = pence < 0;
  let abs = Math.round(Math.abs(pence));
  if (opts.whole) abs = Math.round(abs / 100) * 100;
  const pounds = Math.floor(abs / 100);
  const pennies = abs % 100;
  const grouped = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = opts.whole || (opts.trim && pennies === 0) ? `£${grouped}` : `£${grouped}.${String(pennies).padStart(2, "0")}`;
  if (negative && abs !== 0) return MINUS + body;
  if (opts.signed && abs !== 0) return "+" + body;
  return body;
}

/** Whole pounds, "£1,234" / "−£1,234" — the common case for sim log lines. */
export const formatPounds = (pence: number): string => formatPence(pence, { whole: true });
