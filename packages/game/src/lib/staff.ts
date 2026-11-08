import type { Staff, StaffRole } from "@full-plate/sim-core";

export function moodFace(mood: number): string {
  if (mood >= 80) return "😄";
  if (mood >= 60) return "🙂";
  if (mood >= 40) return "😐";
  if (mood >= 20) return "😟";
  return "😫";
}

export function moodWord(mood: number): string {
  if (mood >= 80) return "Loving it";
  if (mood >= 60) return "Happy";
  if (mood >= 40) return "OK";
  if (mood >= 20) return "Fed up";
  return "Ready to quit";
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export const ROLE_LABEL: Record<StaffRole, string> = { chef: "Chef", server: "Server", bar: "Bar", porter: "Kitchen porter", manager: "Manager" };

/** Count of staff of a role working on weekday i (rota index). */
export function coverage(staff: Staff[], role: StaffRole): number[] {
  return Array.from({ length: 7 }, (_, i) => staff.filter((s) => s.role === role && s.rota[i]).length);
}

/** Shift length in hours (sim-core constant). */
export { SHIFT_HOURS } from "../sim";

/** Rostered and actually on the floor today (a TRAIN day takes someone off the rota for that day). */
export function onFloorToday(game: { day: number; staff: Staff[] }, weekday: number): Staff[] {
  return game.staff.filter((s) => s.rota[weekday] && !isTrainingToday(game, s));
}

/**
 * Round-2 staff fields the sim agent is adding (`trainingDay`, `breakUntilTick`). Read loosely so the UI
 * works before they exist in the contract and on saves from round 1.
 */
type R2Staff = Staff & { trainingDay?: number; breakUntilTick?: number };
export function isTrainingToday(game: { day: number }, s: Staff): boolean {
  return (s as R2Staff).trainingDay === game.day;
}
export function onBreak(game: { tick: number }, s: Staff): boolean {
  const until = (s as R2Staff).breakUntilTick;
  return typeof until === "number" && game.tick < until;
}

/** Why `s` can't be sent on a training day right now, or null if they can. */
export function trainBlocker(game: { day: number; staff: Staff[]; phase: string }, s: Staff, weekday: number): string | null {
  if (game.phase !== "planning") return "Training is booked in the morning";
  if (isTrainingToday(game, s)) return `${s.name.split(" ")[0]} is training today`;
  const floor = onFloorToday(game, weekday);
  if (floor.some((x) => x.id === s.id) && floor.filter((x) => x.role === s.role).length === 1) {
    return `${s.name.split(" ")[0]} is the only ${ROLE_LABEL[s.role].toLowerCase()} on today — you'd have to cover`;
  }
  return null;
}

/** "the kitchen and the floor" for the roles the owner is covering. */
export function coveringPhrase(roles: readonly StaffRole[]): string {
  const PLACE: Record<StaffRole, string> = { chef: "the kitchen", server: "the floor", bar: "the bar", porter: "the washing-up", manager: "the paperwork" };
  const parts = [...new Set(roles)].map((r) => PLACE[r]);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
