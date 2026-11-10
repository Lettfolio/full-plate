import { useCountUp } from "../lib/motion";
import { formatPence, type MoneyFormatOptions } from "../lib/format";

interface Props extends MoneyFormatOptions {
  /** Integer pence. */
  pence: number;
  /** Colour by sign (green ≥ 0, red < 0). Off by default: most money on screen is neutral. */
  tone?: boolean;
  className?: string;
  /**
   * Round 7: a brief count-up when the value changes ("change"), or from £0 when it first shows ("mount", the Evening's
   * big figure). Skipped under prefers-reduced-motion, with Settings › Animations off (R12-A) and where matchMedia is
   * missing (tests). `data-pence` and the accessible name are always the final value.
   */
  countUp?: "change" | "mount";
}

/** Formats integer pence as £1,234.56 (or −£12.30). */
export function MoneyText({ pence, tone = false, className, countUp, ...opts }: Props) {
  const shown = useCountUp(pence, countUp);
  const cls = ["money", tone ? (pence < 0 ? "money--neg" : "money--pos") : "", countUp && shown !== pence ? "money--counting" : "", className ?? ""].filter(Boolean).join(" ");
  if (!countUp) return <span className={cls} data-pence={Math.round(pence)}>{formatPence(pence, opts)}</span>;
  return (
    <span className={cls} data-pence={Math.round(pence)} aria-label={formatPence(pence, opts)}>
      <span aria-hidden="true">{formatPence(shown, opts)}</span>
    </span>
  );
}
