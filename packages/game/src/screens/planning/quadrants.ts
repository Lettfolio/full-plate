import type { MenuQuadrant } from "@full-plate/sim-core";
import type { TermId } from "../../lib/glossary";

/** Round 7: the quadrant names live here so the dish list can label dishes without loading the (lazy) matrix. */
export const QUADRANT: Record<MenuQuadrant, { label: string; colour: string; hint: string; short: string }> = {
  star: { label: "Star", colour: "#e9a23b", hint: "Popular and profitable. Keep it, show it off.", short: "Keep it" },
  ploughhorse: { label: "Plough-horse", colour: "#4f8fb8", hint: "Popular, thin margin. Nudge the price up or trim the cost.", short: "Try a higher price" },
  puzzle: { label: "Puzzle", colour: "#8a5a9e", hint: "Profitable, but few order it. Rename it, move it, push it.", short: "Few order it" },
  dog: { label: "Dog", colour: "#9b8f80", hint: "Neither. Think about taking it off.", short: "Think about taking it off" },
};

/** Round 11 (U5): a dish isn't judged until it has this many days of sales (no "Dog" on day 1). */
export const QUADRANT_MIN_DAYS = 7;
/** Days of sales the matrix has for this dish (old saves without `recent` count as a full week). */
export const judged = (m: { recent?: readonly unknown[] }): boolean => !m.recent || m.recent.length >= QUADRANT_MIN_DAYS;

export const QUADRANT_TERM = { star: "mmStar", ploughhorse: "mmPloughhorse", puzzle: "mmPuzzle", dog: "mmDog" } as const satisfies Record<MenuQuadrant, TermId>;
