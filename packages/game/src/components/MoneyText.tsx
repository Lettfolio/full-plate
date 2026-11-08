import { formatPence, type MoneyFormatOptions } from "../lib/format";

interface Props extends MoneyFormatOptions {
  /** Integer pence. */
  pence: number;
  /** Colour by sign (green ≥ 0, red < 0). Off by default: most money on screen is neutral. */
  tone?: boolean;
  className?: string;
}

/** Formats integer pence as £1,234.56 (or −£12.30). */
export function MoneyText({ pence, tone = false, className, ...opts }: Props) {
  const cls = ["money", tone ? (pence < 0 ? "money--neg" : "money--pos") : "", className ?? ""].filter(Boolean).join(" ");
  return <span className={cls} data-pence={Math.round(pence)}>{formatPence(pence, opts)}</span>;
}
