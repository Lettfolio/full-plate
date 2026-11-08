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
