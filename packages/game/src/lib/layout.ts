import { useSyncExternalStore } from "react";

/**
 * Round 11 (D): tablet fit. One media query for "narrow" (an iPad held upright, 768 px) shared by theme.css's R11-D
 * block and the few components that change behaviour there (collapsed goals). Layout only, nothing is stored.
 */
export const NARROW_QUERY = "(max-width: 1023px)";
/** A finger, not a mouse: "Tap a table", not "Click a table". */
export const COARSE_QUERY = "(pointer: coarse)";

function matches(q: string): boolean {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches; } catch { return false; }
}

function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const m = window.matchMedia(q);
      m.addEventListener?.("change", cb);
      return () => m.removeEventListener?.("change", cb);
    },
    () => matches(q),
    () => false,
  );
}

/** Round 12 (D): an upright phone (phone.css's first block). */
export const PHONE_QUERY = "(max-width: 480px)";
/** Round 12 (D): a phone held sideways (phone.css's second block). */
export const PHONE_LANDSCAPE_QUERY = "(max-height: 500px) and (orientation: landscape)";
/** Round 12 (D): upright and phone-sized: the hands-on kitchen asks to be turned sideways (RotateCard). */
export const PHONE_PORTRAIT_QUERY = "(max-width: 480px) and (orientation: portrait)";

export const useNarrow = (): boolean => useMedia(NARROW_QUERY);
export const usePhonePortrait = (): boolean => useMedia(PHONE_PORTRAIT_QUERY);
export const useCoarsePointer = (): boolean => useMedia(COARSE_QUERY);

/** "Tap" on a touch screen, "Click" with a mouse (capitalised when `cap`). */
export function pointWord(coarse: boolean, cap = true): string {
  const w = coarse ? "tap" : "click";
  return cap ? w[0]!.toUpperCase() + w.slice(1) : w;
}
