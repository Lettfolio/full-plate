import { useEffect, useRef, useState } from "react";
import { getSettings } from "./settings";

/**
 * Round 12 (A): one answer to "may this move?" — no when the OS asks for reduced motion, when Settings › Animations is
 * off, or where matchMedia is missing (tests). With a no, every count-up, fade and floor beat is instant.
 */
export function motionOk(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return getSettings().animations && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Eases from the last shown value to `target` over `ms` (ease-out cubic), or from 0 the first time when `mode` is
 * "mount". `round` = how the in-between values are rounded (whole numbers by default; 10 for one decimal place).
 * Without motion it returns `target` at once.
 */
export function useCountUp(target: number, mode: "change" | "mount" | undefined, ms = 650, round = 1): number {
  const [shown, setShown] = useState(() => (mode === "mount" && motionOk() ? 0 : target));
  const from = useRef(shown);
  useEffect(() => {
    if (!mode || !motionOk() || from.current === target) { from.current = target; setShown(target); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = t >= 1 ? target : Math.round((a + (target - a) * (1 - (1 - t) ** 3)) * round) / round;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, mode, ms, round]);
  return mode ? shown : target;
}

/** A number that counts up (aria-label is always the final value, so a screen reader hears one number). */
export function CountUp({ value, mode = "change", ms, digits = 0, className }: { value: number; mode?: "change" | "mount"; ms?: number; digits?: number; className?: string }) {
  const shown = useCountUp(value, mode, ms, 10 ** digits);
  const text = (n: number) => (digits ? n.toFixed(digits) : String(Math.round(n)));
  return <span className={className} aria-label={text(value)} data-value={value}><span aria-hidden="true">{text(shown)}</span></span>;
}
