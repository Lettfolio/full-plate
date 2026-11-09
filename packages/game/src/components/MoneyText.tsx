import { useEffect, useRef, useState } from "react";
import { formatPence, type MoneyFormatOptions } from "../lib/format";

interface Props extends MoneyFormatOptions {
  /** Integer pence. */
  pence: number;
  /** Colour by sign (green ≥ 0, red < 0). Off by default: most money on screen is neutral. */
  tone?: boolean;
  className?: string;
  /**
   * Round 7: a brief count-up when the value changes ("change"), or from £0 when it first shows ("mount", the Evening's
   * big figure). Skipped under prefers-reduced-motion and where matchMedia is missing (tests). `data-pence` and the
   * accessible name are always the final value.
   */
  countUp?: "change" | "mount";
}

const COUNT_MS = 650;

function motionOk(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The value to draw this frame: eases from the last shown value to `target` over COUNT_MS. */
function useCountUp(target: number, mode: Props["countUp"]): number {
  const [shown, setShown] = useState(() => (mode === "mount" && motionOk() ? 0 : target));
  const from = useRef(shown);
  useEffect(() => {
    if (!mode || !motionOk() || from.current === target) { from.current = target; setShown(target); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      const v = Math.round(a + (target - a) * (1 - (1 - t) ** 3));
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, mode]);
  return mode ? shown : target;
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
