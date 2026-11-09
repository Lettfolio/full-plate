import type { MenuQuadrant } from "@full-plate/sim-core";
import type { TermId } from "../../lib/glossary";

/** Round 7: the quadrant names live here so the dish list can label dishes without loading the (lazy) matrix. */
export const QUADRANT: Record<MenuQuadrant, { label: string; colour: string; hint: string }> = {
  star: { label: "Star", colour: "#e9a23b", hint: "Popular and profitable. Keep it, show it off." },
  ploughhorse: { label: "Plough-horse", colour: "#4f8fb8", hint: "Popular, thin margin. Nudge the price up or trim the cost." },
  puzzle: { label: "Puzzle", colour: "#8a5a9e", hint: "Profitable, but few order it. Rename it, move it, push it." },
  dog: { label: "Dog", colour: "#9b8f80", hint: "Neither. Think about taking it off." },
};

export const QUADRANT_TERM = { star: "mmStar", ploughhorse: "mmPloughhorse", puzzle: "mmPuzzle", dog: "mmDog" } as const satisfies Record<MenuQuadrant, TermId>;
