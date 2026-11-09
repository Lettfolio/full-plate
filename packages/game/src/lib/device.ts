/** Round 7: device sniffing kept out of the handson chunk (the evening uses it too). */
/** A touch-first screen (iPad): coarse primary pointer. A touch on the canvas switches the shift to touch too. */
export function prefersTouch(w: Pick<Window, "matchMedia"> | undefined = typeof window === "undefined" ? undefined : window): boolean {
  try { return !!w?.matchMedia?.("(pointer: coarse)").matches; } catch { return false; }
}
