import type { DayResult, GameState, Incident, IncidentKind, IncidentSummary } from "@full-plate/sim-core";

export const INCIDENT_ICON: Record<IncidentKind, string> = {
  sent_back: "🍽️",
  spill: "💦",
  big_party: "👨‍👩‍👧‍👦",
  rush: "🏃",
  supplier_short: "📦",
  equipment: "🔧",
  vip: "🎩",
  staff_wobble: "😓",
};

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  sent_back: "Plate sent back",
  spill: "Spill",
  big_party: "Big party",
  rush: "Rush",
  supplier_short: "Short delivery",
  equipment: "Kit trouble",
  vip: "VIP in",
  staff_wobble: "Flagging staff",
};

/** Live = not yet resolved. Safe on saves from before round 2 (incidents undefined). */
export function liveIncidents(game: Pick<GameState, "incidents">): Incident[] {
  return (game.incidents ?? []).filter((i) => !i.resolution);
}

/** Fraction of the countdown left, 0..1. Total = ticks already elapsed + ticks left. */
export function countdownFraction(inc: Incident, tick: number): number {
  const total = inc.ticksLeft + Math.max(0, tick - inc.startedTick);
  return total > 0 ? Math.max(0, Math.min(1, inc.ticksLeft / total)) : 0;
}

export interface IncidentLine { kind: IncidentKind; title: string; choice: string; outcome: string; ignored: boolean }

/**
 * The evening's "What happened today" list. Prefers DayResult.incidents (the sim's summary) and uses
 * the still-present state.incidents to turn option ids into the button labels the player saw.
 */
export function incidentLines(result: DayResult | null, game: Pick<GameState, "incidents">): IncidentLine[] {
  const full = (game.incidents ?? []).filter((i) => i.resolution);
  const summaries: (IncidentSummary & { title?: string; options?: Incident["options"] })[] =
    result?.incidents ?? full.map((i) => ({ kind: i.kind, resolution: i.resolution!, outcome: i.outcome ?? "", title: i.title, options: i.options }));
  return summaries.map((s, idx) => {
    const match = full.find((i) => i.kind === s.kind && i.resolution === s.resolution && (i.outcome ?? "") === s.outcome) ?? full[idx];
    const ignored = s.resolution === "ignored";
    const opt = (s.options ?? match?.options)?.find((o) => o.id === s.resolution);
    return {
      kind: s.kind,
      title: s.title ?? match?.title ?? INCIDENT_LABEL[s.kind],
      choice: ignored ? "Left it" : s.resolution === "porter" ? "Your porter handled it" : opt?.label ?? s.resolution,
      outcome: s.outcome,
      ignored,
    };
  });
}
