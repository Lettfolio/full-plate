/** Money is integer pence everywhere in the sim; these are the only places it becomes pounds. */

const MINUS = "−"; // typographic minus: "−£12.30" reads better than "-£12.30"

export interface MoneyFormatOptions {
  /** Prefix positive values with "+". */
  signed?: boolean;
  /** Drop the pennies: £1,235. Rounds half away from zero. */
  whole?: boolean;
}

export function formatPence(pence: number, opts: MoneyFormatOptions = {}): string {
  if (!Number.isFinite(pence)) return "£—";
  const negative = pence < 0;
  let abs = Math.round(Math.abs(pence));
  if (opts.whole) abs = Math.round(abs / 100) * 100;
  const pounds = Math.floor(abs / 100);
  const pennies = abs % 100;
  const grouped = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = opts.whole ? `£${grouped}` : `£${grouped}.${String(pennies).padStart(2, "0")}`;
  if (negative && abs !== 0) return MINUS + body;
  if (opts.signed && abs !== 0) return "+" + body;
  return body;
}

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
