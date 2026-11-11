/**
 * Round 13 (C): the hands-on shift on a phone — which layout the shift is in, the canvas view options each layout
 * draws with, and the "seen" flag of the phone how-to. Layout only: nothing here reaches the session or the sim.
 *
 *   desk      a laptop or a tablet: the R7 layout (bar on top, the 80 px canvas header, USE/Drop over the stage)
 *   sideways  a phone held sideways (lib/layout PHONE_LANDSCAPE_QUERY): the canvas fills the height between two thumb
 *             columns (Pause/Skip/Drop on the left, USE on the right), with the 52 px ticket strip
 *   upright   an upright phone (PHONE_PORTRAIT_QUERY), after "Play it upright anyway": a slim bar, the kitchen with a
 *             camera that follows her, and the controls (drag pad, Drop, USE) underneath
 */
import { useSyncExternalStore } from "react";
import type { HandsOnRole, HandsOnView } from "@full-plate/handson";
import { PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY } from "../lib/layout";
import { accountHas, noteMarked } from "../lib/onboardFlags";

export type HandsOnLayout = "desk" | "sideways" | "upright";

const mq = (q: string): MediaQueryList | undefined => {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : undefined; } catch { return undefined; }
};

export function handsOnLayout(): HandsOnLayout {
  if (mq(PHONE_LANDSCAPE_QUERY)?.matches) return "sideways";
  if (mq(PHONE_PORTRAIT_QUERY)?.matches) return "upright";
  return "desk";
}

export function useHandsOnLayout(): HandsOnLayout {
  return useSyncExternalStore(
    (cb) => {
      const qs = [mq(PHONE_LANDSCAPE_QUERY), mq(PHONE_PORTRAIT_QUERY)];
      for (const q of qs) q?.addEventListener?.("change", cb);
      return () => { for (const q of qs) q?.removeEventListener?.("change", cb); };
    },
    handsOnLayout,
    () => "desk",
  );
}

/** A phone's tap targets round a station (handson `hitSlop`): 56 px, not 44. */
export const PHONE_HIT_SLOP = 56;

/** What the canvas is told about the layout (the rest of the view — size, dpr, palette — is the shift's). */
export function layoutView(layout: HandsOnLayout): Pick<HandsOnView, "compact" | "follow" | "hitSlop"> {
  if (layout === "sideways") return { compact: true, hitSlop: PHONE_HIT_SLOP };
  if (layout === "upright") return { compact: true, follow: true, hitSlop: PHONE_HIT_SLOP };
  return {};
}

/**
 * The phone how-to's flag: once per role on this device, never again (the R9 account mirror carries every
 * `full-plate:onboard:v1:` key, so another device that signs in to the same account knows too).
 */
export const phoneHowToKey = (role: HandsOnRole): string => `full-plate:onboard:v1:phone:${role}`;

export function phoneHowToSeen(storage: Pick<Storage, "getItem"> | undefined, role: HandsOnRole): boolean {
  const k = phoneHowToKey(role);
  if (accountHas(k)) return true;
  try { return storage?.getItem(k) === "1"; } catch { return false; }
}

export function markPhoneHowToSeen(storage: Pick<Storage, "setItem"> | undefined, role: HandsOnRole): void {
  const k = phoneHowToKey(role);
  try { storage?.setItem(k, "1"); } catch { /* private mode: it shows again next time */ }
  noteMarked(k);
}
