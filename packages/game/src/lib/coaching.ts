/**
 * Round 7: the score card's "what to try next", in a child's words and from the night's own numbers.
 * `nightCoaching` is one sentence tying tonight's count to the next star; `forDevice` swaps the keyboard's "E" for the
 * touch screen's USE button in the coach's tip.
 */
import type { ShiftSummary } from "@full-plate/handson";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const n = (k: number) => WORDS[k] ?? String(k);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const STAR = ["your first star", "a second star", "a third star"] as const;

/** One sentence from tonight's numbers: what she did, and how much more earns the next star. */
export function nightCoaching(s: ShiftSummary): string {
  const chef = s.role === "chef";
  const done = chef ? s.plates : s.served;
  const unit = chef ? (done === 1 ? "plate" : "plates") : done === 1 ? "plate served" : "plates served";
  if (done === 0) {
    if (chef && s.covered) return `The sous chef sent ${n(s.covered)} for you tonight — tomorrow, fetch one slip from the fridge yourself and the points are yours.`;
    return chef
      ? "Tomorrow, start at the fridge: one slip, one plate, and the stars start coming."
      : "Tomorrow, pick up one plate at the pass and carry it to its table — the stars start there.";
  }
  const what = chef ? `${cap(n(done))} ${unit} at ${s.meanQuality}%` : `${cap(n(done))} ${unit}`;
  if (s.stars >= 3 || s.nextStarAt === undefined) return `${what} — a three-star shift! Next time, see if you can beat ${s.points} points.`;
  const per = s.points / done;
  const more = Math.max(1, Math.ceil((s.nextStarAt - s.points) / Math.max(1, per)));
  return `${what} tonight — about ${n(more)} more ${chef ? (more === 1 ? "plate" : "plates") : more === 1 ? "plate served" : "plates served"} would have earned ${STAR[s.stars as 0 | 1 | 2]}.`;
}

/** The coach's tip for this device: "tap E" / "Hold E" / "of E" → USE on a touch screen. */
export function forDevice(text: string, touch: boolean): string {
  return touch ? text.replace(/\bE\b/g, "USE") : text;
}
